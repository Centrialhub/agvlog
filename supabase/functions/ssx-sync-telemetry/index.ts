/**
 * ssx-sync-telemetry — Syncs telemetry catalog from SSX Tracking API.
 * Uses centralized URL builder and logging from shared utils.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  buildSsxUrl,
  readAccountConfig,
  extractResponseItems,
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
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }

    const callerId = userData.user.id;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { integration_account_id } = await req.json();
    if (!integration_account_id) {
      return jsonResp({ error: "integration_account_id required" }, 400);
    }

    const { data: account, error: accErr } = await supabase
      .from("integration_accounts").select("*").eq("id", integration_account_id).single();
    if (accErr || !account) {
      return jsonResp({ error: "Integration account not found" }, 404);
    }

    const memberRole = await getTenantRole(supabase, account.tenant_id, callerId);
    if (!memberRole || !["owner", "admin"].includes(memberRole)) {
      return jsonResp({ error: "Forbidden: admin role required" }, 403);
    }

    const config = readAccountConfig(account);

    if (!config.token || !account.token_expires_at || new Date(account.token_expires_at).getTime() - Date.now() < 60000) {
      return jsonResp({ error: "Token expired or missing. Run ssx-login first." }, 400);
    }

    // Use centralized URL builder
    const telemetryUrl = buildSsxUrl(config.baseUrl, config.apiVersion, "/Tracking/Telemetry/List");

    const resp = await ssxPost(telemetryUrl, config.token, null, config.requestTimeoutMs);

    logSsxCall({
      routine: "sync-telemetry", endpoint: telemetryUrl, method: "POST",
      apiVersion: config.apiVersion, attemptType: "telemetry_list",
      statusCode: resp.status, durationMs: resp.durationMs,
      responsePreview: (resp.text || "").substring(0, 150),
      result: resp.ok ? "success" : "error",
      errorClass: resp.errorClass,
    });

    if (!resp.ok) {
      await logIntegration(supabase, {
        tenant_id: account.tenant_id, integration_account_id,
        action: "ssx_sync_telemetry", endpoint: telemetryUrl,
        status_code: resp.status, success: false,
        error_message: resp.text.substring(0, 500),
        duration_ms: resp.durationMs,
        metadata: { error_class: resp.errorClass },
      });
      return jsonResp({ error: "SSX telemetry fetch failed", status_code: resp.status, error_class: resp.errorClass }, 502);
    }

    const telemetries = extractResponseItems(resp.parsed);

    let upsertCount = 0;
    for (const t of telemetries) {
      const telemetryId = String(t.Id || t.id || t.TelemetryId || t.telemetryId || t.Code || t.code || "");
      if (!telemetryId) continue;

      const { error: upsertErr } = await supabase.from("telemetry_catalog").upsert({
        provider: "SSX",
        telemetry_id: telemetryId,
        name: t.Name || t.name || t.Description || null,
        description: t.Description || t.description || null,
        unit: t.Unit || t.unit || t.MeasureUnit || null,
        data_type: t.DataType || t.dataType || t.Type || null,
        raw: t,
        updated_at: new Date().toISOString(),
      }, { onConflict: "provider,telemetry_id" });

      if (!upsertErr) upsertCount++;
    }

    await logIntegration(supabase, {
      tenant_id: account.tenant_id, integration_account_id,
      action: "ssx_sync_telemetry", endpoint: telemetryUrl,
      status_code: resp.status, success: true, duration_ms: resp.durationMs,
      metadata: { total_received: telemetries.length, upserted: upsertCount },
    });

    return jsonResp({ success: true, total_received: telemetries.length, upserted: upsertCount });
  } catch (err: any) {
    console.error("[SSX:sync-telemetry] error:", err);
    return jsonResp({ error: "Internal error", details: err.message }, 500);
  }
});

function jsonResp(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
