/**
 * ssx-sync-units — Discovers vehicles/tracked units from the SSX API.
 *
 * STRATEGY (VEHICLE-FIRST):
 * 1. PRIMARY: /Administration/Vehicle/v2/List → Vehicle/List fallback
 * 2. ENRICHMENT: /Administration/Tracker/List (adds device metadata only)
 * 3. FALLBACK: PositionHistory (if all admin endpoints fail)
 * 4. provider_units represent POLLABLE entities (vehicles/tracked units, NOT trackers)
 * 5. external_code = VehicleIntegrationCode > TrackedUnitIntegrationCode
 * 6. Tracker info stored in metadata only
 */

import { createClient } from "@supabase/supabase-js";
import { isCronRequest } from "../_shared/cron-auth.ts";
import { requireIntegrationCapability } from "../_shared/capabilities.ts";
import {
  corsHeaders,
  buildAdminUrlCandidates,
  buildSsxUrlCandidates,
  readAccountConfig,
  normalizeTrackerItem,
  pickVehicleIntegrationCode,
  pickTrackerCodeFromVehicle,
  pickPlate,
  tryEndpointWithFallback,
  getAdminToken,
  ADMIN_BODY_CANDIDATES,
  logIntegration,
  logSsxCall,
  summarizeAttemptMatrix,
  getTenantRole,
  type SsxErrorClass,
  type EndpointAttemptResult,
  type NormalizedUnit,
  type AttemptLog,
} from "../_shared/ssx-utils.ts";

const BACKOFF_TIERS_MS = [2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000];
const CACHE_TTL_MS = 60 * 60_000;
const ADMIN_SKIP_MS = 10 * 60_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let callerId: string | null = null;

    const isCron = await isCronRequest(req, supabaseUrl, supabaseServiceKey);

    if (!isCron) {
      const authHeader = req.headers.get("Authorization");
      if (!authHeader?.startsWith("Bearer ")) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await anonClient.auth.getUser();
      if (userError || !userData?.user) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      callerId = userData.user.id;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { integration_account_id, force } = body;
    if (!integration_account_id) {
      return jsonResponse({ error: "integration_account_id required" }, 400);
    }

    const { data: account, error: accErr } = await supabase
      .from("integration_accounts").select("*").eq("id", integration_account_id).single();
    if (accErr || !account) {
      return jsonResponse({ error: "Integration account not found" }, 404);
    }

    if (!isCron && callerId) {
      const role = await getTenantRole(supabase, account.tenant_id, callerId);
      if (!role || !["owner", "admin"].includes(role)) {
        return jsonResponse({ error: "Forbidden: admin role required" }, 403);
      }
    }

    const capabilityResponse = await requireIntegrationCapability(supabase, account.tenant_id, "ssx");
    if (capabilityResponse) return capabilityResponse;

    const config = readAccountConfig(account);
    const settings = { ...config.settings };

    // ===== Backoff check (429 protection) =====
    const backoffUntil = settings.sync_units_backoff_until;
    if (backoffUntil && !force) {
      const remainingMs = new Date(backoffUntil).getTime() - Date.now();
      if (remainingMs > 0) {
        return jsonResponse({
          error: "Limite de consultas SSX excedido. Aguarde e tente novamente.",
          retry_after_seconds: Math.ceil(remainingMs / 1000),
          retry_at: backoffUntil,
          cooldown_active: true,
        }, 429);
      }
    }

    // ===== Cache check =====
    const lastSyncAt = settings.last_units_sync_at;
    if (!force && lastSyncAt) {
      const elapsed = Date.now() - new Date(lastSyncAt).getTime();
      if (elapsed < CACHE_TTL_MS) {
        return jsonResponse({
          success: true, skipped: true, reason: "Units synced recently",
          last_sync_at: lastSyncAt,
          next_sync_available_at: new Date(new Date(lastSyncAt).getTime() + CACHE_TTL_MS).toISOString(),
        });
      }
    }

    // ===== Token check =====
    if (!config.token || !account.token_expires_at || new Date(account.token_expires_at).getTime() - Date.now() < 60000) {
      return jsonResponse({ error: "Token expired or missing. Run ssx-login first." }, 400);
    }

    const startTime = Date.now();

    // ================================================================
    // PHASE 1: Vehicle/v2/List → Vehicle/List (PRIMARY catalog source)
    // ================================================================

    const skipAdminUntil = settings.skip_admin_until;
    const adminSkipped = !force && skipAdminUntil && new Date(skipAdminUntil).getTime() > Date.now();
    let usedMethod = "administration";

    let vehicleResult: EndpointAttemptResult;

    if (adminSkipped) {
      console.log(`[SSX:sync-units] Admin skipped until ${skipAdminUntil}`);
      vehicleResult = {
        success: false, items: [], endpoint: "", statusCode: 0,
        errorClass: "unknown", errorMessage: "Admin temporarily skipped",
        successfulFormat: null, attempts: [],
      };
    } else {
      // PRIMARY: Try Vehicle/v2/List, then Vehicle/List
      vehicleResult = await tryAdminVehicleDiscovery(config, supabase, integration_account_id);
      if (vehicleResult.errorClass === "rate_limited") {
        return await handle429(supabase, account, settings, integration_account_id, vehicleResult, Date.now() - startTime);
      }
    }

    // --- Tracker enrichment (only if vehicles succeeded) ---
    let trackerResult: EndpointAttemptResult | null = null;
    if (vehicleResult.success && vehicleResult.items.length > 0) {
      trackerResult = await tryAdminTrackerDiscovery(config, supabase, integration_account_id);
      if (!trackerResult.success) {
        console.log(`[SSX:sync-units] Tracker enrichment failed (${trackerResult.errorClass}), continuing with vehicles only`);
      }
    }

    // ================================================================
    // PHASE 1b: If Vehicle admin failed, try fallback
    // ================================================================
    if (!vehicleResult.success || vehicleResult.items.length === 0) {
      if (!adminSkipped && vehicleResult.errorClass !== "rate_limited") {
        const skipUntil = new Date(Date.now() + ADMIN_SKIP_MS).toISOString();
        const lastAdminError = `${vehicleResult.errorClass}: ${vehicleResult.errorMessage || "unknown"}`;
        settings.skip_admin_until = skipUntil;
        settings.last_admin_error = lastAdminError;
        settings.last_admin_attempt_matrix = summarizeAttemptMatrix(vehicleResult.attempts);
        await supabase.from("integration_accounts").update({
          settings: { ...settings },
          updated_at: new Date().toISOString(),
        }).eq("id", integration_account_id);
      }

      console.log("[SSX:sync-units] Falling back to tracking-based discovery...");
      usedMethod = "legacy_fallback";

      const legacyResult = await fetchUnitsTrackingFallback(config);

      for (const attempt of legacyResult.attempts) {
        logSsxCall({
          routine: "sync-units", endpoint: attempt.endpoint, method: "POST",
          apiVersion: config.apiVersion, attemptType: `legacy:${attempt.format}`,
          statusCode: attempt.statusCode, durationMs: attempt.durationMs,
          responsePreview: attempt.responsePreview,
          result: attempt.itemCount > 0 ? "success" : "error",
          errorClass: attempt.errorClass,
          fallbackReason: "Administration API unavailable",
        });
      }

      if (legacyResult.errorClass === "rate_limited") {
        return await handle429(supabase, account, settings, integration_account_id, legacyResult, Date.now() - startTime);
      }

      if (!legacyResult.success) {
        await logIntegration(supabase, {
          tenant_id: account.tenant_id, integration_account_id,
          action: "ssx_sync_units", endpoint: legacyResult.endpoint,
          status_code: legacyResult.statusCode, success: false,
          error_message: `All discovery methods failed. Vehicle: ${vehicleResult.errorClass}. Legacy: ${legacyResult.errorClass}`,
          duration_ms: Date.now() - startTime,
          metadata: {
            method: "all_failed",
            vehicle_error_class: vehicleResult.errorClass,
            legacy_error_class: legacyResult.errorClass,
          },
        });
        await supabase.from("integration_accounts").update({
          status: "sync_inconclusive",
          last_error: `Sync failed: vehicle=${vehicleResult.errorClass}, legacy=${legacyResult.errorClass}`,
          updated_at: new Date().toISOString(),
        }).eq("id", integration_account_id);

        return jsonResponse({
          error: "SSX unit sync failed",
          vehicle_error: vehicleResult.errorClass,
          legacy_error: legacyResult.errorClass,
        }, 502);
      }

      vehicleResult = legacyResult;
    }

    const duration = Date.now() - startTime;

    // ================================================================
    // PHASE 2: Normalize, deduplicate, and extract rich metadata
    // ================================================================
    const sourceMode = usedMethod === "administration" ? "admin_catalog" : "tracking_fallback";
    const normalized: (NormalizedUnit & { raw_item: any })[] = [];
    const seenCodes = new Set<string>();

    for (const raw of vehicleResult.items) {
      const unit = normalizeTrackerItem(raw, vehicleResult.endpoint, sourceMode as any);
      if (!unit || seenCodes.has(unit.external_code)) continue;
      seenCodes.add(unit.external_code);
      normalized.push({ ...unit, raw_item: raw });
    }

    // Build tracker enrichment maps (keyed by multiple identifiers)
    const trackerEnrichmentByVehicleCode = new Map<string, any>();
    const trackerEnrichmentByPlate = new Map<string, any>();
    const trackerEnrichmentByTrackerCode = new Map<string, any>();

    if (trackerResult?.success && trackerResult.items.length > 0) {
      for (const t of trackerResult.items) {
        const vehicleCode = pickVehicleIntegrationCode(t);
        const plate = pickPlate(t);
        const trackerCode = pickTrackerCodeFromVehicle(t);
        if (vehicleCode) trackerEnrichmentByVehicleCode.set(vehicleCode, t);
        if (plate) trackerEnrichmentByPlate.set(plate.replace(/[\s.-]/g, "").toUpperCase(), t);
        if (trackerCode) trackerEnrichmentByTrackerCode.set(trackerCode, t);
      }
    }

    // ================================================================
    // PHASE 3: Idempotent upsert with rich metadata
    // ================================================================
    let upsertedCount = 0, skippedCount = 0, vehiclesCreated = 0, linksCreated = 0;
    let mappingConflicts = 0;
    const conflictDetails: { unit_code: string; reason: string; linked_vehicle_plate?: string; ssx_plate?: string }[] = [];

    for (const unit of normalized) {
      const raw = unit.raw_item;

      // Find tracker enrichment via multi-key matching
      const trackerInfo = findTrackerEnrichment(
        unit.external_code, unit.plate, raw,
        trackerEnrichmentByVehicleCode, trackerEnrichmentByPlate, trackerEnrichmentByTrackerCode,
      );

      // Build rich metadata
      const metadata = buildUnitMetadata(raw, unit, sourceMode, vehicleResult.endpoint, trackerInfo);

      // Plate: prefer from vehicle data, then tracker enrichment
      const plate = unit.plate
        || (trackerInfo ? pickPlate(trackerInfo) : null)
        || metadata.plate;

      const { data: upsertedUnit, error: upsertErr } = await supabase
        .from("provider_units")
        .upsert({
          tenant_id: account.tenant_id,
          integration_account_id,
          external_code: unit.external_code,
          external_id: unit.external_id,
          label: unit.name,
          active: true,
          metadata,
          updated_at: new Date().toISOString(),
        }, { onConflict: "tenant_id,integration_account_id,external_code", ignoreDuplicates: false })
        .select("id").single();

      if (upsertErr) {
        console.error(`[SSX:sync-units] Upsert failed for ${unit.external_code}: ${upsertErr.message}`);
        skippedCount++;
        continue;
      }
      upsertedCount++;

      if (plate && upsertedUnit) {
        // === DETERMINISTIC MATCHING: Find vehicle by exact normalized plate ===
        const normalizedPlate = plate.replace(/[\s.-]/g, "").toUpperCase();
        const { data: vehicleCandidates } = await supabase
          .from("vehicles").select("id, plate")
          .eq("tenant_id", account.tenant_id)
          .eq("active", true);

        const matchingVehicles = (vehicleCandidates || []).filter((v: any) =>
          v.plate.replace(/[\s.-]/g, "").toUpperCase() === normalizedPlate
        );

        if (matchingVehicles.length > 1) {
          mappingConflicts++;
          conflictDetails.push({
            unit_code: unit.external_code,
            reason: "ambiguous_plate_match",
            ssx_plate: plate,
          });
          console.warn(`[SSX:sync-units] MAPPING_CONFLICT: provider_unit ${unit.external_code} plate "${plate}" matches ${matchingVehicles.length} vehicles — skipping auto-link`);
          continue;
        }

        let vehicleId: string;
        if (matchingVehicles.length === 1) {
          vehicleId = matchingVehicles[0].id;
        } else {
          const { data: newVehicle, error: vErr } = await supabase
            .from("vehicles").insert({
              tenant_id: account.tenant_id, plate,
              nickname: unit.name || null, type: "truck",
            }).select("id").single();
          if (vErr || !newVehicle) {
            console.error(`[SSX:sync-units] Vehicle create failed for plate ${plate}: ${vErr?.message}`);
            continue;
          }
          vehicleId = newVehicle.id;
          vehiclesCreated++;
        }

        // === CHECK FOR EXISTING LINKS ===
        const { data: existingLink } = await supabase
          .from("vehicle_tracker_links").select("id, vehicle_id")
          .eq("tenant_id", account.tenant_id)
          .eq("provider_unit_id", upsertedUnit.id)
          .eq("active", true)
          .limit(1).maybeSingle();

        if (existingLink) {
          if (existingLink.vehicle_id !== vehicleId) {
            mappingConflicts++;
            const { data: linkedVehicle } = await supabase
              .from("vehicles").select("plate").eq("id", existingLink.vehicle_id).single();
            conflictDetails.push({
              unit_code: unit.external_code,
              reason: "mapping_conflict",
              linked_vehicle_plate: linkedVehicle?.plate || existingLink.vehicle_id,
              ssx_plate: plate,
            });
            console.warn(`[SSX:sync-units] MAPPING_CONFLICT: provider_unit ${unit.external_code} linked to vehicle ${linkedVehicle?.plate || existingLink.vehicle_id} but SSX plate is "${plate}" (vehicle ${vehicleId}) — NOT overwriting`);
          }
        } else {
          const { error: linkErr } = await supabase
            .from("vehicle_tracker_links").insert({
              tenant_id: account.tenant_id,
              vehicle_id: vehicleId,
              provider_unit_id: upsertedUnit.id,
              active: true,
            });
          if (linkErr) {
            console.error(`[SSX:sync-units] Link failed ${unit.external_code}→${plate}: ${linkErr.message}`);
          } else {
            linksCreated++;
            console.log(`[SSX:sync-units] Linked provider_unit ${unit.external_code} → vehicle ${plate} (${vehicleId})`);
          }
        }
      }
    }

    // ================================================================
    // PHASE 4: Save settings & log
    // ================================================================
    const updatedSettings = { ...settings };
    delete updatedSettings.sync_units_backoff_until;
    updatedSettings.sync_units_backoff_count = 0;
    updatedSettings.last_units_sync_at = new Date().toISOString();

    if (usedMethod === "administration") {
      if (vehicleResult.successfulFormat) {
        updatedSettings.admin_vehicle_last_successful_endpoint = vehicleResult.endpoint;
        updatedSettings.admin_vehicle_last_successful_format = vehicleResult.successfulFormat;
        updatedSettings.admin_vehicle_last_sync_at = new Date().toISOString();
      }
      if (trackerResult?.success && trackerResult.successfulFormat) {
        updatedSettings.admin_tracker_last_successful_endpoint = trackerResult.endpoint;
        updatedSettings.admin_tracker_last_successful_format = trackerResult.successfulFormat;
      }
      delete updatedSettings.skip_admin_until;
      delete updatedSettings.last_admin_error;
      delete updatedSettings.last_admin_attempt_matrix;
    }
    if (vehicleResult.endpoint) {
      updatedSettings.last_successful_endpoint = vehicleResult.endpoint;
      updatedSettings.last_successful_format = vehicleResult.successfulFormat || null;
    }

    await supabase.from("integration_accounts").update({
      settings: updatedSettings, status: "ok", last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", integration_account_id);

    await logIntegration(supabase, {
      tenant_id: account.tenant_id, integration_account_id,
      action: "ssx_sync_units", endpoint: vehicleResult.endpoint,
      status_code: vehicleResult.statusCode, success: true,
      duration_ms: duration,
      metadata: {
        method: usedMethod,
        source_mode: sourceMode,
        vehicle_endpoint_used: vehicleResult.endpoint,
        tracker_endpoint_used: trackerResult?.endpoint || null,
        vehicles_received: vehicleResult.items.length,
        trackers_received: trackerResult?.items?.length || 0,
        normalized_count: normalized.length,
        upserted: upsertedCount,
        skipped: skippedCount,
        vehicles_created: vehiclesCreated,
        links_created: linksCreated,
        mapping_conflicts: mappingConflicts,
        conflict_details: conflictDetails.length > 0 ? conflictDetails : undefined,
      },
    });

    return jsonResponse({
      success: true,
      method: usedMethod,
      source_mode: sourceMode,
      vehicle_endpoint_used: vehicleResult.endpoint,
      tracker_endpoint_used: trackerResult?.endpoint || null,
      vehicles_received: vehicleResult.items.length,
      normalized_count: normalized.length,
      upserted: upsertedCount,
      skipped: skippedCount,
      vehicles_created: vehiclesCreated,
      links_created: linksCreated,
      mapping_conflicts: mappingConflicts,
      conflict_details: conflictDetails.length > 0 ? conflictDetails : undefined,
    });

  } catch (err: any) {
    console.error("[SSX:sync-units] Unhandled error:", err);
    return jsonResponse({ error: "Internal error", details: err.message }, 500);
  }
});

// ==================== Tracker Enrichment Finder ====================

function findTrackerEnrichment(
  externalCode: string, plate: string | null, raw: any,
  byVehicleCode: Map<string, any>,
  byPlate: Map<string, any>,
  byTrackerCode: Map<string, any>,
): any | null {
  // Priority 1: Match by vehicle/tracked unit code
  if (byVehicleCode.has(externalCode)) return byVehicleCode.get(externalCode);

  // Priority 2: Match by normalized plate
  if (plate) {
    const normalizedPlate = plate.replace(/[\s.-]/g, "").toUpperCase();
    if (byPlate.has(normalizedPlate)) return byPlate.get(normalizedPlate);
  }

  // Priority 3: Match by tracker code (auxiliary only)
  const trackerCode = pickTrackerCodeFromVehicle(raw);
  if (trackerCode && byTrackerCode.has(trackerCode)) return byTrackerCode.get(trackerCode);

  return null;
}

// ==================== Rich Metadata Builder ====================

function buildUnitMetadata(
  raw: any, unit: NormalizedUnit, sourceMode: string, endpoint: string,
  trackerInfo: any | null,
): Record<string, any> {
  const pick = (keys: string[], obj: any = raw): string | null => {
    for (const k of keys) {
      const v = obj[k];
      if (v != null && v !== "" && typeof v !== "object") return String(v).trim();
    }
    return null;
  };

  const metadata: Record<string, any> = {
    // Vehicle/tracked unit identifiers
    vehicle_integration_code: pick(["VehicleIntegrationCode", "vehicleIntegrationCode"]),
    tracked_unit_integration_code: pick(["TrackedUnitIntegrationCode", "trackedUnitIntegrationCode"]),
    integration_code: pick(["IntegrationCode", "integrationCode"]),
    tracked_unit: pick(["TrackedUnit", "trackedUnit", "Description", "Name"]),

    // Tracker device identifiers
    tracker_integration_code: pick(["TrackerIntegrationCode", "trackerIntegrationCode"]),
    id_tracker: pick(["IdTracker", "idTracker", "TrackerId", "trackerId"]),
    id_tracked_unit: pick(["IdTrackedUnit", "idTrackedUnit"]),
    id_model_tracker: pick(["IdModelTracker", "idModelTracker"]),
    id_tracker_model: pick(["IdTrackerModel", "idTrackerModel"]),

    // Vehicle data
    plate: unit.plate || pick(["Plate", "plate", "LicensePlate", "VehiclePlate"]),
    imei: pick(["IMEI", "Imei", "imei"]),
    iccid1: pick(["ICCID1", "iccid1", "Iccid1"]),
    iccid2: pick(["ICCID2", "iccid2", "Iccid2"]),
    serial: pick(["SerialNumber", "serialNumber", "Serial"]),

    // Driver/person
    driver_id: pick(["DriverId", "driverId", "IdDriver", "idDriver"]),
    person_id: pick(["PersonId", "personId", "IdPerson", "idPerson"]),

    // Organizational
    organizational_unit_integration_code: pick(["OrganizationalUnitIntegrationCode", "organizationalUnitIntegrationCode"]),

    // Key type and provenance
    unit_key_type: unit.unit_key_type,
    source_mode: sourceMode,
    source_endpoint: endpoint,
    synced_at: new Date().toISOString(),
  };

  // Merge tracker enrichment data if available
  if (trackerInfo) {
    metadata.tracker_integration_code = metadata.tracker_integration_code
      || pick(["TrackerIntegrationCode", "trackerIntegrationCode", "IntegrationCode", "integrationCode"], trackerInfo);
    metadata.id_tracker = metadata.id_tracker
      || pick(["IdTracker", "idTracker", "TrackerId", "trackerId", "Id", "id"], trackerInfo);
    metadata.imei = metadata.imei || pick(["IMEI", "Imei", "imei"], trackerInfo);
    metadata.serial = metadata.serial || pick(["SerialNumber", "serialNumber", "Serial"], trackerInfo);
    metadata.id_model_tracker = metadata.id_model_tracker || pick(["IdModelTracker", "idModelTracker"], trackerInfo);
    metadata.id_tracker_model = metadata.id_tracker_model || pick(["IdTrackerModel", "idTrackerModel"], trackerInfo);
    metadata.iccid1 = metadata.iccid1 || pick(["ICCID1", "iccid1", "Iccid1"], trackerInfo);
    metadata.iccid2 = metadata.iccid2 || pick(["ICCID2", "iccid2", "Iccid2"], trackerInfo);
    metadata.tracker_enriched = true;
  }

  return metadata;
}

// ==================== Admin Vehicle Discovery (PRIMARY) ====================

async function tryAdminVehicleDiscovery(
  config: ReturnType<typeof readAccountConfig>,
  supabase: any,
  integrationAccountId: string,
): Promise<EndpointAttemptResult> {
  const adminTokenResult = await getAdminToken(config, supabase, integrationAccountId);
  const tokens: { label: string; token: string }[] = [];
  if (adminTokenResult.token) tokens.push({ label: "admin_token", token: adminTokenResult.token });
  if (config.token && config.token !== adminTokenResult.token) tokens.push({ label: "regular_token", token: config.token });

  const vehicleV2Urls = buildAdminUrlCandidates(config.baseUrl, config.apiVersion, "/Administration/Vehicle/v2/List");
  const vehicleV1Urls = buildAdminUrlCandidates(config.baseUrl, config.apiVersion, "/Administration/Vehicle/List");
  const allVehicleUrls = [...vehicleV2Urls, ...vehicleV1Urls];

  const allAttempts: AttemptLog[] = [];

  for (const { label, token } of tokens) {
    const result = await tryEndpointWithFallback({
      urlCandidates: allVehicleUrls,
      token,
      bodyCandidates: ADMIN_BODY_CANDIDATES,
      timeoutMs: config.requestTimeoutMs,
      memoEndpoint: config.settings.admin_vehicle_last_successful_endpoint,
      memoFormat: config.settings.admin_vehicle_last_successful_format,
      abortOnAuthError: false,
    });

    for (const attempt of result.attempts) {
      logSsxCall({
        routine: "sync-units", endpoint: attempt.endpoint, method: "POST",
        apiVersion: config.apiVersion, attemptType: `vehicle:${label}:${attempt.format}`,
        statusCode: attempt.statusCode, durationMs: attempt.durationMs,
        responsePreview: attempt.responsePreview,
        result: attempt.itemCount > 0 ? "success" : "error",
        errorClass: attempt.errorClass,
      });
    }
    allAttempts.push(...result.attempts);

    if (result.errorClass === "rate_limited") return { ...result, attempts: allAttempts };
    if (result.success && result.items.length > 0) return { ...result, attempts: allAttempts };
  }

  const finalErrorClass = deriveDominantError(allAttempts);
  return {
    success: false, items: [],
    endpoint: allVehicleUrls[0] || "",
    statusCode: allAttempts.length > 0 ? allAttempts[allAttempts.length - 1].statusCode : 0,
    errorClass: finalErrorClass.errorClass,
    errorMessage: finalErrorClass.message,
    successfulFormat: null,
    attempts: allAttempts,
  };
}

// ==================== Admin Tracker Discovery (ENRICHMENT ONLY) ====================

async function tryAdminTrackerDiscovery(
  config: ReturnType<typeof readAccountConfig>,
  supabase: any,
  integrationAccountId: string,
): Promise<EndpointAttemptResult> {
  const allAttempts: AttemptLog[] = [];
  const trackerUrls = buildAdminUrlCandidates(config.baseUrl, config.apiVersion, "/Administration/Tracker/List");
  const tokens: { label: string; token: string }[] = [];

  const adminTokenResult = await getAdminToken(config, supabase, integrationAccountId);
  if (adminTokenResult.token) {
    tokens.push({ label: "admin_token", token: adminTokenResult.token });
  }
  if (config.token && config.token !== adminTokenResult.token) {
    tokens.push({ label: "regular_token", token: config.token });
  }

  for (const { label, token } of tokens) {
    const result = await tryEndpointWithFallback({
      urlCandidates: trackerUrls,
      token,
      bodyCandidates: ADMIN_BODY_CANDIDATES,
      timeoutMs: config.requestTimeoutMs,
      memoEndpoint: config.settings.admin_tracker_last_successful_endpoint,
      memoFormat: config.settings.admin_tracker_last_successful_format,
      abortOnAuthError: false,
    });

    for (const attempt of result.attempts) {
      logSsxCall({
        routine: "sync-units", endpoint: attempt.endpoint, method: "POST",
        apiVersion: config.apiVersion, attemptType: `tracker_enrich:${label}:${attempt.format}`,
        statusCode: attempt.statusCode, durationMs: attempt.durationMs,
        responsePreview: attempt.responsePreview,
        result: attempt.itemCount > 0 ? "success" : "error",
        errorClass: attempt.errorClass,
      });
    }
    allAttempts.push(...result.attempts);

    if (result.errorClass === "rate_limited") return { ...result, attempts: allAttempts };
    if (result.success && result.items.length > 0) return { ...result, attempts: allAttempts };
  }

  const finalErrorClass = deriveDominantError(allAttempts);
  return {
    success: false, items: [],
    endpoint: trackerUrls[0] || "",
    statusCode: allAttempts.length > 0 ? allAttempts[allAttempts.length - 1].statusCode : 0,
    errorClass: finalErrorClass.errorClass,
    errorMessage: finalErrorClass.message,
    successfulFormat: null,
    attempts: allAttempts,
  };
}

// ==================== Tracking-Based Fallback ====================

async function fetchUnitsTrackingFallback(config: ReturnType<typeof readAccountConfig>): Promise<EndpointAttemptResult> {
  const allAttempts: AttemptLog[] = [];

  // Skip TrackedUnit/List — not reliable across providers
  // Go directly to PositionHistory as fallback
  const posHistUrls = buildSsxUrlCandidates(config.baseUrl, config.apiVersion, "/Tracking/PositionHistory/List");
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const timeFilterProp = config.settings.time_filter_property || "EventDate";
  const filters = [{ PropertyName: timeFilterProp, Condition: ">=", Value: since }];
  const filtersAlt = [{ PropertyName: "DateTimeGPS", Condition: ">=", Value: since }];

  const posBodyCandidates: { label: string; body: any }[] = [
    { label: "position_array_filters", body: filters },
    { label: "position_wrapped_filters", body: { Filters: filters } },
    { label: "position_array_alt_time", body: filtersAlt },
    { label: "position_wrapped_alt_time", body: { Filters: filtersAlt } },
  ];

  const posResult = await tryEndpointWithFallback({
    urlCandidates: posHistUrls,
    token: config.token,
    bodyCandidates: posBodyCandidates,
    timeoutMs: config.requestTimeoutMs,
    abortOnAuthError: true,
  });
  allAttempts.push(...posResult.attempts);

  if (posResult.errorClass === "rate_limited") return { ...posResult, attempts: allAttempts };
  if (posResult.success && posResult.items.length > 0) {
    return { ...posResult, endpoint: `${posResult.endpoint} (fallback 60m)`, attempts: allAttempts };
  }

  const finalError = deriveDominantError(allAttempts);
  return {
    success: false, items: [],
    endpoint: posHistUrls[0] || "",
    statusCode: allAttempts.length > 0 ? allAttempts[allAttempts.length - 1].statusCode : 0,
    errorClass: finalError.errorClass,
    errorMessage: "No units found in tracking fallback",
    successfulFormat: null,
    attempts: allAttempts,
  };
}

// ==================== Error Classification ====================

function deriveDominantError(attempts: AttemptLog[]): { errorClass: SsxErrorClass; message: string } {
  if (attempts.length === 0) return { errorClass: "unknown", message: "No attempts made" };
  const classes = new Set(attempts.map(a => a.errorClass));
  if (classes.has("empty_response") && attempts.every(a => a.errorClass === "empty_response")) {
    return { errorClass: "empty_response", message: "All endpoints returned empty list" };
  }
  if (classes.has("route_not_found")) return { errorClass: "route_not_found", message: "Endpoint(s) returned 404" };
  if (classes.has("body_incompatible")) return { errorClass: "body_incompatible", message: "All body formats rejected (400/415)" };
  if (classes.has("auth_error")) return { errorClass: "auth_error", message: "Authentication failed (401/403)" };
  if (classes.has("timeout") || classes.has("network_error")) return { errorClass: classes.has("timeout") ? "timeout" : "network_error", message: "Network/timeout error" };
  if (classes.has("server_error")) return { errorClass: "server_error", message: "Server error (5xx)" };
  return { errorClass: "unknown", message: "All attempts failed" };
}

// ==================== 429 Handler ====================

async function handle429(
  supabase: any, account: any, settings: Record<string, any>,
  integration_account_id: string, result: EndpointAttemptResult, durationMs: number,
): Promise<Response> {
  const count = settings.sync_units_backoff_count || 0;
  const tier = Math.min(count, BACKOFF_TIERS_MS.length - 1);
  const backoffMs = BACKOFF_TIERS_MS[tier];
  const newBackoffUntil = new Date(Date.now() + backoffMs).toISOString();

  await supabase.from("integration_accounts").update({
    settings: { ...settings, sync_units_backoff_until: newBackoffUntil, sync_units_backoff_count: count + 1 },
    status: "degraded",
    last_error: `Rate limit (429). Retry after ${newBackoffUntil}`,
    updated_at: new Date().toISOString(),
  }).eq("id", integration_account_id);

  await logIntegration(supabase, {
    tenant_id: account.tenant_id, integration_account_id,
    action: "ssx_sync_units", endpoint: result.endpoint,
    status_code: 429, success: false,
    error_message: `Rate limit. Backoff until ${newBackoffUntil} (tier ${tier})`,
    duration_ms: durationMs,
    metadata: { backoff_until: newBackoffUntil, backoff_tier: tier },
  });

  return jsonResponse({
    error: "Limite de consultas SSX excedido. Aguarde alguns minutos e tente novamente.",
    retry_after_seconds: Math.ceil(backoffMs / 1000),
    retry_at: newBackoffUntil,
    cooldown_active: true,
  }, 429);
}

// ==================== Response Helper ====================

function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
