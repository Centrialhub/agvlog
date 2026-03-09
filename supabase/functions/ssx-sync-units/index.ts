import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-agvlog-cron-secret",
};

const BACKOFF_TIERS_MS = [2 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];
const CACHE_TTL_MS = 60 * 60_000; // 1 hour

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
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await anonClient.auth.getUser();
      if (userError || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      callerId = userData.user.id;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json();
    const { integration_account_id, force } = body;
    if (!integration_account_id) {
      return new Response(
        JSON.stringify({ error: "integration_account_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: account, error: accErr } = await supabase
      .from("integration_accounts").select("*").eq("id", integration_account_id).single();
    if (accErr || !account) {
      return new Response(JSON.stringify({ error: "Integration account not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!isCron && callerId) {
      const { data: membership } = await supabase
        .from("tenant_memberships").select("role")
        .eq("tenant_id", account.tenant_id).eq("user_id", callerId).eq("active", true).single();
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return new Response(JSON.stringify({ error: "Forbidden: admin role required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const settings = (account.settings || {}) as Record<string, any>;

    // Backoff check
    const backoffUntil = settings.sync_units_backoff_until;
    if (backoffUntil) {
      const remainingMs = new Date(backoffUntil).getTime() - Date.now();
      if (remainingMs > 0) {
        return new Response(JSON.stringify({
          error: "Limite de consultas SSX excedido. Aguarde e tente novamente.",
          retry_after_seconds: Math.ceil(remainingMs / 1000),
          retry_at: backoffUntil, cooldown_active: true,
        }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Cache check
    const lastSyncAt = settings.last_units_sync_at;
    if (!force && lastSyncAt) {
      const elapsed = Date.now() - new Date(lastSyncAt).getTime();
      if (elapsed < CACHE_TTL_MS) {
        return new Response(JSON.stringify({
          success: true, skipped: true, reason: "Units synced recently",
          last_sync_at: lastSyncAt,
          next_sync_available_at: new Date(new Date(lastSyncAt).getTime() + CACHE_TTL_MS).toISOString(),
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Token check
    const token = account.token_cache;
    if (!token || !account.token_expires_at || new Date(account.token_expires_at).getTime() - Date.now() < 60000) {
      return new Response(JSON.stringify({ error: "Token expired or missing. Run ssx-login first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const baseUrl = account.base_url.replace(/\/$/, "");
    const apiVersion = settings.api_version || "v3";
    const startTime = Date.now();

    // ===== PHASE 1: Administration-first fetch (skip if recently failed) =====
    const skipAdminUntil = settings.skip_admin_until;
    const adminSkipped = skipAdminUntil && new Date(skipAdminUntil).getTime() > Date.now();

    let trackerResult: AdminFetchResult;
    let vehicleResult: AdminFetchResult | null = null;
    let usedMethod = "administration";

    if (adminSkipped) {
      console.log("Skipping Administration endpoints (skip_admin_until active)");
      trackerResult = { success: false, endpoint: "", status_code: 0, items: [], error_message: "Admin skipped", attempted_endpoints: [], attempted_formats: [] };
    } else {
      trackerResult = await fetchAdministrationTrackers({ baseUrl, token, settings });
    }

    // If Administration trackers worked, also try vehicles
    if (trackerResult.success && trackerResult.items.length > 0) {
      vehicleResult = await fetchAdministrationVehicles({ baseUrl, token, settings });
    }

    // If Administration didn't work, fall back to legacy
    if (!trackerResult.success || trackerResult.items.length === 0) {
      if (trackerResult.status_code === 429) {
        return handle429(supabase, account, settings, integration_account_id, trackerResult, Date.now() - startTime);
      }

      // Remember admin failure for 24h if it was 404/not available
      if (!adminSkipped && trackerResult.status_code !== 429) {
        const skipUntil = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
        await supabase.from("integration_accounts").update({
          settings: { ...settings, skip_admin_until: skipUntil },
          updated_at: new Date().toISOString(),
        }).eq("id", integration_account_id);
        settings.skip_admin_until = skipUntil;
      }

      console.log("Administration fetch failed/empty, falling back to legacy TrackedUnit/PositionHistory...");
      usedMethod = "legacy_fallback";
      const legacyResult = await fetchUnitsLegacyFallback({ baseUrl, apiVersion, token, settings });

      if (!legacyResult.success) {
        if (legacyResult.status_code === 429) {
          return handle429(supabase, account, settings, integration_account_id, legacyResult, Date.now() - startTime);
        }
        await logIntegration(supabase, {
          tenant_id: account.tenant_id, integration_account_id,
          action: "ssx_sync_units", endpoint: legacyResult.endpoint,
          status_code: legacyResult.status_code, success: false,
          error_message: legacyResult.error_message, duration_ms: Date.now() - startTime,
          metadata: {
            method: "all_failed",
            attempted_endpoints_trackers: trackerResult.attempted_endpoints,
            attempted_formats_trackers: trackerResult.attempted_formats,
            attempted_endpoints_legacy: legacyResult.attempted_endpoints,
            attempted_formats_legacy: legacyResult.attempted_formats,
          },
        });
        return new Response(JSON.stringify({
          error: "SSX unit sync failed", status_code: legacyResult.status_code,
          details: legacyResult.error_message,
          attempted_endpoints_trackers: trackerResult.attempted_endpoints,
          attempted_endpoints_legacy: legacyResult.attempted_endpoints,
        }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Legacy succeeded — use those items
      trackerResult = { ...legacyResult, success: true };
    }

    const duration = Date.now() - startTime;

    // ===== PHASE 2: Build vehicle enrichment map =====
    const vehiclePlateByTrackerCode = new Map<string, string>();
    if (vehicleResult?.success && vehicleResult.items.length > 0) {
      for (const v of vehicleResult.items) {
        const plate = pickPlate(v);
        const tCode = pickTrackerCodeFromVehicle(v);
        if (plate && tCode) {
          vehiclePlateByTrackerCode.set(tCode, plate);
        }
      }
    }

    // ===== PHASE 3: Upsert provider_units, vehicles, links =====
    let upsertedCount = 0, skippedCount = 0, vehiclesCreated = 0, linksCreated = 0;
    const seenCodes = new Set<string>();
    const sampleTrackerKeys = trackerResult.items.length > 0 ? Object.keys(trackerResult.items[0]) : [];

    for (const item of trackerResult.items) {
      const externalCode = pickExternalCode(item);
      if (!externalCode || seenCodes.has(externalCode)) { skippedCount++; continue; }
      seenCodes.add(externalCode);

      const externalId = String(item.Id || item.id || "").trim() || null;
      const label = (item.Description || item.Name || item.Model || item.TrackerModel || item.name || item.description || "").trim() || null;
      // Plate: from vehicle enrichment or from tracker item itself
      const plate = vehiclePlateByTrackerCode.get(externalCode) || pickPlate(item);

      const { data: upsertedUnit, error: upsertErr } = await supabase
        .from("provider_units")
        .upsert({
          tenant_id: account.tenant_id, integration_account_id,
          external_code: externalCode, external_id: externalId,
          label, active: true, updated_at: new Date().toISOString(),
        }, { onConflict: "tenant_id,integration_account_id,external_code", ignoreDuplicates: false })
        .select("id").single();

      if (upsertErr) { console.error(`Upsert failed for ${externalCode}:`, upsertErr.message); skippedCount++; continue; }
      upsertedCount++;

      if (plate && upsertedUnit) {
        const { data: existingVehicle } = await supabase
          .from("vehicles").select("id").eq("tenant_id", account.tenant_id).eq("plate", plate).limit(1).maybeSingle();

        let vehicleId: string;
        if (existingVehicle) {
          vehicleId = existingVehicle.id;
        } else {
          const { data: newVehicle, error: vErr } = await supabase
            .from("vehicles").insert({ tenant_id: account.tenant_id, plate, nickname: label || null, type: "truck" })
            .select("id").single();
          if (vErr || !newVehicle) { console.error(`Failed to create vehicle for plate ${plate}:`, vErr?.message); continue; }
          vehicleId = newVehicle.id;
          vehiclesCreated++;
        }

        const { data: existingLink } = await supabase
          .from("vehicle_tracker_links").select("id")
          .eq("tenant_id", account.tenant_id).eq("provider_unit_id", upsertedUnit.id).eq("active", true)
          .limit(1).maybeSingle();

        if (!existingLink) {
          const { error: linkErr } = await supabase
            .from("vehicle_tracker_links").insert({
              tenant_id: account.tenant_id, vehicle_id: vehicleId,
              provider_unit_id: upsertedUnit.id, active: true,
            });
          if (linkErr) { console.error(`Failed to link ${externalCode} to ${plate}:`, linkErr.message); }
          else { linksCreated++; }
        }
      }
    }

    // ===== PHASE 4: Quick validation (up to 3 units) =====
    const validationResults: { code: string; valid: boolean }[] = [];
    if (upsertedCount > 0 && usedMethod === "administration") {
      const codesToValidate = Array.from(seenCodes).slice(0, 3);
      const versionPrefix = apiVersion && apiVersion !== "v1" ? `/${apiVersion}` : "";
      const posHistEndpoint = `${baseUrl}${versionPrefix}/Tracking/PositionHistory/List`;

      for (const code of codesToValidate) {
        try {
          const filters = [{ PropertyName: "TrackedUnit", Condition: "Equal", Value: code }];
          let resp = await safePostJson(posHistEndpoint, token, filters);
          if (!resp.ok && (resp.status === 400 || resp.status === 415)) {
            resp = await safePostJson(posHistEndpoint, token, { Filters: filters });
          }
          if (resp.status === 429) break; // stop validation on rate limit
          const items = resp.ok ? extractItems(resp.parsed) : [];
          validationResults.push({ code, valid: items.length > 0 });
        } catch { validationResults.push({ code, valid: false }); }
      }
    }

    // ===== Save settings & log =====
    const clearedSettings = { ...settings };
    delete clearedSettings.sync_units_backoff_until;
    clearedSettings.sync_units_backoff_count = 0;
    clearedSettings.last_units_sync_at = new Date().toISOString();
    if (trackerResult.endpoint) {
      clearedSettings.admin_units_last_successful_endpoint = trackerResult.endpoint;
      clearedSettings.admin_units_last_successful_format = trackerResult.successful_format || null;
      clearedSettings.admin_units_last_sync_at = new Date().toISOString();
      // Also save as generic last_successful for legacy compat
      clearedSettings.last_successful_endpoint = trackerResult.endpoint;
      clearedSettings.last_successful_format = trackerResult.successful_format || null;
    }
    if (vehicleResult?.success && vehicleResult.endpoint) {
      clearedSettings.admin_vehicle_last_successful_endpoint = vehicleResult.endpoint;
      clearedSettings.admin_vehicle_last_successful_format = vehicleResult.successful_format || null;
    }

    await supabase.from("integration_accounts").update({
      settings: clearedSettings, status: "ok", last_error: null, updated_at: new Date().toISOString(),
    }).eq("id", integration_account_id);

    const sampleVehicleKeys = vehicleResult?.items?.length ? Object.keys(vehicleResult.items[0]) : [];

    await logIntegration(supabase, {
      tenant_id: account.tenant_id, integration_account_id,
      action: "ssx_sync_units", endpoint: trackerResult.endpoint,
      status_code: trackerResult.status_code, success: true, duration_ms: duration,
      metadata: {
        method: usedMethod,
        attempted_endpoints_trackers: trackerResult.attempted_endpoints,
        attempted_formats_trackers: trackerResult.attempted_formats,
        attempted_endpoints_vehicles: vehicleResult?.attempted_endpoints || [],
        attempted_formats_vehicles: vehicleResult?.attempted_formats || [],
        tracker_endpoint_used: trackerResult.endpoint,
        vehicle_endpoint_used: vehicleResult?.endpoint || null,
        sample_tracker_keys: sampleTrackerKeys.slice(0, 15),
        sample_vehicle_keys: sampleVehicleKeys.slice(0, 15),
        trackers_received: trackerResult.items.length,
        vehicles_received: vehicleResult?.items?.length || 0,
        upserted: upsertedCount, skipped: skippedCount,
        vehicles_created: vehiclesCreated, links_created: linksCreated,
        vehicle_plate_mappings: vehiclePlateByTrackerCode.size,
        validation: validationResults,
      },
    });

    return new Response(JSON.stringify({
      success: true, method: usedMethod,
      tracker_endpoint_used: trackerResult.endpoint,
      vehicle_endpoint_used: vehicleResult?.endpoint || null,
      trackers_received: trackerResult.items.length,
      vehicles_received: vehicleResult?.items?.length || 0,
      upserted: upsertedCount, skipped: skippedCount,
      vehicles_created: vehiclesCreated, links_created: linksCreated,
      mapping_notes: `vehicle->tracker link success: ${linksCreated}/${vehiclePlateByTrackerCode.size}`,
      validation: validationResults,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err: any) {
    console.error("ssx-sync-units error:", err);
    return new Response(JSON.stringify({ error: "Internal error", details: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// ==================== Types ====================

type AdminFetchResult = {
  success: boolean;
  endpoint: string;
  status_code: number;
  items: any[];
  error_message?: string;
  attempted_endpoints: string[];
  attempted_formats: string[];
  successful_format?: string;
};

// ==================== Administration Tracker Fetch ====================

const ADMIN_CANDIDATE_BODIES: { label: string; body: any | null }[] = [
  { label: "empty_array", body: [] },
  { label: "empty_obj", body: {} },
  { label: "ListRequest_PascalCase", body: { Page: 1, PageSize: 5000, Filters: [] } },
];

async function fetchAdministrationTrackers(params: {
  baseUrl: string; token: string; settings: Record<string, any>;
}): Promise<AdminFetchResult> {
  const { baseUrl, token, settings } = params;
  const attemptedEndpoints: string[] = [];
  const attemptedFormats: string[] = [];
  const apiVersion = settings.api_version || "v3";

  // Try memoized first
  const memoEndpoint = settings.admin_units_last_successful_endpoint;
  const memoFormat = settings.admin_units_last_successful_format;
  if (memoEndpoint && memoFormat && memoEndpoint.includes("/Administration/")) {
    const result = await tryAdminEndpointWithBody(memoEndpoint, memoFormat, token, attemptedEndpoints, attemptedFormats);
    if (result) return result;
  }

  const endpoints = [
    `${baseUrl}/${apiVersion}/Administration/Tracker/List`,
    `${baseUrl}/Administration/Tracker/List`,
    `${baseUrl}/v1/Administration/Tracker/List`,
  ];

  for (const endpoint of endpoints) {
    if (attemptedEndpoints.includes(endpoint)) continue;
    for (const candidate of ADMIN_CANDIDATE_BODIES) {
      attemptedEndpoints.push(endpoint);
      attemptedFormats.push(`${endpoint}:${candidate.label}`);

      const resp = candidate.body === null
        ? await safePostNoBody(endpoint, token)
        : await safePostJson(endpoint, token, candidate.body);

      if (resp.networkError) continue;
      if (resp.status === 429) {
        return { success: false, endpoint, status_code: 429, items: [], error_message: "Rate limit", attempted_endpoints: attemptedEndpoints, attempted_formats: attemptedFormats };
      }
      if (resp.ok) {
        const items = extractItemsExtended(resp.parsed);
        if (items.length > 0) {
          return { success: true, endpoint, status_code: resp.status, items, attempted_endpoints: attemptedEndpoints, attempted_formats: attemptedFormats, successful_format: candidate.label };
        }
      }
      // 404 = try next endpoint, other body errors = try next body
      if (resp.status === 404) break;
    }
  }

  return { success: false, endpoint: endpoints[0], status_code: 404, items: [], error_message: "Administration/Tracker/List not available", attempted_endpoints: attemptedEndpoints, attempted_formats: attemptedFormats };
}

// ==================== Administration Vehicle Fetch ====================

async function fetchAdministrationVehicles(params: {
  baseUrl: string; token: string; settings: Record<string, any>;
}): Promise<AdminFetchResult> {
  const { baseUrl, token, settings } = params;
  const attemptedEndpoints: string[] = [];
  const attemptedFormats: string[] = [];
  const apiVersion = settings.api_version || "v3";

  // Try memoized first
  const memoEndpoint = settings.admin_vehicle_last_successful_endpoint;
  const memoFormat = settings.admin_vehicle_last_successful_format;
  if (memoEndpoint && memoFormat) {
    const result = await tryAdminEndpointWithBody(memoEndpoint, memoFormat, token, attemptedEndpoints, attemptedFormats);
    if (result) return result;
  }

  const endpoints = [
    `${baseUrl}/${apiVersion}/Administration/Vehicle/v2/List`,
    `${baseUrl}/Administration/Vehicle/v2/List`,
    `${baseUrl}/v1/Administration/Vehicle/v2/List`,
  ];

  for (const endpoint of endpoints) {
    if (attemptedEndpoints.includes(endpoint)) continue;
    for (const candidate of ADMIN_CANDIDATE_BODIES) {
      attemptedEndpoints.push(endpoint);
      attemptedFormats.push(`${endpoint}:${candidate.label}`);

      const resp = candidate.body === null
        ? await safePostNoBody(endpoint, token)
        : await safePostJson(endpoint, token, candidate.body);

      if (resp.networkError) continue;
      if (resp.status === 429) {
        return { success: false, endpoint, status_code: 429, items: [], error_message: "Rate limit", attempted_endpoints: attemptedEndpoints, attempted_formats: attemptedFormats };
      }
      if (resp.ok) {
        const items = extractItemsExtended(resp.parsed);
        if (items.length > 0) {
          return { success: true, endpoint, status_code: resp.status, items, attempted_endpoints: attemptedEndpoints, attempted_formats: attemptedFormats, successful_format: candidate.label };
        }
      }
      if (resp.status === 404) break;
    }
  }

  return { success: false, endpoint: endpoints[0], status_code: 404, items: [], error_message: "Administration/Vehicle not available", attempted_endpoints: attemptedEndpoints, attempted_formats: attemptedFormats };
}

// ==================== Legacy Fallback (TrackedUnit + PositionHistory) ====================

async function fetchUnitsLegacyFallback(params: {
  baseUrl: string; apiVersion: string; token: string; settings: Record<string, any>;
}): Promise<AdminFetchResult> {
  const { baseUrl, apiVersion, token } = params;
  const attemptedEndpoints: string[] = [];
  const attemptedFormats: string[] = [];
  const versionPrefix = apiVersion && apiVersion !== "v1" ? `/${apiVersion}` : "";

  // 1) TrackedUnit/List — skip if known to not work
  const skipTrackedUntil = params.settings.skip_tracked_unit_until;
  const skipTrackedUnit = skipTrackedUntil && new Date(skipTrackedUntil).getTime() > Date.now();

  if (!skipTrackedUnit) {
    const trackedUnitEndpoints = [
      `${baseUrl}${versionPrefix}/Tracking/TrackedUnit/List`,
      `${baseUrl}/Tracking/TrackedUnit/List`,
    ];

    for (const endpoint of trackedUnitEndpoints) {
      attemptedEndpoints.push(endpoint);
      attemptedFormats.push("tracked_unit:{}");
      const response = await safePostJson(endpoint, token, {});
      if (response.networkError) continue;
      if (response.status === 429) {
        return { success: false, endpoint, status_code: 429, items: [], error_message: "Rate limit", attempted_endpoints: attemptedEndpoints, attempted_formats: attemptedFormats };
      }
      if (response.ok) {
        const items = extractItems(response.parsed);
        if (items.length > 0) {
          return { success: true, endpoint, status_code: response.status, items, attempted_endpoints: attemptedEndpoints, attempted_formats: attemptedFormats, successful_format: "tracked_unit:{}" };
        }
      }
    }
  } else {
    console.log("Skipping TrackedUnit/List (skip_tracked_unit_until active)");
  }

  // 2) PositionHistory fallback
  const positionEndpoint = `${baseUrl}${versionPrefix}/Tracking/PositionHistory/List`;
  attemptedEndpoints.push(positionEndpoint);
  const windowsMinutes = [5, 30, 360, 1440];

  for (const windowMin of windowsMinutes) {
    const since = new Date(Date.now() - windowMin * 60 * 1000).toISOString();
    const filters = [{ PropertyName: "DateTimeGPS", Condition: ">=", Value: since }];

    attemptedFormats.push(`position_history:${windowMin}m:array`);
    let response = await safePostJson(positionEndpoint, token, filters);

    if (response.networkError) continue;
    if (!response.ok && (response.status === 400 || response.status === 415)) {
      attemptedFormats.push(`position_history:${windowMin}m:wrapped`);
      response = await safePostJson(positionEndpoint, token, { Filters: filters });
      if (response.networkError) continue;
    }
    if (response.status === 429) {
      return { success: false, endpoint: positionEndpoint, status_code: 429, items: [], error_message: "Rate limit", attempted_endpoints: attemptedEndpoints, attempted_formats: attemptedFormats };
    }
    if (response.ok) {
      const items = extractItems(response.parsed);
      if (items.length > 0) {
        return { success: true, endpoint: `${positionEndpoint} (fallback ${windowMin}m)`, status_code: response.status, items, attempted_endpoints: attemptedEndpoints, attempted_formats: attemptedFormats, successful_format: `position_history:${windowMin}m` };
      }
    }
  }

  return { success: false, endpoint: positionEndpoint, status_code: 404, items: [], error_message: "No units found in any method", attempted_endpoints: attemptedEndpoints, attempted_formats: attemptedFormats };
}

// ==================== Helpers: Try memoized admin endpoint ====================

async function tryAdminEndpointWithBody(
  endpoint: string, formatLabel: string, token: string,
  attemptedEndpoints: string[], attemptedFormats: string[],
): Promise<AdminFetchResult | null> {
  attemptedEndpoints.push(endpoint);
  attemptedFormats.push(`memo:${formatLabel}`);

  const candidate = ADMIN_CANDIDATE_BODIES.find(c => c.label === formatLabel);
  const resp = candidate?.body === null
    ? await safePostNoBody(endpoint, token)
    : await safePostJson(endpoint, token, candidate?.body ?? {});

  if (resp.networkError) return null;
  if (resp.status === 429) {
    return { success: false, endpoint, status_code: 429, items: [], error_message: "Rate limit", attempted_endpoints: attemptedEndpoints, attempted_formats: attemptedFormats };
  }
  if (resp.ok) {
    const items = extractItemsExtended(resp.parsed);
    if (items.length > 0) {
      return { success: true, endpoint, status_code: resp.status, items, attempted_endpoints: attemptedEndpoints, attempted_formats: attemptedFormats, successful_format: formatLabel };
    }
  }
  return null; // fall through
}

// ==================== HTTP helpers ====================

async function safePostJson(endpoint: string, token: string, body: any): Promise<{
  ok: boolean; status: number; text: string; parsed: any; networkError?: string;
}> {
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await resp.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    return { ok: resp.ok, status: resp.status, text, parsed };
  } catch (error: any) {
    return { ok: false, status: 0, text: "", parsed: null, networkError: `SSX unreachable: ${error.message}` };
  }
}

async function safePostNoBody(endpoint: string, token: string): Promise<{
  ok: boolean; status: number; text: string; parsed: any; networkError?: string;
}> {
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    const text = await resp.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    return { ok: resp.ok, status: resp.status, text, parsed };
  } catch (error: any) {
    return { ok: false, status: 0, text: "", parsed: null, networkError: `SSX unreachable: ${error.message}` };
  }
}

// ==================== Data extraction ====================

function extractItems(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  const candidates = [parsed.data, parsed.Data, parsed.items, parsed.Items, parsed.result, parsed.Result, parsed.positions, parsed.Positions, parsed.records, parsed.Records];
  for (const c of candidates) { if (Array.isArray(c)) return c; }
  return [];
}

function extractItemsExtended(parsed: any): any[] {
  const basic = extractItems(parsed);
  if (basic.length > 0) return basic;
  if (!parsed || typeof parsed !== "object") return [];
  // Additional candidates for Administration endpoints
  const extra = [parsed.Trackers, parsed.trackers, parsed.Vehicles, parsed.vehicles, parsed.Units, parsed.units, parsed.Content, parsed.content, parsed.List, parsed.list];
  for (const c of extra) { if (Array.isArray(c)) return c; }
  // Paginated: check nested .Items inside .Data etc
  for (const outer of [parsed.Data, parsed.data, parsed.Result, parsed.result]) {
    if (outer && typeof outer === "object" && !Array.isArray(outer)) {
      for (const inner of [outer.Items, outer.items, outer.Data, outer.data, outer.Records, outer.records]) {
        if (Array.isArray(inner)) return inner;
      }
    }
  }
  return [];
}

// ==================== Field pickers ====================

function pickExternalCode(item: any): string {
  const candidates = [
    item.TrackedUnitIntegrationCode, item.TrackerIntegrationCode,
    item.IntegrationCode, item.Code, item.TrackedUnit,
    item.TrackerCode, item.SerialNumber, item.IMEI, item.Imei,
    item.integrationCode, item.code, item.trackedUnit,
    item.Id, item.id,
  ];
  for (const c of candidates) {
    if (c && typeof c === "string" && c.trim()) return c.trim();
    if (c && typeof c === "number") return String(c);
  }
  return "";
}

function pickPlate(item: any): string | null {
  const candidates = [item.Plate, item.plate, item.LicensePlate, item.licensePlate, item.VehiclePlate, item.vehiclePlate];
  for (const c of candidates) {
    if (c && typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

function pickTrackerCodeFromVehicle(item: any): string | null {
  // Direct fields
  const direct = [
    item.TrackedUnitIntegrationCode, item.TrackerIntegrationCode,
    item.IntegrationCode, item.TrackerCode,
  ];
  for (const c of direct) {
    if (c && typeof c === "string" && c.trim()) return c.trim();
  }
  // Array field
  const listField = item.TrackerIntegrationCodeList || item.trackerIntegrationCodeList;
  if (Array.isArray(listField) && listField.length > 0 && typeof listField[0] === "string") {
    return listField[0].trim();
  }
  // Nested tracker object
  const tracker = item.Tracker || item.tracker;
  if (tracker && typeof tracker === "object") {
    const nested = tracker.IntegrationCode || tracker.integrationCode || tracker.Code || tracker.code;
    if (nested && typeof nested === "string") return nested.trim();
  }
  return null;
}

// ==================== 429 handler ====================

async function handle429(
  supabase: any, account: any, settings: Record<string, any>,
  integration_account_id: string, result: AdminFetchResult, duration: number,
) {
  const count = settings.sync_units_backoff_count || 0;
  const tier = Math.min(count, BACKOFF_TIERS_MS.length - 1);
  const backoffMs = BACKOFF_TIERS_MS[tier];
  const newBackoffUntil = new Date(Date.now() + backoffMs).toISOString();

  await supabase.from("integration_accounts").update({
    settings: { ...settings, sync_units_backoff_until: newBackoffUntil, sync_units_backoff_count: count + 1 },
    status: "degraded", last_error: `Rate limit (429). Retry after ${newBackoffUntil}`, updated_at: new Date().toISOString(),
  }).eq("id", integration_account_id);

  await logIntegration(supabase, {
    tenant_id: account.tenant_id, integration_account_id,
    action: "ssx_sync_units", endpoint: result.endpoint, status_code: 429, success: false,
    error_message: `Rate limit. Backoff until ${newBackoffUntil} (tier ${tier})`, duration_ms: duration,
    metadata: { attempted_endpoints: result.attempted_endpoints, attempted_formats: result.attempted_formats, backoff_until: newBackoffUntil, backoff_tier: tier },
  });

  return new Response(JSON.stringify({
    error: "Limite de consultas SSX excedido. Aguarde alguns minutos e tente novamente.",
    retry_after_seconds: Math.ceil(backoffMs / 1000), retry_at: newBackoffUntil, cooldown_active: true,
  }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// ==================== Logging ====================

async function logIntegration(supabase: any, log: {
  tenant_id: string; integration_account_id: string; action: string;
  endpoint?: string; status_code?: number; success: boolean;
  error_message?: string; duration_ms?: number; metadata?: Record<string, any>;
}) {
  try { await supabase.from("integration_logs").insert(log); } catch (e) { console.error("Failed to log:", e); }
}
