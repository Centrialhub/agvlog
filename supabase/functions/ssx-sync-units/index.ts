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
      endpoint: listUrl,
      status_code: ssxResponse.status,
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
