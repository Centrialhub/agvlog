/**
 * ssx-diagnostic — Tests SSX integration connectivity end-to-end.
 * 
 * Tests performed:
 * 1. Authentication (token validity)
 * 2. Administration/Tracker/List
 * 3. Administration/Vehicle/v2/List + Administration/Vehicle/List
 * 4. Tracking/PositionHistory/List
 * 5. Tracking/Telemetry/List
 * 
 * Returns structured results per test, with error classification.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  buildSsxUrl,
  buildSsxUrlCandidates,
  readAccountConfig,
  extractResponseItems,
  ssxPost,
  ADMIN_BODY_CANDIDATES,
  tryEndpointWithFallback,
  logIntegration,
  getTenantRole,
  type SsxErrorClass,
} from "../_shared/ssx-utils.ts";

interface DiagnosticTest {
  name: string;
  status: "pass" | "fail" | "warn";
  endpoint: string;
  status_code: number;
  error_class: SsxErrorClass | null;
  items_found: number;
  duration_ms: number;
  details: string;
}

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

    const role = await getTenantRole(supabase, account.tenant_id, userData.user.id);
    if (!role || !["owner", "admin"].includes(role)) {
      return jsonResp({ error: "Forbidden" }, 403);
    }

    const config = readAccountConfig(account);
    const tests: DiagnosticTest[] = [];

    // TEST 1: Token validity
    const tokenValid = !!config.token && !!account.token_expires_at &&
      new Date(account.token_expires_at).getTime() > Date.now();
    tests.push({
      name: "token_validity",
      status: tokenValid ? "pass" : "fail",
      endpoint: "-",
      status_code: 0,
      error_class: null,
      items_found: 0,
      duration_ms: 0,
      details: tokenValid
        ? `Token valid until ${account.token_expires_at}`
        : "Token missing or expired. Run ssx-login first.",
    });

    if (!tokenValid) {
      await logDiagnostic(supabase, account, integration_account_id, tests);
      return jsonResp({ success: true, tests, summary: "Token invalid — cannot proceed with API tests" });
    }

    // TEST 2: Administration/Tracker/List
    const trackerUrls = buildSsxUrlCandidates(config.baseUrl, config.apiVersion, "/Administration/Tracker/List");
    const trackerResult = await tryEndpointWithFallback({
      urlCandidates: trackerUrls,
      token: config.token,
      bodyCandidates: ADMIN_BODY_CANDIDATES,
      timeoutMs: 15_000,
    });
    tests.push({
      name: "admin_tracker_list",
      status: trackerResult.success ? "pass" : (trackerResult.errorClass === "empty_response" ? "warn" : "fail"),
      endpoint: trackerResult.endpoint,
      status_code: trackerResult.statusCode,
      error_class: trackerResult.success ? null : trackerResult.errorClass,
      items_found: trackerResult.items.length,
      duration_ms: trackerResult.attempts.reduce((s, a) => s + a.durationMs, 0),
      details: trackerResult.success
        ? `Found ${trackerResult.items.length} trackers via ${trackerResult.successfulFormat}`
        : `Failed: ${trackerResult.errorClass} — ${trackerResult.errorMessage}. Attempted: ${trackerResult.attempts.map(a => `${a.format}→${a.statusCode}`).join(", ")}`,
    });

    // TEST 3: Administration/Vehicle list (v2 and v1 variants)
    const vehicleUrlsV2 = buildSsxUrlCandidates(config.baseUrl, config.apiVersion, "/Administration/Vehicle/v2/List");
    const vehicleUrlsV1 = buildSsxUrlCandidates(config.baseUrl, config.apiVersion, "/Administration/Vehicle/List");
    const vehicleResult = await tryEndpointWithFallback({
      urlCandidates: [...vehicleUrlsV2, ...vehicleUrlsV1],
      token: config.token,
      bodyCandidates: ADMIN_BODY_CANDIDATES,
      timeoutMs: 15_000,
    });
    tests.push({
      name: "admin_vehicle_list",
      status: vehicleResult.success ? "pass" : (vehicleResult.errorClass === "empty_response" ? "warn" : "fail"),
      endpoint: vehicleResult.endpoint,
      status_code: vehicleResult.statusCode,
      error_class: vehicleResult.success ? null : vehicleResult.errorClass,
      items_found: vehicleResult.items.length,
      duration_ms: vehicleResult.attempts.reduce((s, a) => s + a.durationMs, 0),
      details: vehicleResult.success
        ? `Found ${vehicleResult.items.length} vehicles via ${vehicleResult.successfulFormat}`
        : `Failed: ${vehicleResult.errorClass}. Attempted: ${vehicleResult.attempts.map(a => `${a.format}→${a.statusCode}`).join(", ")}`,
    });

    // TEST 4: Tracking/PositionHistory/List (quick test with short window)
    const posHistUrl = buildSsxUrl(config.baseUrl, config.apiVersion, "/Tracking/PositionHistory/List");
    const since5m = new Date(Date.now() - 5 * 60_000).toISOString();
    const posFilters = [{ PropertyName: "DateTimeGPS", Condition: ">=", Value: since5m }];
    let posResp = await ssxPost(posHistUrl, config.token, posFilters, 15_000);
    if (!posResp.ok && (posResp.status === 400 || posResp.status === 415)) {
      posResp = await ssxPost(posHistUrl, config.token, { Filters: posFilters }, 15_000);
    }
    const posItems = posResp.ok ? extractResponseItems(posResp.parsed) : [];
    tests.push({
      name: "tracking_position_history",
      status: posResp.ok ? (posItems.length > 0 ? "pass" : "warn") : "fail",
      endpoint: posHistUrl,
      status_code: posResp.status,
      error_class: posResp.ok ? null : posResp.errorClass,
      items_found: posItems.length,
      duration_ms: posResp.durationMs,
      details: posResp.ok
        ? `${posItems.length} positions in last 5min`
        : `Failed: ${posResp.errorClass} — ${posResp.text.substring(0, 150)}`,
    });

    // TEST 5: Tracking/Telemetry/List
    const telUrl = buildSsxUrl(config.baseUrl, config.apiVersion, "/Tracking/Telemetry/List");
    const telResp = await ssxPost(telUrl, config.token, null, 15_000);
    const telItems = telResp.ok ? extractResponseItems(telResp.parsed) : [];
    tests.push({
      name: "tracking_telemetry_list",
      status: telResp.ok ? (telItems.length > 0 ? "pass" : "warn") : "fail",
      endpoint: telUrl,
      status_code: telResp.status,
      error_class: telResp.ok ? null : telResp.errorClass,
      items_found: telItems.length,
      duration_ms: telResp.durationMs,
      details: telResp.ok
        ? `${telItems.length} telemetry types available`
        : `Failed: ${telResp.errorClass}`,
    });

    // Summary
    const passed = tests.filter(t => t.status === "pass").length;
    const failed = tests.filter(t => t.status === "fail").length;
    const warned = tests.filter(t => t.status === "warn").length;

    await logDiagnostic(supabase, account, integration_account_id, tests);

    return jsonResp({
      success: true,
      summary: `${passed} passed, ${warned} warnings, ${failed} failed out of ${tests.length} tests`,
      api_version: config.apiVersion,
      base_url: config.baseUrl,
      tests,
    });
  } catch (err: any) {
    console.error("[SSX:diagnostic] error:", err);
    return jsonResp({ error: "Internal error", details: err.message }, 500);
  }
});

async function logDiagnostic(supabase: any, account: any, integrationAccountId: string, tests: DiagnosticTest[]) {
  await logIntegration(supabase, {
    tenant_id: account.tenant_id,
    integration_account_id: integrationAccountId,
    action: "ssx_diagnostic",
    success: tests.every(t => t.status !== "fail"),
    metadata: {
      tests: tests.map(t => ({ name: t.name, status: t.status, items: t.items_found, error_class: t.error_class })),
    },
  });
}

function jsonResp(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
