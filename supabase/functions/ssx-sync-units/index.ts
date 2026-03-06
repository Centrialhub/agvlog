import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-agvlog-cron-secret",
};

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

    const { integration_account_id } = await req.json();
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

    // Ensure valid token
    const token = account.token_cache;
    if (!token || !account.token_expires_at || new Date(account.token_expires_at).getTime() - Date.now() < 60000) {
      return new Response(
        JSON.stringify({ error: "Token expired or missing. Run ssx-login first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch SSX units with endpoint fallback strategy
    const baseUrl = account.base_url.replace(/\/$/, "");
    const apiVersion = account.settings?.api_version || "v3";
    const startTime = Date.now();

    const unitFetch = await fetchUnitsWithFallback({
      baseUrl,
      apiVersion,
      token,
    });

    const duration = Date.now() - startTime;

    if (!unitFetch.success) {
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

      // Upsert provider_unit
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

      // Auto-create vehicle from Plate if available
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

        // Auto-create vehicle_tracker_link if none active
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

type UnitFetchSuccess = {
  success: true;
  endpoint: string;
  status_code: number;
  items: any[];
  attempted_endpoints: string[];
  attempted_formats: string[];
};

type UnitFetchFailure = {
  success: false;
  endpoint: string;
  status_code: number;
  error_message: string;
  attempted_endpoints: string[];
  attempted_formats: string[];
};

async function fetchUnitsWithFallback(params: {
  baseUrl: string;
  apiVersion: string;
  token: string;
}): Promise<UnitFetchSuccess | UnitFetchFailure> {
  const { baseUrl, apiVersion, token } = params;
  const attemptedEndpoints: string[] = [];
  const attemptedFormats: string[] = [];

  const versionPrefix = apiVersion && apiVersion !== "v1" ? `/${apiVersion}` : "";
  const trackedUnitEndpoints = [
    `${baseUrl}${versionPrefix}/Tracking/TrackedUnit/List`,
    `${baseUrl}/Tracking/TrackedUnit/List`,
  ];

  let lastStatus = 404;
  let lastError = "Not found";
  let lastEndpoint = trackedUnitEndpoints[0];

  // 1) Try undocumented TrackedUnit/List paths
  for (const endpoint of trackedUnitEndpoints) {
    attemptedEndpoints.push(endpoint);
    lastEndpoint = endpoint;

    const response = await safePostJson(endpoint, token, {});
    if (response.networkError) {
      return {
        success: false,
        endpoint,
        status_code: 502,
        error_message: response.networkError,
        attempted_endpoints: attemptedEndpoints,
        attempted_formats: attemptedFormats,
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
      };
    }

    // 404 means endpoint doesn't exist, try next. Other errors are fatal (except 429).
    if (response.status === 429) {
      return {
        success: false,
        endpoint,
        status_code: 429,
        error_message: "Rate limit exceeded. Try again in a few minutes.",
        attempted_endpoints: attemptedEndpoints,
        attempted_formats: attemptedFormats,
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
      };
    }
  }

  // 2) Fallback to PositionHistory/List to infer units
  const positionEndpoint = `${baseUrl}${versionPrefix}/Tracking/PositionHistory/List`;
  attemptedEndpoints.push(positionEndpoint);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const filters = [{ PropertyName: "DateTimeGPS", Condition: ">=", Value: since }];

  attemptedFormats.push("position_history:array");
  let response = await safePostJson(positionEndpoint, token, filters);
  if (response.networkError) {
    return {
      success: false,
      endpoint: positionEndpoint,
      status_code: 502,
      error_message: response.networkError,
      attempted_endpoints: attemptedEndpoints,
      attempted_formats: attemptedFormats,
    };
  }

  // Some SSX instances require wrapped format
  if (!response.ok && (response.status === 400 || response.status === 415)) {
    attemptedFormats.push("position_history:wrapped");
    response = await safePostJson(positionEndpoint, token, { Filters: filters });
    if (response.networkError) {
      return {
        success: false,
        endpoint: positionEndpoint,
        status_code: 502,
        error_message: response.networkError,
        attempted_endpoints: attemptedEndpoints,
        attempted_formats: attemptedFormats,
      };
    }
  }

  if (!response.ok) {
    const isRateLimit = response.status === 429;
    return {
      success: false,
      endpoint: positionEndpoint,
      status_code: response.status || lastStatus,
      error_message: isRateLimit
        ? "Rate limit exceeded. Try again in a few minutes."
        : (response.text.slice(0, 500) || lastError),
      attempted_endpoints: attemptedEndpoints,
      attempted_formats: attemptedFormats,
    };
  }

  return {
    success: true,
    endpoint: `${positionEndpoint} (fallback)` ,
    status_code: response.status,
    items: extractItems(response.parsed),
    attempted_endpoints: attemptedEndpoints,
    attempted_formats: attemptedFormats,
  };
}

async function safePostJson(endpoint: string, token: string, body: any): Promise<{
  ok: boolean;
  status: number;
  text: string;
  parsed: any;
  networkError?: string;
}> {
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    return {
      ok: resp.ok,
      status: resp.status,
      text,
      parsed,
    };
  } catch (error: any) {
    return {
      ok: false,
      status: 0,
      text: "",
      parsed: null,
      networkError: `SSX unreachable: ${error.message}`,
    };
  }
}

function extractItems(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];

  const candidates = [
    parsed.data,
    parsed.Data,
    parsed.items,
    parsed.Items,
    parsed.result,
    parsed.Result,
    parsed.positions,
    parsed.Positions,
    parsed.records,
    parsed.Records,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function normalizeUnits(items: any[]): any[] {
  return items.map((item) => {
    const inferredCode =
      item.TrackedUnitIntegrationCode ||
      item.trackedUnitIntegrationCode ||
      item.TrackedUnit ||
      item.trackedUnit ||
      item.IntegrationCode ||
      item.integrationCode ||
      item.Code ||
      item.code ||
      item.Plate ||
      item.plate ||
      "";

    return {
      ...item,
      TrackedUnit: item.TrackedUnit || item.trackedUnit || inferredCode,
      IntegrationCode:
        item.IntegrationCode ||
        item.integrationCode ||
        item.TrackedUnitIntegrationCode ||
        item.trackedUnitIntegrationCode ||
        inferredCode,
      Plate: item.Plate || item.plate || null,
      Description: item.Description || item.description || item.Name || item.name || item.Plate || item.plate || null,
    };
  });
}

async function logIntegration(
  supabase: any,
  log: {
    tenant_id: string;
    integration_account_id: string;
    action: string;
    endpoint?: string;
    status_code?: number;
    success: boolean;
    error_message?: string;
    duration_ms?: number;
    metadata?: Record<string, any>;
  }
) {
  try {
    await supabase.from("integration_logs").insert(log);
  } catch (e) {
    console.error("Failed to log:", e);
  }
}
