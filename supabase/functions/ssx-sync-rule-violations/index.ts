/** Incrementally ingests SSX rule violations using local position IDs as cursor. */

import { createClient } from "@supabase/supabase-js";
import { isCronRequest } from "../_shared/cron-auth.ts";
import { requireIntegrationCapability } from "../_shared/capabilities.ts";
import { claimSync, finishSync, SsxSyncError, type Checkpoint } from "../_shared/ssx-sync-checkpoint.ts";
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
const MAX_COLLECTED_ITEMS = 8000;
// The existing SQL lease lasts90s. Stop provider I/O at30s and bound each DB
// transport to10s, leaving time to persist/ack/log/release before lease expiry.
const POLL_BUDGET_MS = 30_000;
const DATABASE_TIMEOUT_MS = 10_000;
const CHECKPOINT_RESOURCE = "rule_violations_gate";
const MIN_RATE_LIMIT_BACKOFF_SECONDS = 15 * 60;
const MAX_RATE_LIMIT_BACKOFF_SECONDS = 24 * 60 * 60;

function rateLimitBackoffSeconds(code: unknown): number {
  if (code === "rate_limited") return MIN_RATE_LIMIT_BACKOFF_SECONDS;
  if (typeof code !== "string") return 0;
  const match = /^rate_limited:(\d{1,5})$/.exec(code);
  if (!match) return 0;
  return Math.max(MIN_RATE_LIMIT_BACKOFF_SECONDS,
    Math.min(MAX_RATE_LIMIT_BACKOFF_SECONDS, Number(match[1])));
}

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

// Preserve the concrete client defaults and the bounded database transport in
// the type shared by synchronization and failure finalization.
function createAdminClient(supabaseUrl: string, serviceKey: string) {
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, {
      ...init,
      signal: AbortSignal.any([
        ...(init?.signal ? [init.signal] : []),
        AbortSignal.timeout(DATABASE_TIMEOUT_MS),
      ]),
    }) },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  let admin: ReturnType<typeof createAdminClient> | null = null;
  let accountId = "";
  let expectedLast = "0";
  let windowEnd = "0";
  let gate: Checkpoint | null = null;
  let checkpointFailure: SsxSyncError | null = null;
  let finalized = false;

  const synchronize = async (): Promise<Response> => {
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
  
      admin = createAdminClient(supabaseUrl, serviceKey);
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
  
      // Account authorization precedes the privileged claim. The durable gate
      // covers cursor reads, HTTP and writes across different Edge isolates.
      const pollDeadline = performance.now() + POLL_BUDGET_MS;
      gate = await claimSync(admin, accountId, CHECKPOINT_RESOURCE, "", 0);
      if (gate.decision !== "claimed") {
        return jsonResp({ success: true, status: "deferred",
          reason: gate.error_code === "rate_limited" ? "rate_limited_backoff" : "sync_in_progress",
          retry_after_seconds: gate.retry_after_seconds, upserted: 0, requests: 0,
        });
      }
      const remainingPollMs = () => {
        const remaining = Math.floor(pollDeadline - performance.now());
        if (remaining <= 0) throw new Error("time_budget_exhausted");
        return remaining;
      };
  
      const { data: violationCursor, error: cursorReadError } = await admin
        .from("ssx_rule_violation_cursors")
        .select("last_error_code,updated_at")
        .eq("integration_account_id", accountId)
        .maybeSingle();
      if (cursorReadError) throw new Error("cursor_read_failed");
      const cursorUpdatedAt = violationCursor?.updated_at
        ? new Date(violationCursor.updated_at).getTime()
        : 0;
      const backoffSeconds = rateLimitBackoffSeconds(violationCursor?.last_error_code);
      if (
        backoffSeconds > 0
        && cursorUpdatedAt + backoffSeconds * 1000 > Date.now()
      ) {
        return jsonResp({
          success: true,
          status: "deferred",
          reason: "rate_limited_backoff",
          retry_at: new Date(cursorUpdatedAt + backoffSeconds * 1000).toISOString(),
          upserted: 0,
          requests: 0,
        });
      }
  
      const { data: windowData, error: windowError } = await admin.rpc(
        "get_ssx_rule_violation_window_v1",
        { _integration_account_id: accountId, _overlap: 1000, _window_size: 50000000 },
      );
      if (windowError) {
        checkpointFailure = new SsxSyncError("window_unavailable");
        return jsonResp({ error: "Failed to derive rule violation window" }, 500);
      }
      const window = Array.isArray(windowData) ? windowData[0] : windowData;
      if (!window?.should_poll) {
        return jsonResp({ success: true, status: "idle", upserted: 0, requests: 0 });
      }
      expectedLast = String(window.expected_last_position_id);
      let windowStart = String(window.start_position_id);
      windowEnd = String(window.end_position_id);
      const { data: checkpoint, error: checkpointReadError } = await admin
        .from("ssx_sync_checkpoints").select("result")
        .eq("integration_account_id", accountId).eq("resource", CHECKPOINT_RESOURCE)
        .eq("scope_key", "").maybeSingle();
      if (checkpointReadError) throw new Error("checkpoint_read_failed");
      const previous = checkpoint?.result as JsonObject | undefined;
      if (previous?.version === 3 && previous.cursor_position_id === expectedLast
        && typeof previous.resume_position_id === "string"
        && /^\d{1,19}$/.test(previous.resume_position_id)
        && typeof previous.window_end_position_id === "string"
        && /^\d{1,19}$/.test(previous.window_end_position_id)) {
        const resume = BigInt(previous.resume_position_id);
        const previousEnd = BigInt(previous.window_end_position_id);
        const currentEnd = BigInt(windowEnd);
        if (resume >= 1n && resume <= previousEnd && resume <= currentEnd) {
          // Continue completed overlap pages as well as new positions. Taking
          // only expectedLast+1 would miss late violations inside the overlap.
          windowStart = resume.toString();
          windowEnd = (previousEnd < currentEnd ? previousEnd : currentEnd).toString();
        }
      }
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
        const filterCandidates = [
          {
            label: "bounded_position_window",
            filters: [
              { PropertyName: "IdPosition", Condition: ">=", Value: start.toString() },
              { PropertyName: "IdPosition", Condition: "<=", Value: end.toString() },
            ],
          },
          {
            // This is the exact filter shape published in the SSX Tracking docs.
            label: "documented_lower_bound",
            filters: [
              { PropertyName: "IdPosition", Condition: ">=", Value: start.toString() },
            ],
          },
        ];
        let response: Awaited<ReturnType<typeof ssxPost>> | null = null;
        let items: JsonObject[] | null = null;
        for (const candidate of filterCandidates) {
          if (requests >= MAX_REQUESTS) {
            requestBudgetExhausted = true;
            break;
          }
          response = await ssxPost(endpoint, config.token!, candidate.filters,
            Math.min(config.requestTimeoutMs, remainingPollMs()));
          requests++;
          items = response.status === 204 ? [] : strictObjectArray(response.parsed);
          logSsxCall({
            routine: "sync-rule-violations", endpoint, method: "POST", apiVersion: "v2",
            attemptType: candidate.label, statusCode: response.status,
            durationMs: response.durationMs,
            responsePreview: redactedSsxResponsePreview(response.text, response.networkError),
            result: response.ok && items ? (items.length ? "success" : "empty") : "error",
            errorClass: response.ok ? undefined
              : response.status === 429 ? "rate_limited" : response.errorClass,
          });
          if (response.ok || response.errorClass !== "body_incompatible") break;
        }
        if (!response) throw new Error("request_budget_exhausted");
        if (!response.ok) {
          if (response.status === 429 || response.errorClass === "rate_limited") {
            // Preserve the published 15-minute code for a missing/short header.
            // The shared HTTP helper caps Retry-After at 24 hours.
            const providerSeconds = Math.ceil(response.retryAfterSeconds || 0);
            const effectiveSeconds = Math.max(MIN_RATE_LIMIT_BACKOFF_SECONDS,
              Math.min(MAX_RATE_LIMIT_BACKOFF_SECONDS, providerSeconds));
            throw new Error(effectiveSeconds > MIN_RATE_LIMIT_BACKOFF_SECONDS
              ? `rate_limited:${effectiveSeconds}` : "rate_limited");
          }
          throw new Error(response.errorClass || "upstream_failed");
        }
        remainingPollMs();
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
      if (rawItems.length > MAX_COLLECTED_ITEMS) throw new Error("item_budget_exhausted");
      const normalized = rawItems.map(normalizeViolation);
      if (normalized.some((item) => item === null)) throw new Error("invalid_schema");
      const unique = [...new Map(normalized.map((item) => [item!.provider_violation_id, item!])).values()];
      remainingPollMs();
      const observedAt = new Date().toISOString();
      const { data: committed, error: commitError } = await admin.rpc(
        "commit_ssx_rule_violation_window_v3", {
          _integration_account_id: accountId, _lease_token: gate.lease_token,
          _expected_last_position_id: expectedLast, _end_position_id: acknowledgedEnd,
          _window_end_position_id: windowEnd,
          _items: unique, _observed_at: observedAt,
        },
      );
      if (commitError) throw new Error("persistence_failed");
      if (committed?.committed !== true) throw new Error("cursor_conflict");
      const upserted = committed.upserted;
      finalized = true;

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
      const retrySeconds = rateLimitBackoffSeconds(code);
      checkpointFailure = new SsxSyncError(retrySeconds > 0 ? "rate_limited"
        : /^[a-z_]{1,64}$/.test(code) ? code : "request_failed", retrySeconds);
      if (admin && gate?.decision === "claimed" && !finalized) {
        try {
          const ack = await admin.rpc("fail_ssx_rule_violation_window_v2", {
            _integration_account_id: accountId, _lease_token: gate.lease_token,
            _expected_last_position_id: expectedLast, _end_position_id: windowEnd,
            _error_code: code, _retry_seconds: retrySeconds,
          });
          if (ack.error || ack.data !== true) console.error("[SSX:sync-rule-violations] failure finalization unconfirmed");
          else finalized = true;
        } catch {
          console.error("[SSX:sync-rule-violations] failure finalization unavailable");
        }
      }
      console.error("[SSX:sync-rule-violations] failed", { code });
      return jsonResp({ error: "Rule violation synchronization failed", code }, 502);
    }
  };
  const release = async (): Promise<Response | null> => {
    if (admin && gate?.decision === "claimed" && !finalized) {
      try {
        await finishSync(admin, accountId, CHECKPOINT_RESOURCE, "", gate, {}, checkpointFailure);
      } catch {
        // Retain the SQL lease until bounded expiry instead of claiming success.
        console.error("[SSX:sync-rule-violations] checkpoint release unconfirmed");
        return jsonResp({ error: "Rule violation synchronization failed", code: "checkpoint_not_confirmed" }, 502);
      }
    }
    return null;
  };
  const response = await synchronize();
  return (await release()) ?? response;
});
