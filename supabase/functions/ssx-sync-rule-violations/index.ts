/** Incrementally ingests SSX rule violations using local position IDs as cursor. */

import { createClient } from "@supabase/supabase-js";
import { isCronRequest } from "../_shared/cron-auth.ts";
import { requireIntegrationCapability } from "../_shared/capabilities.ts";
import {
  buildTrackingUrl,
  corsHeaders,
  getTenantRole,
  getWorkspaceRoleForAccount,
  logIntegration,
  logSsxCall,
  readAccountConfig,
  redactedSsxResponsePreview,
  requireWorkspaceAccountContext,
  ssxPost,
} from "../_shared/ssx-utils.ts";

type JsonObject = Record<string, unknown>;
const RESULT_LIMIT = 500;
const MAX_REQUESTS = 32;

const SAFE_PAYLOAD_FIELDS = [
  "IdRuleViolation", "RuleIntegrationCode", "TrackedUnitIntegrationCode",
  "IdTrackedUnitType", "TrackedUnit", "TrackerSlot", "Rule",
  "OrganizationalUnitIntegrationCode", "DriverIntegrationCode", "Driver",
  "Ticket", "InitialDate", "FinalDate", "InitialAddress", "FinalAddress",
  "LatitudeStartViolation", "LongitudeStartViolation",
  "LatitudeEndViolation", "LongitudeEndViolation", "OdometroIncial",
  "OdometroFinal", "TravelledDistance", "RoadSpeedLimit", "TelemetryList",
  "GeographyArea", "LostPoints", "EvaluationFormula",
] as const;

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function strictObjectArray(value: unknown): JsonObject[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item): item is JsonObject =>
    Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
  return items.length === value.length ? items : null;
}

function optionalText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text ? text.slice(0, 200) : null;
}

function optionalDate(value: unknown): string | null | undefined {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function normalizeViolation(item: JsonObject) {
  const id = item.IdRuleViolation;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) return null;
  const initialDate = optionalDate(item.InitialDate);
  const finalDate = optionalDate(item.FinalDate);
  if (initialDate === undefined || finalDate === undefined) return null;
  const payload: JsonObject = {};
  for (const field of SAFE_PAYLOAD_FIELDS) {
    if (item[field] !== undefined) payload[field] = item[field];
  }
  return {
    provider_violation_id: id,
    rule_integration_code: optionalText(item.RuleIntegrationCode),
    tracked_unit_integration_code: optionalText(item.TrackedUnitIntegrationCode),
    organizational_unit_integration_code: optionalText(item.OrganizationalUnitIntegrationCode),
    driver_integration_code: optionalText(item.DriverIntegrationCode),
    initial_date: initialDate,
    final_date: finalDate,
    payload,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  let admin: ReturnType<typeof createClient> | null = null;
  let accountId = "";
  let expectedLast = "0";
  let windowEnd = "0";

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const cron = await isCronRequest(req, supabaseUrl, serviceKey);
    const authHeader = req.headers.get("Authorization") || "";
    let callerId: string | null = null;
    if (!cron) {
      if (!authHeader.startsWith("Bearer ")) return jsonResp({ error: "Unauthorized" }, 401);
      const anon = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data, error } = await anon.auth.getUser();
      if (error || !data?.user) return jsonResp({ error: "Unauthorized" }, 401);
      callerId = data.user.id;
    }

    const body = await req.json() as JsonObject;
    accountId = typeof body.integration_account_id === "string"
      ? body.integration_account_id : "";
    if (!accountId) return jsonResp({ error: "integration_account_id required" }, 400);

    admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: account, error: accountError } = await admin
      .from("integration_accounts").select("*").eq("id", accountId).single();
    if (accountError || !account) return jsonResp({ error: "Integration account not found" }, 404);

    if (!cron && callerId) {
      const contextError = await requireWorkspaceAccountContext(req, admin, accountId);
      if (contextError) return contextError;
      const role = account.workspace_id
        ? await getWorkspaceRoleForAccount(admin, account.workspace_id, callerId)
        : await getTenantRole(admin, account.tenant_id, callerId);
      if (!role || !["owner", "admin"].includes(role)) return jsonResp({ error: "Forbidden" }, 403);
    }

    const capabilityError = await requireIntegrationCapability(admin, account.tenant_id, "ssx");
    if (capabilityError) return capabilityError;
    const config = readAccountConfig(account);
    if (!config.token || !account.token_expires_at ||
      new Date(account.token_expires_at).getTime() - Date.now() < 60_000) {
      return jsonResp({ error: "Token expired or missing. Run ssx-login first." }, 409);
    }

    const { data: windowData, error: windowError } = await admin.rpc(
      "get_ssx_rule_violation_window_v1",
      { _integration_account_id: accountId, _overlap: 1000, _window_size: 50000000 },
    );
    if (windowError) return jsonResp({ error: "Failed to derive rule violation window" }, 500);
    const window = Array.isArray(windowData) ? windowData[0] : windowData;
    if (!window?.should_poll) {
      return jsonResp({ success: true, status: "idle", upserted: 0, requests: 0 });
    }
    expectedLast = String(window.expected_last_position_id);
    const windowStart = String(window.start_position_id);
    windowEnd = String(window.end_position_id);
    const endpoint = buildTrackingUrl(config.baseUrl, "/Tracking/RuleViolation/v2/List");
    let requests = 0;
    let requestBudgetExhausted = false;
    let hardSaturated = false;
    let completedThrough = BigInt(windowStart) - 1n;

    const fetchRange = async (start: bigint, end: bigint): Promise<JsonObject[]> => {
      if (requests >= MAX_REQUESTS) {
        requestBudgetExhausted = true;
        return [];
      }
      const response = await ssxPost(endpoint, config.token!, [
        { PropertyName: "IdPosition", Condition: ">=", Value: start.toString() },
        { PropertyName: "IdPosition", Condition: "<=", Value: end.toString() },
      ], config.requestTimeoutMs);
      requests++;
      const items = response.status === 204 ? [] : strictObjectArray(response.parsed);
      logSsxCall({
        routine: "sync-rule-violations", endpoint, method: "POST", apiVersion: "v2",
        attemptType: "bounded_position_window", statusCode: response.status,
        durationMs: response.durationMs,
        responsePreview: redactedSsxResponsePreview(response.text, response.networkError),
        result: response.ok && items ? (items.length ? "success" : "empty") : "error",
        errorClass: response.ok ? undefined : response.errorClass,
      });
      if (!response.ok) throw new Error(response.errorClass || "upstream_failed");
      if (!items) throw new Error("invalid_schema");
      if (items.length < RESULT_LIMIT) {
        completedThrough = end;
        return items;
      }
      if (start >= end) {
        hardSaturated = true;
        return [];
      }
      const midpoint = start + ((end - start) / 2n);
      const left = await fetchRange(start, midpoint);
      if (hardSaturated || requestBudgetExhausted) return left;
      const right = await fetchRange(midpoint + 1n, end);
      return [...left, ...right];
    };

    const rawItems = await fetchRange(BigInt(windowStart), BigInt(windowEnd));
    if (hardSaturated) throw new Error("single_position_result_saturated");
    if (requestBudgetExhausted && completedThrough < BigInt(windowStart)) {
      throw new Error("request_budget_exhausted");
    }
    const acknowledgedEnd = requestBudgetExhausted ? completedThrough.toString() : windowEnd;
    const normalized = rawItems.map(normalizeViolation);
    if (normalized.some((item) => item === null)) throw new Error("invalid_schema");
    const unique = [...new Map(normalized.map((item) => [item!.provider_violation_id, item!])).values()];
    const observedAt = new Date().toISOString();
    const { data: upserted, error: upsertError } = await admin.rpc(
      "upsert_ssx_rule_violations_v1",
      { _integration_account_id: accountId, _items: unique, _observed_at: observedAt },
    );
    if (upsertError) throw new Error("persistence_failed");

    const { data: acked, error: ackError } = await admin.rpc(
      "ack_ssx_rule_violation_window_v1",
      {
        _integration_account_id: accountId,
        _expected_last_position_id: expectedLast,
        _end_position_id: acknowledgedEnd,
        _success: true,
        _error_code: null,
      },
    );
    if (ackError || acked !== true) throw new Error("cursor_conflict");

    await logIntegration(admin, {
      tenant_id: account.tenant_id,
      integration_account_id: accountId,
      action: "ssx_sync_rule_violations",
      success: true,
      metadata: {
        requests, received: rawItems.length, upserted: Number(upserted) || 0,
        partial_window: requestBudgetExhausted,
      },
    });
    return jsonResp({
      success: true, status: requestBudgetExhausted ? "partial" : "success", requests,
      received: rawItems.length, upserted: Number(upserted) || 0,
      cursor_advanced: true, partial_window: requestBudgetExhausted,
    });
  } catch (error: unknown) {
    const code = error instanceof Error ? error.message.slice(0, 100) : "unknown";
    if (admin && accountId && windowEnd !== "0") {
      await admin.rpc("ack_ssx_rule_violation_window_v1", {
        _integration_account_id: accountId,
        _expected_last_position_id: expectedLast,
        _end_position_id: windowEnd,
        _success: false,
        _error_code: code,
      });
    }
    console.error("[SSX:sync-rule-violations] failed", { code });
    return jsonResp({ error: "Rule violation synchronization failed", code }, 502);
  }
});
