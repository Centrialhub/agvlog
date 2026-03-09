/**
 * ssx-insert-person — Inserts a driver/person into SSX via Tracking API.
 * Uses centralized URL builder and logging from shared utils.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  buildSsxUrl,
  readAccountConfig,
  ssxPost,
  logIntegration,
  logSsxCall,
  getTenantRole,
} from "../_shared/ssx-utils.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }

    const callerId = userData.user.id;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { tenant_id, driver_id, integration_account_id } = await req.json();
    if (!tenant_id || !driver_id || !integration_account_id) {
      return jsonResp({ error: "tenant_id, driver_id, and integration_account_id required" }, 400);
    }

    const role = await getTenantRole(supabase, tenant_id, callerId);
    if (!role || !["owner", "admin"].includes(role)) {
      return jsonResp({ error: "Forbidden" }, 403);
    }

    const { data: driver, error: driverErr } = await supabase
      .from("drivers").select("*").eq("id", driver_id).eq("tenant_id", tenant_id).single();
    if (driverErr || !driver) {
      return jsonResp({ error: "Driver not found" }, 404);
    }

    const { data: account, error: accErr } = await supabase
      .from("integration_accounts").select("*").eq("id", integration_account_id).eq("tenant_id", tenant_id).single();
    if (accErr || !account) {
      return jsonResp({ error: "Integration account not found" }, 404);
    }

    if (!account.token_cache || !account.token_expires_at || new Date(account.token_expires_at).getTime() < Date.now()) {
      return jsonResp({ error: "Token expired. Run ssx-login first." }, 400);
    }

    const config = readAccountConfig(account);

    // Use centralized URL builder
    const insertUrl = buildSsxUrl(config.baseUrl, config.apiVersion, "/Tracking/Person/InsertPerson");

    const personPayload = {
      Name: driver.name,
      Document: driver.doc || "",
      Phone: driver.phone || "",
    };

    const resp = await ssxPost(insertUrl, config.token, personPayload, config.requestTimeoutMs);

    logSsxCall({
      routine: "insert-person", endpoint: insertUrl, method: "POST",
      apiVersion: config.apiVersion, attemptType: "insert_person",
      statusCode: resp.status, durationMs: resp.durationMs,
      responsePreview: (resp.text || "").substring(0, 150),
      result: resp.ok ? "success" : "error",
      errorClass: resp.errorClass,
    });

    if (!resp.ok) {
      await supabase.from("drivers").update({ provider_person_sync_status: "error" }).eq("id", driver_id);

      await logIntegration(supabase, {
        tenant_id, integration_account_id,
        action: "ssx_insert_person", endpoint: insertUrl,
        status_code: resp.status, success: false,
        error_message: resp.text.substring(0, 500),
        duration_ms: resp.durationMs,
        metadata: { error_class: resp.errorClass },
      });

      return jsonResp({
        error: "SSX insert person failed", status_code: resp.status,
        error_class: resp.errorClass,
        details: resp.text.substring(0, 200),
      }, 502);
    }

    let personId: string | null = null;
    try {
      const parsed = resp.parsed;
      personId = String(parsed?.Id || parsed?.id || parsed?.PersonId || parsed?.personId || "");
    } catch {
      personId = resp.text.trim();
    }

    await supabase.from("drivers").update({
      provider_person_id: personId || null,
      provider_person_sync_status: "synced",
    }).eq("id", driver_id);

    await logIntegration(supabase, {
      tenant_id, integration_account_id,
      action: "ssx_insert_person", endpoint: insertUrl,
      status_code: resp.status, success: true,
      duration_ms: resp.durationMs,
      metadata: { driver_id, person_id: personId },
    });

    return jsonResp({ success: true, person_id: personId });
  } catch (err: any) {
    console.error("[SSX:insert-person] error:", err);
    return jsonResp({ error: "Internal error", details: err.message }, 500);
  }
});

function jsonResp(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
