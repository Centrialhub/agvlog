import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-agvlog-cron-secret",
};

// Exponential backoff tiers (ms)
const BACKOFF_TIERS_MS = [2 * 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];
const CACHE_TTL_MS = 60 * 60_000; // 1 hour
const TRACKED_UNIT_SKIP_TTL_MS = 24 * 60 * 60_000; // 24 hours

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
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userError } = await anonClient.auth.getUser();
      if (userError || !userData?.user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    // Fetch integration account
    const { data: account, error: accErr } = await supabase
      .from("integration_accounts")
      .select("*")
      .eq("id", integration_account_id)
      .single();

    if (accErr || !account) {
      return new Response(
        JSON.stringify({ error: "Integration account not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify caller role (skip for cron)
    if (!isCron && callerId) {
      const { data: membership } = await supabase
        .from("tenant_memberships")
        .select("role")
        .eq("tenant_id", account.tenant_id)
        .eq("user_id", callerId)
        .eq("active", true)
        .single();
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        return new Response(
          JSON.stringify({ error: "Forbidden: admin role required" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    const settings = (account.settings || {}) as Record<string, any>;

    // Check cooldown (backoff) — always respected, even with force
    const backoffUntil = settings.sync_units_backoff_until;
    if (backoffUntil) {
      const remainingMs = new Date(backoffUntil).getTime() - Date.now();
      if (remainingMs > 0) {
        return new Response(
          JSON.stringify({
            error: "Limite de consultas SSX excedido. Aguarde e tente novamente.",
            retry_after_seconds: Math.ceil(remainingMs / 1000),
            retry_at: backoffUntil,
            cooldown_active: true,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Check 1h cache — skip if recent (unless force=true)
    const lastSyncAt = settings.last_units_sync_at;
    if (!force && lastSyncAt) {
      const elapsed = Date.now() - new Date(lastSyncAt).getTime();
      if (elapsed < CACHE_TTL_MS) {
        return new Response(
          JSON.stringify({
            success: true,
            skipped: true,
            reason: "Units synced recently",
            last_sync_at: lastSyncAt,
            next_sync_available_at: new Date(new Date(lastSyncAt).getTime() + CACHE_TTL_MS).toISOString(),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Ensure valid token
    const token = account.token_cache;
    if (!token || !account.token_expires_at || new Date(account.token_expires_at).getTime() - Date.now() < 60000) {
      return new Response(
        JSON.stringify({ error: "Token expired or missing. Run ssx-login first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch SSX units — use memoized endpoint first if available
    const baseUrl = account.base_url.replace(/\/$/, "");
    const apiVersion = settings.api_version || "v3";
    const startTime = Date.now();

    const unitFetch = await fetchUnitsWithFallback({
      baseUrl,
      apiVersion,
      token,
      lastSuccessfulEndpoint: settings.last_successful_endpoint || null,
      lastSuccessfulFormat: settings.last_successful_format || null,
      skipTrackedUnitUntil: settings.skip_tracked_unit_until || null,
    });

    const duration = Date.now() - startTime;

    if (!unitFetch.success) {
      if (unitFetch.status_code === 429) {
        // Exponential backoff
        const count = (settings.sync_units_backoff_count || 0);
        const tier = Math.min(count, BACKOFF_TIERS_MS.length - 1);
        const backoffMs = BACKOFF_TIERS_MS[tier];
        const newBackoffUntil = new Date(Date.now() + backoffMs).toISOString();

        const updatedSettings = {
          ...settings,
          sync_units_backoff_until: newBackoffUntil,
          sync_units_backoff_count: count + 1,
          ...(unitFetch.tracked_unit_404_only
            ? { skip_tracked_unit_until: new Date(Date.now() + TRACKED_UNIT_SKIP_TTL_MS).toISOString() }
            : {}),
        };
        await supabase
          .from("integration_accounts")
          .update({
            settings: updatedSettings,
            status: "degraded",
            last_error: `Rate limit (429). Retry after ${newBackoffUntil}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", integration_account_id);

        await logIntegration(supabase, {
          tenant_id: account.tenant_id,
          integration_account_id,
          action: "ssx_sync_units",
          endpoint: unitFetch.endpoint,
          status_code: 429,
          success: false,
          error_message: `Rate limit. Backoff until ${newBackoffUntil} (tier ${tier})`,
          duration_ms: duration,
          metadata: {
            attempted_endpoints: unitFetch.attempted_endpoints,
            attempted_formats: unitFetch.attempted_formats,
            backoff_until: newBackoffUntil,
            backoff_tier: tier,
          },
        });

        return new Response(
          JSON.stringify({
            error: "Limite de consultas SSX excedido. Aguarde alguns minutos e tente novamente.",
            retry_after_seconds: Math.ceil(backoffMs / 1000),
            retry_at: newBackoffUntil,
            cooldown_active: true,
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await logIntegration(supabase, {
        tenant_id: account.tenant_id,
        integration_account_id,
        action: "ssx_sync_units",
        endpoint: unitFetch.endpoint,
        status_code: unitFetch.status_code,
        success: false,
        error_message: unitFetch.error_message,
        duration_ms: duration,
        metadata: {
          attempted_endpoints: unitFetch.attempted_endpoints,
          attempted_formats: unitFetch.attempted_formats,
        },
      });

      return new Response(
        JSON.stringify({
          error: "SSX unit sync failed",
          status_code: unitFetch.status_code,
          details: unitFetch.error_message,
          endpoint: unitFetch.endpoint,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const units = normalizeUnits(unitFetch.items);

    // Upsert into provider_units
    let upsertedCount = 0;
    let skippedCount = 0;
    let vehiclesCreated = 0;
    let linksCreated = 0;
    const seenCodes = new Set<string>();

    for (const u of units) {
      const externalCode = String(
        u.TrackedUnit || u.trackedUnit || u.Code || u.code || u.IntegrationCode || u.integrationCode || ""
      ).trim();
      if (!externalCode || seenCodes.has(externalCode)) {
        skippedCount++;
        continue;
      }
      seenCodes.add(externalCode);

      const externalId = String(u.Id || u.id || u.TrackedUnitId || "").trim() || null;
      const label = (u.Description || u.description || u.Name || u.name || u.Label || "").trim() || null;
      const plate = (u.Plate || u.plate || "").trim() || null;

      const { data: upsertedUnit, error: upsertErr } = await supabase
        .from("provider_units")
        .upsert(
          {
            tenant_id: account.tenant_id,
            integration_account_id,
            external_code: externalCode,
            external_id: externalId,
            label,
            active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,integration_account_id,external_code", ignoreDuplicates: false }
        )
        .select("id")
        .single();

      if (upsertErr) {
        console.error(`Upsert failed for ${externalCode}:`, upsertErr.message);
        skippedCount++;
        continue;
      }
      upsertedCount++;

      if (plate && upsertedUnit) {
        const { data: existingVehicle } = await supabase
          .from("vehicles")
          .select("id")
          .eq("tenant_id", account.tenant_id)
          .eq("plate", plate)
          .limit(1)
          .maybeSingle();

        let vehicleId: string;
        if (existingVehicle) {
          vehicleId = existingVehicle.id;
        } else {
          const { data: newVehicle, error: vErr } = await supabase
            .from("vehicles")
            .insert({
              tenant_id: account.tenant_id,
              plate,
              nickname: label || null,
              type: "truck",
            })
            .select("id")
            .single();
          if (vErr || !newVehicle) {
            console.error(`Failed to create vehicle for plate ${plate}:`, vErr?.message);
            continue;
          }
          vehicleId = newVehicle.id;
          vehiclesCreated++;
        }

        const { data: existingLink } = await supabase
          .from("vehicle_tracker_links")
          .select("id")
          .eq("tenant_id", account.tenant_id)
          .eq("provider_unit_id", upsertedUnit.id)
          .eq("active", true)
          .limit(1)
          .maybeSingle();

        if (!existingLink) {
          const { error: linkErr } = await supabase
            .from("vehicle_tracker_links")
            .insert({
              tenant_id: account.tenant_id,
              vehicle_id: vehicleId,
              provider_unit_id: upsertedUnit.id,
              active: true,
            });
          if (linkErr) {
            console.error(`Failed to link unit ${externalCode} to vehicle ${plate}:`, linkErr.message);
          } else {
            linksCreated++;
          }
        }
      }
    }

    // Clear backoff, save memoized endpoint, update cache timestamp
    const clearedSettings = { ...settings };
    delete clearedSettings.sync_units_backoff_until;
    clearedSettings.sync_units_backoff_count = 0;
    clearedSettings.last_units_sync_at = new Date().toISOString();
    clearedSettings.last_successful_endpoint = unitFetch.endpoint;
    clearedSettings.last_successful_format = unitFetch.attempted_formats[unitFetch.attempted_formats.length - 1] || null;
    if (unitFetch.endpoint.includes("/TrackedUnit/List")) {
      delete clearedSettings.skip_tracked_unit_until;
    } else {
      clearedSettings.skip_tracked_unit_until = new Date(Date.now() + TRACKED_UNIT_SKIP_TTL_MS).toISOString();
    }

    await supabase
      .from("integration_accounts")
      .update({
        settings: clearedSettings,
        status: "ok",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integration_account_id);

    await logIntegration(supabase, {
      tenant_id: account.tenant_id,
      integration_account_id,
      action: "ssx_sync_units",
      endpoint: unitFetch.endpoint,
      status_code: unitFetch.status_code,
      success: true,
      duration_ms: duration,
      metadata: {
        total_received: units.length,
        upserted: upsertedCount,
        skipped: skippedCount,
        vehicles_created: vehiclesCreated,
        links_created: linksCreated,
        used_memoized: unitFetch.used_memoized,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        total_received: units.length,
        upserted: upsertedCount,
        skipped: skippedCount,
        vehicles_created: vehiclesCreated,
        links_created: linksCreated,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("ssx-sync-units error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// === Types ===

type UnitFetchSuccess = {
  success: true;
  endpoint: string;
  status_code: number;
  items: any[];
  attempted_endpoints: string[];
  attempted_formats: string[];
  used_memoized: boolean;
  tracked_unit_404_only?: boolean;
};

type UnitFetchFailure = {
  success: false;
  endpoint: string;
  status_code: number;
  error_message: string;
  attempted_endpoints: string[];
  attempted_formats: string[];
  tracked_unit_404_only?: boolean;
};

// === Fetch with memoized endpoint priority ===

async function fetchUnitsWithFallback(params: {
  baseUrl: string;
  apiVersion: string;
  token: string;
  lastSuccessfulEndpoint: string | null;
  lastSuccessfulFormat: string | null;
  skipTrackedUnitUntil: string | null;
}): Promise<UnitFetchSuccess | UnitFetchFailure> {
  const { baseUrl, apiVersion, token, lastSuccessfulEndpoint, lastSuccessfulFormat, skipTrackedUnitUntil } = params;
  const attemptedEndpoints: string[] = [];
  const attemptedFormats: string[] = [];

  // 0) Try memoized endpoint first if available
  if (lastSuccessfulEndpoint && lastSuccessfulFormat) {
    const memoResult = await tryMemoizedEndpoint(lastSuccessfulEndpoint, lastSuccessfulFormat, token, attemptedEndpoints, attemptedFormats);
    if (memoResult) {
      if (memoResult.success) return { ...memoResult, used_memoized: true };
      // If 429, stop immediately
      if (!memoResult.success && memoResult.status_code === 429) return memoResult;
      // Otherwise fall through to full discovery
    }
  }

  const versionPrefix = apiVersion && apiVersion !== "v1" ? `/${apiVersion}` : "";
  const shouldSkipTrackedUnit = !!(
    skipTrackedUnitUntil && new Date(skipTrackedUnitUntil).getTime() > Date.now()
  );

  let lastStatus = 404;
  let lastError = "Not found";
  let trackedUnitAll404 = false;

  // 1) TrackedUnit/List paths (skip for 24h if we already learned they only return 404)
  if (!shouldSkipTrackedUnit) {
    const trackedUnitEndpoints = [
      `${baseUrl}${versionPrefix}/Tracking/TrackedUnit/List`,
      `${baseUrl}/Tracking/TrackedUnit/List`,
    ];

    let trackedUnit404Count = 0;

    for (const endpoint of trackedUnitEndpoints) {
      // Skip if already tried via memoized
      if (attemptedEndpoints.includes(endpoint)) continue;
      attemptedEndpoints.push(endpoint);

      const response = await safePostJson(endpoint, token, {});
      if (response.networkError) {
        return {
          success: false,
          endpoint,
          status_code: 502,
          error_message: response.networkError,
          attempted_endpoints: attemptedEndpoints,
          attempted_formats: attemptedFormats,
          tracked_unit_404_only: trackedUnitAll404,
        };
      }

      lastStatus = response.status;
      lastError = response.text.slice(0, 500);

      if (response.ok) {
        attemptedFormats.push("tracked_unit:{}");
        return {
          success: true,
          endpoint,
          status_code: response.status,
          items: extractItems(response.parsed),
          attempted_endpoints: attemptedEndpoints,
          attempted_formats: attemptedFormats,
          used_memoized: false,
          tracked_unit_404_only: false,
        };
      }
      if (response.status === 429) {
        return {
          success: false,
          endpoint,
          status_code: 429,
          error_message: "Rate limit exceeded.",
          attempted_endpoints: attemptedEndpoints,
          attempted_formats: attemptedFormats,
          tracked_unit_404_only: false,
        };
      }
      if (response.status !== 404) {
        return {
          success: false,
          endpoint,
          status_code: response.status,
          error_message: response.text.slice(0, 500),
          attempted_endpoints: attemptedEndpoints,
          attempted_formats: attemptedFormats,
          tracked_unit_404_only: false,
        };
      }

      trackedUnit404Count++;
    }

    trackedUnitAll404 = trackedUnit404Count > 0 && trackedUnit404Count === trackedUnitEndpoints.length;
  } else {
    trackedUnitAll404 = true;
    attemptedFormats.push("tracked_unit:skipped_cached_404");
  }

  // 2) PositionHistory fallback — progressive windows
  const positionEndpoint = `${baseUrl}${versionPrefix}/Tracking/PositionHistory/List`;
  if (!attemptedEndpoints.includes(positionEndpoint)) attemptedEndpoints.push(positionEndpoint);

  const windowsMinutes = [5, 30, 360, 1440];

  for (const windowMin of windowsMinutes) {
    const since = new Date(Date.now() - windowMin * 60 * 1000).toISOString();
    const filters = [{ PropertyName: "DateTimeGPS", Condition: ">=", Value: since }];

    attemptedFormats.push(`position_history:${windowMin}m:array`);
    let response = await safePostJson(positionEndpoint, token, filters);

    if (response.networkError) {
      return {
        success: false,
        endpoint: positionEndpoint,
        status_code: 502,
        error_message: response.networkError,
        attempted_endpoints: attemptedEndpoints,
        attempted_formats: attemptedFormats,
        tracked_unit_404_only: trackedUnitAll404,
      };
    }

    if (!response.ok && (response.status === 400 || response.status === 415)) {
      attemptedFormats.push(`position_history:${windowMin}m:wrapped`);
      response = await safePostJson(positionEndpoint, token, { Filters: filters });
      if (response.networkError) {
        return {
          success: false,
          endpoint: positionEndpoint,
          status_code: 502,
          error_message: response.networkError,
          attempted_endpoints: attemptedEndpoints,
          attempted_formats: attemptedFormats,
          tracked_unit_404_only: trackedUnitAll404,
        };
      }
    }

    if (response.status === 429) {
      return {
        success: false,
        endpoint: positionEndpoint,
        status_code: 429,
        error_message: "Rate limit exceeded.",
        attempted_endpoints: attemptedEndpoints,
        attempted_formats: attemptedFormats,
        tracked_unit_404_only: trackedUnitAll404,
      };
    }

    if (response.ok) {
      const items = extractItems(response.parsed);
      if (items.length > 0) {
        return {
          success: true,
          endpoint: `${positionEndpoint} (fallback ${windowMin}m)`,
          status_code: response.status,
          items,
          attempted_endpoints: attemptedEndpoints,
          attempted_formats: attemptedFormats,
          used_memoized: false,
          tracked_unit_404_only: trackedUnitAll404,
        };
      }
      continue;
    }

    if (response.status !== 400 && response.status !== 415) {
      return {
        success: false,
        endpoint: positionEndpoint,
        status_code: response.status,
        error_message: response.text.slice(0, 500) || lastError,
        attempted_endpoints: attemptedEndpoints,
        attempted_formats: attemptedFormats,
        tracked_unit_404_only: trackedUnitAll404,
      };
    }
  }

  return {
    success: false,
    endpoint: positionEndpoint,
    status_code: lastStatus,
    error_message: "No units found in any time window (5m → 24h)",
    attempted_endpoints: attemptedEndpoints,
    attempted_formats: attemptedFormats,
    tracked_unit_404_only: trackedUnitAll404,
  };
}

// === Try memoized endpoint ===

async function tryMemoizedEndpoint(
  endpoint: string, format: string, token: string,
  attemptedEndpoints: string[], attemptedFormats: string[],
): Promise<(UnitFetchSuccess & { used_memoized: true }) | UnitFetchFailure | null> {
  attemptedEndpoints.push(endpoint);
  attemptedFormats.push(`memo:${format}`);

  // Determine body based on format
  let body: any = {};
  const cleanEndpoint = endpoint.replace(/ \(fallback \d+m\)$/, "");

  if (format.startsWith("position_history:")) {
    const match = format.match(/position_history:(\d+)m:(array|wrapped)/);
    if (match) {
      const windowMin = parseInt(match[1]);
      const wrapped = match[2] === "wrapped";
      const since = new Date(Date.now() - windowMin * 60 * 1000).toISOString();
      const filters = [{ PropertyName: "DateTimeGPS", Condition: ">=", Value: since }];
      body = wrapped ? { Filters: filters } : filters;
    }
  }

  const response = await safePostJson(cleanEndpoint, token, body);
  if (response.networkError) return null; // fall through to full discovery
  if (response.status === 429) {
    return { success: false, endpoint: cleanEndpoint, status_code: 429, error_message: "Rate limit exceeded.", attempted_endpoints: attemptedEndpoints, attempted_formats: attemptedFormats };
  }
  if (response.ok) {
    const items = extractItems(response.parsed);
    if (items.length > 0) {
      return { success: true, endpoint: cleanEndpoint, status_code: response.status, items, attempted_endpoints: attemptedEndpoints, attempted_formats: attemptedFormats, used_memoized: true };
    }
  }
  // Memoized didn't work — return null to try full discovery
  return null;
}

// === HTTP helper ===

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

// === Data helpers ===

function extractItems(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  const candidates = [parsed.data, parsed.Data, parsed.items, parsed.Items, parsed.result, parsed.Result, parsed.positions, parsed.Positions, parsed.records, parsed.Records];
  for (const c of candidates) { if (Array.isArray(c)) return c; }
  return [];
}

function normalizeUnits(items: any[]): any[] {
  return items.map((item) => {
    const inferredCode = item.TrackedUnitIntegrationCode || item.trackedUnitIntegrationCode || item.TrackedUnit || item.trackedUnit || item.IntegrationCode || item.integrationCode || item.Code || item.code || item.Plate || item.plate || "";
    return {
      ...item,
      TrackedUnit: item.TrackedUnit || item.trackedUnit || inferredCode,
      IntegrationCode: item.IntegrationCode || item.integrationCode || item.TrackedUnitIntegrationCode || item.trackedUnitIntegrationCode || inferredCode,
      Plate: item.Plate || item.plate || null,
      Description: item.Description || item.description || item.Name || item.name || item.Plate || item.plate || null,
    };
  });
}

// === Logging ===

async function logIntegration(supabase: any, log: {
  tenant_id: string; integration_account_id: string; action: string;
  endpoint?: string; status_code?: number; success: boolean;
  error_message?: string; duration_ms?: number; metadata?: Record<string, any>;
}) {
  try { await supabase.from("integration_logs").insert(log); } catch (e) { console.error("Failed to log:", e); }
}
