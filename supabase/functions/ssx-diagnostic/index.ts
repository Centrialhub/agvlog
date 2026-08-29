/**
 * ssx-diagnostic — Tests SSX integration connectivity end-to-end.
 * 
 * IMPORTANT: Uses the SAME discovery helpers as ssx-sync-units to ensure
 * identical endpoint strategy in diagnostic and production.
 * 
 * Tests performed (in production priority order):
 * 1. Token validity
 * 2. Administration/Vehicle/v2/List + Vehicle/List (PRIMARY catalog source)
 * 3. Administration/Tracker/List (enrichment only)
 * 4. Tracking/PositionHistory/List
 * 5. Tracking/Telemetry/List
 * 6. HashAuth configuration check
 * 
 * Returns structured results per test, with error classification and attempt matrix.
 */

import { createClient } from "@supabase/supabase-js";
import { requireIntegrationCapability } from "../_shared/capabilities.ts";
import {
  corsHeaders,
  buildSsxUrlCandidates,
  buildAdminUrlCandidates,
  buildPositionHistoryUrlCandidates,
  readAccountConfig,
  tryEndpointWithFallback,
  getAdminToken,
  ADMIN_BODY_CANDIDATES,
  logIntegration,
  summarizeAttemptMatrix,
  getTenantRole,
  type SsxErrorClass,
  type AttemptLog,
} from "../_shared/ssx-utils.ts";

interface DiagnosticTest {
  name: string;
  status: "pass" | "fail" | "warn";
  endpoint: string;
  endpoint_candidates: string[];
  body_candidates_tried: string[];
  token_mode: string;
  status_code: number;
  error_class: SsxErrorClass | null;
  items_found: number;
  duration_ms: number;
  details: string;
  attempt_matrix: string[];
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

    const capabilityResponse = await requireIntegrationCapability(supabase, account.tenant_id, "ssx");
    if (capabilityResponse) return capabilityResponse;

    const config = readAccountConfig(account);
    const tests: DiagnosticTest[] = [];

    // TEST 1: Token validity
    const tokenValid = !!config.token && !!account.token_expires_at &&
      new Date(account.token_expires_at).getTime() > Date.now();
    tests.push({
      name: "token_validity",
      status: tokenValid ? "pass" : "fail",
      endpoint: "-",
      endpoint_candidates: [],
      body_candidates_tried: [],
      token_mode: "regular",
      status_code: 0,
      error_class: null,
      items_found: 0,
      duration_ms: 0,
      details: tokenValid
        ? `Token valid until ${account.token_expires_at}`
        : "Token missing or expired. Run ssx-login first.",
      attempt_matrix: [],
    });

    if (!tokenValid) {
      await logDiagnostic(supabase, account, integration_account_id, tests);
      return jsonResp({ success: true, tests, summary: "Token invalid — cannot proceed with API tests" });
    }

    // --- Prepare tokens ---
    const adminTokenResult = await getAdminToken(config, supabase, integration_account_id);
    const tokens: { label: string; token: string }[] = [];
    if (adminTokenResult.token) tokens.push({ label: "admin_token", token: adminTokenResult.token });
    if (config.token && config.token !== adminTokenResult.token) tokens.push({ label: "regular_token", token: config.token });
    if (tokens.length === 0 && config.token) tokens.push({ label: "regular_token", token: config.token });

    // TEST 2: Administration/Vehicle list (v2 and v1 variants) — PRIMARY
    const vehicleV2Urls = buildAdminUrlCandidates(config.baseUrl, config.apiVersion, "/Administration/Vehicle/v2/List");
    const vehicleV1Urls = buildAdminUrlCandidates(config.baseUrl, config.apiVersion, "/Administration/Vehicle/List");
    const allVehicleUrls = [...vehicleV2Urls, ...vehicleV1Urls];
    const vehicleAllAttempts: AttemptLog[] = [];
    let vehicleSuccess = false;
    let vehicleItems: any[] = [];
    let vehicleWinningEndpoint = allVehicleUrls[0];
    let vehicleWinningFormat = "";
    let vehicleWinningToken = "";
    let vehicleErrorClass: SsxErrorClass | null = null;
    const vehicleStart = Date.now();

    for (const { label, token } of tokens) {
      const result = await tryEndpointWithFallback({
        urlCandidates: allVehicleUrls,
        token,
        bodyCandidates: ADMIN_BODY_CANDIDATES,
        timeoutMs: 15_000,
        abortOnAuthError: false,
      });
      vehicleAllAttempts.push(...result.attempts);

      if (result.success && result.items.length > 0) {
        vehicleSuccess = true;
        vehicleItems = result.items;
        vehicleWinningEndpoint = result.endpoint;
        vehicleWinningFormat = result.successfulFormat || "";
        vehicleWinningToken = label;
        break;
      }
      vehicleErrorClass = result.errorClass;
    }

    if (!vehicleSuccess && !vehicleErrorClass) {
      vehicleErrorClass = vehicleAllAttempts.length > 0
        ? vehicleAllAttempts[vehicleAllAttempts.length - 1].errorClass
        : "unknown";
    }

    tests.push({
      name: "admin_vehicle_list",
      status: vehicleSuccess ? "pass" : (vehicleErrorClass === "empty_response" ? "warn" : "fail"),
      endpoint: vehicleWinningEndpoint,
      endpoint_candidates: allVehicleUrls,
      body_candidates_tried: ADMIN_BODY_CANDIDATES.map(b => b.label),
      token_mode: vehicleWinningToken || tokens.map(t => t.label).join(","),
      status_code: vehicleAllAttempts.length > 0 ? vehicleAllAttempts[vehicleAllAttempts.length - 1].statusCode : 0,
      error_class: vehicleSuccess ? null : vehicleErrorClass,
      items_found: vehicleItems.length,
      duration_ms: Date.now() - vehicleStart,
      details: vehicleSuccess
        ? `Found ${vehicleItems.length} vehicles via ${vehicleWinningToken}:${vehicleWinningFormat} at ${vehicleWinningEndpoint}`
        : `Failed: ${vehicleErrorClass}`,
      attempt_matrix: summarizeAttemptMatrix(vehicleAllAttempts),
    });

    // TEST 3: Administration/Tracker/List (enrichment)
    const trackerUrls = buildAdminUrlCandidates(config.baseUrl, config.apiVersion, "/Administration/Tracker/List");
    const trackerAllAttempts: AttemptLog[] = [];
    let trackerSuccess = false;
    let trackerItems: any[] = [];
    let trackerWinningEndpoint = trackerUrls[0];
    let trackerWinningFormat = "";
    let trackerWinningToken = "";
    let trackerErrorClass: SsxErrorClass | null = null;
    const trackerStart = Date.now();

    for (const { label, token } of tokens) {
      const result = await tryEndpointWithFallback({
        urlCandidates: trackerUrls,
        token,
        bodyCandidates: ADMIN_BODY_CANDIDATES,
        timeoutMs: 15_000,
        abortOnAuthError: false,
      });
      trackerAllAttempts.push(...result.attempts);

      if (result.success && result.items.length > 0) {
        trackerSuccess = true;
        trackerItems = result.items;
        trackerWinningEndpoint = result.endpoint;
        trackerWinningFormat = result.successfulFormat || "";
        trackerWinningToken = label;
        break;
      }
      trackerErrorClass = result.errorClass;
    }

    if (!trackerSuccess && !trackerErrorClass) {
      trackerErrorClass = trackerAllAttempts.length > 0
        ? trackerAllAttempts[trackerAllAttempts.length - 1].errorClass
        : "unknown";
    }

    tests.push({
      name: "admin_tracker_list",
      status: trackerSuccess ? "pass" : (trackerErrorClass === "empty_response" ? "warn" : "fail"),
      endpoint: trackerWinningEndpoint,
      endpoint_candidates: trackerUrls,
      body_candidates_tried: ADMIN_BODY_CANDIDATES.map(b => b.label),
      token_mode: trackerWinningToken || tokens.map(t => t.label).join(","),
      status_code: trackerAllAttempts.length > 0 ? trackerAllAttempts[trackerAllAttempts.length - 1].statusCode : 0,
      error_class: trackerSuccess ? null : trackerErrorClass,
      items_found: trackerItems.length,
      duration_ms: Date.now() - trackerStart,
      details: trackerSuccess
        ? `Found ${trackerItems.length} trackers via ${trackerWinningToken}:${trackerWinningFormat} at ${trackerWinningEndpoint} (enrichment only)`
        : `Failed: ${trackerErrorClass} (enrichment not critical)`,
      attempt_matrix: summarizeAttemptMatrix(trackerAllAttempts),
    });

    // TEST 4: Tracking/PositionHistory/List
    const posHistUrls = buildPositionHistoryUrlCandidates(config.baseUrl, config.apiVersion);
    const since5m = new Date(Date.now() - 5 * 60_000).toISOString();
    const timeFilterProp = config.settings.time_filter_property || "EventDate";
    const posFilters = [{ PropertyName: timeFilterProp, Condition: ">=", Value: since5m }];
    const posFiltersAlt = [{ PropertyName: "DateTimeGPS", Condition: ">=", Value: since5m }];

    const posStart = Date.now();
    const posBodies: { label: string; body: any }[] = [
      { label: "array_filters", body: posFilters },
      { label: "wrapped_filters", body: { Filters: posFilters } },
      { label: "array_filters_alt_time", body: posFiltersAlt },
      { label: "wrapped_filters_alt_time", body: { Filters: posFiltersAlt } },
    ];
    const posResult = await tryEndpointWithFallback({
      urlCandidates: posHistUrls,
      token: config.token,
      bodyCandidates: posBodies,
      timeoutMs: 15_000,
      abortOnAuthError: true,
    });

    tests.push({
      name: "tracking_position_history",
      status: posResult.success ? (posResult.items.length > 0 ? "pass" : "warn") : "fail",
      endpoint: posResult.endpoint,
      endpoint_candidates: posHistUrls,
      body_candidates_tried: posBodies.map(b => b.label),
      token_mode: "regular_token",
      status_code: posResult.attempts.length > 0 ? posResult.attempts[posResult.attempts.length - 1].statusCode : 0,
      error_class: posResult.success ? null : posResult.errorClass,
      items_found: posResult.items.length,
      duration_ms: Date.now() - posStart,
      details: posResult.success
        ? `${posResult.items.length} positions in last 5min (format: ${posResult.successfulFormat})`
        : `Failed: ${posResult.errorClass}`,
      attempt_matrix: summarizeAttemptMatrix(posResult.attempts),
    });

    // TEST 5: Tracking/Telemetry/List
    const telUrls = buildSsxUrlCandidates(config.baseUrl, config.apiVersion, "/Tracking/Telemetry/List");
    const telStart = Date.now();
    const telResult = await tryEndpointWithFallback({
      urlCandidates: telUrls,
      token: config.token,
      bodyCandidates: [{ label: "null_body", body: null }, { label: "empty_array", body: [] }],
      timeoutMs: 15_000,
      abortOnAuthError: true,
    });

    tests.push({
      name: "tracking_telemetry_list",
      status: telResult.success ? (telResult.items.length > 0 ? "pass" : "warn") : "fail",
      endpoint: telResult.endpoint,
      endpoint_candidates: telUrls,
      body_candidates_tried: ["null_body", "empty_array"],
      token_mode: "regular_token",
      status_code: telResult.attempts.length > 0 ? telResult.attempts[telResult.attempts.length - 1].statusCode : 0,
      error_class: telResult.success ? null : telResult.errorClass,
      items_found: telResult.items.length,
      duration_ms: Date.now() - telStart,
      details: telResult.success
        ? `${telResult.items.length} telemetry types available (format: ${telResult.successfulFormat})`
        : `Failed: ${telResult.errorClass}`,
      attempt_matrix: summarizeAttemptMatrix(telResult.attempts),
    });

    // TEST 6: HashAuth configuration check
    const hasHashAuth = !!config.hashauth;
    const posHistFailed = !posResult.success;
    let hashAuthStatus: "pass" | "fail" | "warn" = "pass";
    let hashAuthDetails = "";

    if (!hasHashAuth && posHistFailed) {
      hashAuthStatus = "fail";
      hashAuthDetails = "HashAuth não configurado e PositionHistory falhou. O polling de posições provavelmente não funcionará sem HashAuth. Configure HashAuth nas credenciais da integração.";
    } else if (!hasHashAuth) {
      hashAuthStatus = "warn";
      hashAuthDetails = "HashAuth não configurado. O polling de posições pode parar de funcionar. Recomenda-se configurar HashAuth para garantir acesso ao Tracking/PositionHistory.";
    } else {
      hashAuthDetails = "HashAuth configurado corretamente.";
    }

    tests.push({
      name: "hashauth_config",
      status: hashAuthStatus,
      endpoint: "-",
      endpoint_candidates: [],
      body_candidates_tried: [],
      token_mode: "-",
      status_code: 0,
      error_class: null,
      items_found: 0,
      duration_ms: 0,
      details: hashAuthDetails,
      attempt_matrix: [],
    });

    // Summary
    const passed = tests.filter(t => t.status === "pass").length;
    const failed = tests.filter(t => t.status === "fail").length;
    const warned = tests.filter(t => t.status === "warn").length;

    // Build actionable summary
    const summaryParts: string[] = [`${passed} passed, ${warned} warnings, ${failed} failed out of ${tests.length} tests`];
    if (vehicleSuccess) {
      summaryParts.push(`✓ Catálogo admin funcional (${vehicleItems.length} veículos)`);
    } else {
      summaryParts.push("✗ Catálogo admin indisponível — sync usará fallback");
    }
    if (posResult.success && posResult.items.length > 0) {
      summaryParts.push(`✓ Polling de posições funcional`);
    } else if (posResult.success) {
      summaryParts.push("⚠ PositionHistory respondeu vazio (sem dados recentes)");
    } else {
      summaryParts.push(`✗ Polling de posições falhou (${posResult.errorClass})`);
    }
    if (!hasHashAuth) {
      summaryParts.push("⚠ HashAuth ausente — configuração incompleta para tracking");
    }

    await logDiagnostic(supabase, account, integration_account_id, tests);

    return jsonResp({
      success: true,
      summary: summaryParts.join(" | "),
      api_version: config.apiVersion,
      base_url: config.baseUrl,
      admin_token_available: !!adminTokenResult.token,
      admin_token_error: adminTokenResult.error,
      hashauth_configured: hasHashAuth,
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
      tests: tests.map(t => ({
        name: t.name, status: t.status, items: t.items_found,
        error_class: t.error_class, token_mode: t.token_mode,
        winning_endpoint: t.endpoint,
        endpoint_candidates: t.endpoint_candidates,
        body_candidates_tried: t.body_candidates_tried,
        attempt_matrix: t.attempt_matrix,
      })),
    },
  });
}

function jsonResp(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
