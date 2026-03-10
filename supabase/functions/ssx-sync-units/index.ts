/**
 * ssx-sync-units — Discovers trackers and vehicles from the SSX API.
 *
 * STRATEGY:
 * 1. Administration API is the PRIMARY source (Tracker/List, Vehicle/List).
 * 2. If Administration fails completely, MINIMAL fallback to TrackedUnit/List + PositionHistory.
 * 3. Fallback results are marked source_mode="tracking_fallback".
 * 4. Upserts are idempotent — no duplicates, no destructive deletes on partial failure.
 * 5. Now stores rich metadata on provider_units for per-unit polling.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  buildAdminUrlCandidates,
  buildSsxUrlCandidates,
  readAccountConfig,
  extractResponseItems,
  normalizeTrackerItem,
  pickTrackerCodeFromVehicle,
  pickPlate,
  tryEndpointWithFallback,
  getAdminToken,
  ADMIN_BODY_CANDIDATES,
  TRACKING_BODY_CANDIDATES,
  ssxPost,
  logIntegration,
  logSsxCall,
  summarizeAttemptMatrix,
  sanitize,
  getTenantRole,
  classifyError,
  isRetryable,
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

    const cronSecret = req.headers.get("x-agvlog-cron-secret");
    const expectedCronSecret = Deno.env.get("AGVLOG_CRON_SECRET");
    const isCron = !!(cronSecret && expectedCronSecret && cronSecret === expectedCronSecret);

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
    // PHASE 1: Administration API — PRIMARY source for tracker catalog
    // ================================================================

    const skipAdminUntil = settings.skip_admin_until;
    const adminSkipped = !force && skipAdminUntil && new Date(skipAdminUntil).getTime() > Date.now();
    let usedMethod = "administration";

    let trackerResult: EndpointAttemptResult;
    let vehicleResult: EndpointAttemptResult | null = null;

    if (adminSkipped) {
      console.log(`[SSX:sync-units] Admin skipped until ${skipAdminUntil}`);
      trackerResult = {
        success: false, items: [], endpoint: "", statusCode: 0,
        errorClass: "unknown", errorMessage: "Admin temporarily skipped",
        successfulFormat: null, attempts: [],
      };
    } else {
      trackerResult = await tryAdminTrackerDiscovery(config, supabase, integration_account_id);
      if (trackerResult.errorClass === "rate_limited") {
        return await handle429(supabase, account, settings, integration_account_id, trackerResult, Date.now() - startTime);
      }
    }

    // --- Vehicle List (only if trackers succeeded) ---
    if (trackerResult.success && trackerResult.items.length > 0) {
      vehicleResult = await tryAdminVehicleDiscovery(config, supabase, integration_account_id);
      if (!vehicleResult.success) {
        console.log(`[SSX:sync-units] Vehicle enrichment failed (${vehicleResult.errorClass}), continuing with trackers only`);
      }
    }

    // ================================================================
    // PHASE 1b: If Administration failed, try fallback
    // ================================================================
    if (!trackerResult.success || trackerResult.items.length === 0) {
      if (!adminSkipped && trackerResult.errorClass !== "rate_limited") {
        const skipUntil = new Date(Date.now() + ADMIN_SKIP_MS).toISOString();
        const lastAdminError = `${trackerResult.errorClass}: ${trackerResult.errorMessage || "unknown"}`;
        settings.skip_admin_until = skipUntil;
        settings.last_admin_error = lastAdminError;
        settings.last_admin_attempt_matrix = summarizeAttemptMatrix(trackerResult.attempts);
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
          error_message: `All discovery methods failed. Admin: ${trackerResult.errorClass}. Legacy: ${legacyResult.errorClass}`,
          duration_ms: Date.now() - startTime,
          metadata: {
            method: "all_failed",
            admin_error_class: trackerResult.errorClass,
            legacy_error_class: legacyResult.errorClass,
          },
        });
        await supabase.from("integration_accounts").update({
          status: "sync_inconclusive",
          last_error: `Sync failed: admin=${trackerResult.errorClass}, legacy=${legacyResult.errorClass}`,
          updated_at: new Date().toISOString(),
        }).eq("id", integration_account_id);

        return jsonResponse({
          error: "SSX unit sync failed",
          admin_error: trackerResult.errorClass,
          legacy_error: legacyResult.errorClass,
        }, 502);
      }

      trackerResult = legacyResult;
    }

    const duration = Date.now() - startTime;

    // ================================================================
    // PHASE 2: Normalize, deduplicate, and extract rich metadata
    // ================================================================
    const sourceMode = usedMethod === "administration" ? "admin_catalog" : "tracking_fallback";
    const normalized: (NormalizedUnit & { raw_item: any })[] = [];
    const seenCodes = new Set<string>();

    for (const raw of trackerResult.items) {
      const unit = normalizeTrackerItem(raw, trackerResult.endpoint, sourceMode as any);
      if (!unit || seenCodes.has(unit.external_code)) continue;
      seenCodes.add(unit.external_code);
      normalized.push({ ...unit, raw_item: raw });
    }

    // Build vehicle enrichment map
    const vehiclePlateByTrackerCode = new Map<string, string>();
    if (vehicleResult?.success && vehicleResult.items.length > 0) {
      for (const v of vehicleResult.items) {
        const plate = pickPlate(v);
        const tCode = pickTrackerCodeFromVehicle(v);
        if (plate && tCode) vehiclePlateByTrackerCode.set(tCode, plate);
      }
    }

    // ================================================================
    // PHASE 3: Idempotent upsert with rich metadata
    // ================================================================
  let upsertedCount = 0, skippedCount = 0, vehiclesCreated = 0, linksCreated = 0;
  let mappingConflicts = 0;
  const conflictDetails: { unit_code: string; reason: string; linked_vehicle_plate?: string; ssx_plate?: string }[] = [];

  for (const unit of normalized) {
    const plate = vehiclePlateByTrackerCode.get(unit.external_code) || unit.plate;
    const raw = unit.raw_item;

    // Build rich metadata from the raw SSX item
    const metadata = buildUnitMetadata(raw, unit, sourceMode, trackerResult.endpoint);

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
      const normalizedPlate = plate.replace(/[\s\-\.]/g, "").toUpperCase();
      const { data: vehicleCandidates } = await supabase
        .from("vehicles").select("id, plate")
        .eq("tenant_id", account.tenant_id)
        .eq("active", true);

      // Find exact plate match (normalized)
      const matchingVehicles = (vehicleCandidates || []).filter((v: any) =>
        v.plate.replace(/[\s\-\.]/g, "").toUpperCase() === normalizedPlate
      );

      if (matchingVehicles.length > 1) {
        // AMBIGUOUS: multiple vehicles match the same plate — do NOT auto-link
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
        // No existing vehicle — create one
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

      // === CHECK FOR EXISTING LINKS — detect mapping conflicts ===
      const { data: existingLink } = await supabase
        .from("vehicle_tracker_links").select("id, vehicle_id")
        .eq("tenant_id", account.tenant_id)
        .eq("provider_unit_id", upsertedUnit.id)
        .eq("active", true)
        .limit(1).maybeSingle();

      if (existingLink) {
        if (existingLink.vehicle_id !== vehicleId) {
          // CONFLICT: provider_unit is linked to a different vehicle than what SSX says
          // Do NOT silently overwrite — log and skip
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
        // Either matches or conflict — don't create a new link
      } else {
        // No active link exists — safe to create
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

    if (usedMethod === "administration" && trackerResult.successfulFormat) {
      updatedSettings.admin_units_last_successful_endpoint = trackerResult.endpoint;
      updatedSettings.admin_units_last_successful_format = trackerResult.successfulFormat;
      updatedSettings.admin_units_last_sync_at = new Date().toISOString();
      delete updatedSettings.skip_admin_until;
      delete updatedSettings.last_admin_error;
      delete updatedSettings.last_admin_attempt_matrix;
    }
    if (vehicleResult?.success && vehicleResult.successfulFormat) {
      updatedSettings.admin_vehicle_last_successful_endpoint = vehicleResult.endpoint;
      updatedSettings.admin_vehicle_last_successful_format = vehicleResult.successfulFormat;
    }
    if (trackerResult.endpoint) {
      updatedSettings.last_successful_endpoint = trackerResult.endpoint;
      updatedSettings.last_successful_format = trackerResult.successfulFormat || null;
    }

    await supabase.from("integration_accounts").update({
      settings: updatedSettings, status: "ok", last_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", integration_account_id);

    await logIntegration(supabase, {
      tenant_id: account.tenant_id, integration_account_id,
      action: "ssx_sync_units", endpoint: trackerResult.endpoint,
      status_code: trackerResult.statusCode, success: true,
      duration_ms: duration,
      metadata: {
        method: usedMethod,
        source_mode: sourceMode,
        tracker_endpoint_used: trackerResult.endpoint,
        vehicle_endpoint_used: vehicleResult?.endpoint || null,
        trackers_received: trackerResult.items.length,
        vehicles_received: vehicleResult?.items?.length || 0,
        normalized_count: normalized.length,
        upserted: upsertedCount,
        skipped: skippedCount,
        vehicles_created: vehiclesCreated,
        links_created: linksCreated,
      },
    });

    return jsonResponse({
      success: true,
      method: usedMethod,
      source_mode: sourceMode,
      tracker_endpoint_used: trackerResult.endpoint,
      vehicle_endpoint_used: vehicleResult?.endpoint || null,
      trackers_received: trackerResult.items.length,
      normalized_count: normalized.length,
      upserted: upsertedCount,
      skipped: skippedCount,
      vehicles_created: vehiclesCreated,
      links_created: linksCreated,
    });

  } catch (err: any) {
    console.error("[SSX:sync-units] Unhandled error:", err);
    return jsonResponse({ error: "Internal error", details: err.message }, 500);
  }
});

// ==================== Rich Metadata Builder ====================

function buildUnitMetadata(
  raw: any, unit: NormalizedUnit, sourceMode: string, endpoint: string,
): Record<string, any> {
  const pick = (keys: string[]): string | null => {
    for (const k of keys) {
      const v = raw[k];
      if (v != null && v !== "" && typeof v !== "object") return String(v).trim();
    }
    return null;
  };

  return {
    tracked_unit_integration_code: pick(["TrackedUnitIntegrationCode", "trackedUnitIntegrationCode"]),
    tracked_unit: pick(["TrackedUnit", "trackedUnit", "Description", "Name"]),
    tracker_integration_code: pick(["TrackerIntegrationCode", "trackerIntegrationCode"]),
    integration_code: pick(["IntegrationCode", "integrationCode"]),
    id_tracker: pick(["IdTracker", "idTracker", "TrackerId", "trackerId"]),
    id_tracked_unit: pick(["IdTrackedUnit", "idTrackedUnit"]),
    imei: pick(["IMEI", "Imei", "imei"]),
    plate: unit.plate || pick(["Plate", "plate", "LicensePlate", "VehiclePlate"]),
    serial: pick(["SerialNumber", "serialNumber", "Serial"]),
    source_mode: sourceMode,
    tracker_endpoint_used: endpoint,
    synced_at: new Date().toISOString(),
  };
}

// ==================== Admin Tracker Discovery ====================

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
      memoEndpoint: config.settings.admin_units_last_successful_endpoint,
      memoFormat: config.settings.admin_units_last_successful_format,
      abortOnAuthError: false,
    });

    for (const attempt of result.attempts) {
      logSsxCall({
        routine: "sync-units", endpoint: attempt.endpoint, method: "POST",
        apiVersion: config.apiVersion, attemptType: `tracker:${label}:${attempt.format}`,
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

// ==================== Admin Vehicle Discovery ====================

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

// ==================== Tracking-Based Fallback ====================

async function fetchUnitsTrackingFallback(config: ReturnType<typeof readAccountConfig>): Promise<EndpointAttemptResult> {
  const allAttempts: AttemptLog[] = [];

  const trackedUrls = buildSsxUrlCandidates(config.baseUrl, config.apiVersion, "/Tracking/TrackedUnit/List");
  const trackedResult = await tryEndpointWithFallback({
    urlCandidates: trackedUrls,
    token: config.token,
    bodyCandidates: TRACKING_BODY_CANDIDATES,
    timeoutMs: config.requestTimeoutMs,
    abortOnAuthError: true,
  });
  allAttempts.push(...trackedResult.attempts);

  if (trackedResult.errorClass === "rate_limited") return { ...trackedResult, attempts: allAttempts };
  if (trackedResult.success && trackedResult.items.length > 0) return { ...trackedResult, attempts: allAttempts };

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
    endpoint: trackedUrls[0] || "",
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
