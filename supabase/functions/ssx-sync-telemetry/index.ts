import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerId = claimsData.claims.sub as string;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { integration_account_id } = await req.json();
    if (!integration_account_id) {
      return new Response(
        JSON.stringify({ error: "integration_account_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    // Verify caller is admin/owner of this tenant
    const memberRole = await getTenantRole(supabase, account.tenant_id, callerId);
    if (!memberRole || !["owner", "admin"].includes(memberRole)) {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Ensure we have a valid token
    let token = account.token_cache;
    if (!token || !account.token_expires_at || new Date(account.token_expires_at).getTime() - Date.now() < 60000) {
      return new Response(
        JSON.stringify({ error: "Token expired or missing. Run ssx-login first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Call SSX Telemetry List
    const telemetryUrl = `${account.base_url}/Tracking/Telemetry/List`;
    const startTime = Date.now();

    let ssxResponse: Response;
    try {
      ssxResponse = await fetch(telemetryUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      });
    } catch (fetchErr: any) {
      await logIntegration(supabase, {
        tenant_id: account.tenant_id,
        integration_account_id,
        action: "ssx_sync_telemetry",
        endpoint: telemetryUrl,
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
    const responseText = await ssxResponse.text();

    if (!ssxResponse.ok) {
      await logIntegration(supabase, {
        tenant_id: account.tenant_id,
        integration_account_id,
        action: "ssx_sync_telemetry",
        endpoint: telemetryUrl,
        status_code: ssxResponse.status,
        success: false,
        error_message: responseText.substring(0, 500),
        duration_ms: duration,
      });

      return new Response(
        JSON.stringify({ error: "SSX telemetry fetch failed", status_code: ssxResponse.status }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let telemetries: any[];
    try {
      const parsed = JSON.parse(responseText);
      telemetries = Array.isArray(parsed) ? parsed : parsed.data || parsed.Data || parsed.items || [];
    } catch {
      telemetries = [];
    }

    let upsertCount = 0;
    for (const t of telemetries) {
      const telemetryId = String(
        t.Id || t.id || t.TelemetryId || t.telemetryId || t.Code || t.code || ""
      );
      if (!telemetryId) continue;

      const record = {
        provider: "SSX",
        telemetry_id: telemetryId,
        name: t.Name || t.name || t.Description || null,
        description: t.Description || t.description || null,
        unit: t.Unit || t.unit || t.MeasureUnit || null,
        data_type: t.DataType || t.dataType || t.Type || null,
        raw: t,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertErr } = await supabase
        .from("telemetry_catalog")
        .upsert(record, { onConflict: "provider,telemetry_id" });

      if (!upsertErr) upsertCount++;
    }

    await logIntegration(supabase, {
      tenant_id: account.tenant_id,
      integration_account_id,
      action: "ssx_sync_telemetry",
      endpoint: telemetryUrl,
      status_code: ssxResponse.status,
      success: true,
      duration_ms: duration,
      metadata: {
        total_received: telemetries.length,
        upserted: upsertCount,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        total_received: telemetries.length,
        upserted: upsertCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("ssx-sync-telemetry error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function getTenantRole(
  supabase: any,
  tenantId: string,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .eq("active", true)
    .limit(1)
    .single();
  if (error || !data) return null;
  return data.role;
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
    console.error("Failed to log integration event:", e);
  }
}
