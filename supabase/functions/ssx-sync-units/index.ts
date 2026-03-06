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

    // Call SSX TrackedUnit List
    const baseUrl = account.base_url.replace(/\/$/, "");
    const apiVersion = account.settings?.api_version || "v3";
    const listUrl = `${baseUrl}/${apiVersion}/Tracking/TrackedUnit/List`;
    const startTime = Date.now();

    let ssxResponse: Response;
    let responseText: string;
    try {
      ssxResponse = await fetch(listUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });
      responseText = await ssxResponse.text();
    } catch (fetchErr: any) {
      await logIntegration(supabase, {
        tenant_id: account.tenant_id,
        integration_account_id,
        action: "ssx_sync_units",
        endpoint: listUrl,
        success: false,
        error_message: `SSX unreachable: ${fetchErr.message}`,
        duration_ms: Date.now() - startTime,
      });
      return new Response(
        JSON.stringify({ error: "SSX unreachable", details: fetchErr.message }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const duration = Date.now() - startTime;

    if (!ssxResponse.ok) {
      await logIntegration(supabase, {
        tenant_id: account.tenant_id,
        integration_account_id,
        action: "ssx_sync_units",
        endpoint: listUrl,
        status_code: ssxResponse.status,
        success: false,
        error_message: responseText.substring(0, 500),
        duration_ms: duration,
      });
      return new Response(
        JSON.stringify({ error: "SSX TrackedUnit/List failed", status_code: ssxResponse.status }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse units
    let units: any[];
    try {
      const parsed = JSON.parse(responseText);
      units = Array.isArray(parsed) ? parsed : parsed.data || parsed.Data || parsed.items || parsed.Items || [];
    } catch {
      units = [];
    }

    // Upsert into provider_units
    let upsertedCount = 0;
    let skippedCount = 0;
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

      const { error: upsertErr } = await supabase
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
        );

      if (upsertErr) {
        console.error(`Upsert failed for ${externalCode}:`, upsertErr.message);
        skippedCount++;
      } else {
        upsertedCount++;
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
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        total_received: units.length,
        upserted: upsertedCount,
        skipped: skippedCount,
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
