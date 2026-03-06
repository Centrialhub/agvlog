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
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(
      authHeader.replace("Bearer ", "")
    );
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerId = claimsData.claims.sub as string;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { tenant_id, driver_id, integration_account_id } = await req.json();
    if (!tenant_id || !driver_id || !integration_account_id) {
      return new Response(
        JSON.stringify({ error: "tenant_id, driver_id, and integration_account_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify admin
    const { data: membership } = await supabase
      .from("tenant_memberships").select("role")
      .eq("tenant_id", tenant_id).eq("user_id", callerId).eq("active", true)
      .limit(1).single();

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get driver
    const { data: driver, error: driverErr } = await supabase
      .from("drivers").select("*")
      .eq("id", driver_id).eq("tenant_id", tenant_id).single();

    if (driverErr || !driver) {
      return new Response(JSON.stringify({ error: "Driver not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get integration account
    const { data: account, error: accErr } = await supabase
      .from("integration_accounts").select("*")
      .eq("id", integration_account_id).eq("tenant_id", tenant_id).single();

    if (accErr || !account) {
      return new Response(JSON.stringify({ error: "Integration account not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ensure token valid
    if (!account.token_cache || !account.token_expires_at || new Date(account.token_expires_at).getTime() < Date.now()) {
      return new Response(JSON.stringify({ error: "Token expired. Run ssx-login first." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const settings = (account.settings as any) || {};
    const apiVersion = settings.api_version || "";
    const versionPrefix = apiVersion && apiVersion !== "v1" ? `/${apiVersion}` : "";
    const baseUrl = account.base_url.replace(/\/$/, "");
    const insertUrl = `${baseUrl}${versionPrefix}/Tracking/Person/InsertPerson`;

    // Build SSX person payload
    const personPayload = {
      Name: driver.name,
      Document: driver.doc || "",
      Phone: driver.phone || "",
    };

    const startTime = Date.now();
    let ssxResponse: Response;

    try {
      ssxResponse = await fetch(insertUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${account.token_cache}`,
        },
        body: JSON.stringify(personPayload),
      });
    } catch (fetchErr: any) {
      await supabase.from("drivers").update({
        provider_person_sync_status: "error",
      }).eq("id", driver_id);

      await logIntegration(supabase, {
        tenant_id, integration_account_id,
        action: "ssx_insert_person", endpoint: insertUrl,
        success: false, error_message: fetchErr.message,
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
      await supabase.from("drivers").update({
        provider_person_sync_status: "error",
      }).eq("id", driver_id);

      await logIntegration(supabase, {
        tenant_id, integration_account_id,
        action: "ssx_insert_person", endpoint: insertUrl,
        status_code: ssxResponse.status, success: false,
        error_message: responseText.substring(0, 500),
        duration_ms: duration,
      });

      return new Response(
        JSON.stringify({ error: "SSX insert person failed", status_code: ssxResponse.status, details: responseText.substring(0, 200) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse response to get person ID
    let personId: string | null = null;
    try {
      const parsed = JSON.parse(responseText);
      personId = String(parsed.Id || parsed.id || parsed.PersonId || parsed.personId || "");
    } catch {
      personId = responseText.trim();
    }

    // Update driver
    await supabase.from("drivers").update({
      provider_person_id: personId || null,
      provider_person_sync_status: "synced",
    }).eq("id", driver_id);

    await logIntegration(supabase, {
      tenant_id, integration_account_id,
      action: "ssx_insert_person", endpoint: insertUrl,
      status_code: ssxResponse.status, success: true,
      duration_ms: duration,
      metadata: { driver_id, person_id: personId },
    });

    return new Response(
      JSON.stringify({ success: true, person_id: personId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("ssx-insert-person error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error", details: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function logIntegration(supabase: any, log: any) {
  try { await supabase.from("integration_logs").insert(log); } catch (e) { console.error("Log failed:", e); }
}
