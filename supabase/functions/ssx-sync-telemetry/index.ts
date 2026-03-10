/**
 * ssx-sync-telemetry — Syncs telemetry catalog from SSX Tracking API.
 * Uses buildSsxUrlCandidates for versioned + unversioned fallback.
 * Preserves real error classification in logs.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  buildSsxUrlCandidates,
  readAccountConfig,
  extractResponseItems,
  ssxPost,
  tryEndpointWithFallback,
  logIntegration,
  logSsxCall,
  summarizeAttemptMatrix,
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

    // Use URL candidates for versioned + unversioned fallback
    const telemetryUrls = buildSsxUrlCandidates(config.baseUrl, config.apiVersion, "/Tracking/Telemetry/List");

    // Try both null and empty array body — swagger shows array input
    const result = await tryEndpointWithFallback({
      urlCandidates: telemetryUrls,
      token: config.token,
      bodyCandidates: [
        { label: "null_body", body: null },
        { label: "empty_array", body: [] },
      ],
      timeoutMs: config.requestTimeoutMs,
      abortOnAuthError: true,
    });

    for (const attempt of result.attempts) {
      logSsxCall({
        routine: "sync-telemetry", endpoint: attempt.endpoint, method: "POST",
        apiVersion: config.apiVersion, attemptType: `telemetry_list:${attempt.format}`,
        statusCode: attempt.statusCode, durationMs: attempt.durationMs,
        responsePreview: attempt.responsePreview,
        result: attempt.itemCount > 0 ? "success" : (attempt.errorClass === "empty_response" ? "empty" : "error"),
        errorClass: attempt.errorClass,
      });
    }

    if (!result.success) {
      await logIntegration(supabase, {
        tenant_id: account.tenant_id, integration_account_id,
        action: "ssx_sync_telemetry", endpoint: result.endpoint,
        status_code: result.statusCode, success: false,
        error_message: result.errorMessage || "Telemetry fetch failed",
        duration_ms: result.attempts.reduce((s, a) => s + a.durationMs, 0),
        metadata: {
          error_class: result.errorClass,
          attempt_matrix: summarizeAttemptMatrix(result.attempts),
        },
      });
      return jsonResp({
        error: "SSX telemetry fetch failed",
        status_code: result.statusCode,
        error_class: result.errorClass,
        attempt_matrix: summarizeAttemptMatrix(result.attempts),
      }, 502);
    }

    const telemetries = result.items;
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
      action: "ssx_sync_telemetry", endpoint: result.endpoint,
      status_code: result.statusCode, success: true,
      duration_ms: result.attempts.reduce((s, a) => s + a.durationMs, 0),
      metadata: {
        total_received: telemetries.length, upserted: upsertCount,
        final_successful_endpoint: result.endpoint,
        final_successful_format: result.successfulFormat,
        endpoint_candidates: telemetryUrls,
        attempt_matrix: summarizeAttemptMatrix(result.attempts),
      },
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
