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

    // Verify user
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

    // Verify caller is admin/owner of this tenant
    const memberRole = await getTenantRole(supabase, account.tenant_id, callerId);
    if (!memberRole || !["owner", "admin"].includes(memberRole)) {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if token is still valid (>60min remaining)
    if (account.token_cache && account.token_expires_at) {
      const expiresAt = new Date(account.token_expires_at);
      const minutesLeft = (expiresAt.getTime() - Date.now()) / 60000;
      if (minutesLeft > 60) {
        return new Response(
          JSON.stringify({
            success: true,
            cached: true,
            expires_at: account.token_expires_at,
            status: account.status,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Build SSX login request
    const loginUrl = `${account.base_url}/Login`;

    const loginPayload: Record<string, string> = {
      username: account.username,
      password: account.password_encrypted,
      HashAuth: account.hashauth || "",
    };
    if (account.hashcode) {
      loginPayload.Hashcode = account.hashcode;
    }

    const startTime = Date.now();
    let ssxResponse: Response;
    try {
      ssxResponse = await fetch(loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginPayload),
      });
    } catch (fetchErr: any) {
      await supabase
        .from("integration_accounts")
        .update({
          status: "degraded",
          last_error: `SSX unreachable: ${fetchErr.message}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration_account_id);

      await logIntegration(supabase, {
        tenant_id: account.tenant_id,
        integration_account_id,
        action: "ssx_login",
        endpoint: loginUrl,
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
      const newStatus = ssxResponse.status === 401 ? "invalid_credentials" : "degraded";

      await supabase
        .from("integration_accounts")
        .update({
          status: newStatus,
          last_error: `HTTP ${ssxResponse.status}: ${responseText.substring(0, 500)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration_account_id);

      await logIntegration(supabase, {
        tenant_id: account.tenant_id,
        integration_account_id,
        action: "ssx_login",
        endpoint: loginUrl,
        status_code: ssxResponse.status,
        success: false,
        error_message: responseText.substring(0, 500),
        duration_ms: duration,
      });

      return new Response(
        JSON.stringify({
          error: "SSX login failed",
          status_code: ssxResponse.status,
          details: responseText.substring(0, 200),
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse token from response
    let token: string;
    try {
      const parsed = JSON.parse(responseText);
      token = parsed.token || parsed.Token || parsed.access_token || parsed.AccessToken || responseText;
      if (typeof token === "object") {
        token = JSON.stringify(token);
      }
    } catch {
      token = responseText.trim().replace(/^"/, "").replace(/"$/, "");
    }

    if (!token || token.length < 10) {
      await supabase
        .from("integration_accounts")
        .update({
          status: "degraded",
          last_error: "Login succeeded but no valid token in response",
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration_account_id);

      return new Response(
        JSON.stringify({ error: "No valid token in SSX response" }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cache token (24h validity)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await supabase
      .from("integration_accounts")
      .update({
        token_cache: token,
        token_expires_at: expiresAt,
        status: "ok",
        last_login_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", integration_account_id);

    await logIntegration(supabase, {
      tenant_id: account.tenant_id,
      integration_account_id,
      action: "ssx_login",
      endpoint: loginUrl,
      status_code: ssxResponse.status,
      success: true,
      duration_ms: duration,
      metadata: { token_expires_at: expiresAt },
    });

    return new Response(
      JSON.stringify({
        success: true,
        cached: false,
        expires_at: expiresAt,
        status: "ok",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("ssx-login error:", err);
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
