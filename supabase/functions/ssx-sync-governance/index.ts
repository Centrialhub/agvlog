/** Synchronizes read-only SSX governance, role, rule and trailer snapshots. */

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
type ResourceType =
  | "evaluation_formula" | "person_role" | "trailer" | "logged_rule"
  | "compatible_rule" | "unit_rule" | "rule_unit";

interface SnapshotSpec {
  resourceType: ResourceType;
  path: string;
  keyField: string;
  body: unknown;
  scopeKey?: string;
}

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

function normalizeSnapshot(items: JsonObject[], keyField: string) {
  const result: Array<{ external_key: string; payload: JsonObject }> = [];
  const seen = new Set<string>();
  for (const item of items) {
    const rawKey = item[keyField];
    if ((typeof rawKey !== "string" && typeof rawKey !== "number") || !String(rawKey).trim()) {
      return null;
    }
    const externalKey = String(rawKey).trim();
    if (externalKey.length > 200) return null;
    if (seen.has(externalKey)) continue;
    seen.add(externalKey);
    result.push({ external_key: externalKey, payload: item });
  }
  return result;
}

async function mapBounded<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const output: R[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await mapper(items[index]);
    }
  }));
  return output;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

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
    const accountId = typeof body.integration_account_id === "string"
      ? body.integration_account_id : "";
    if (!accountId) return jsonResp({ error: "integration_account_id required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey, {
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

    const counts: Partial<Record<ResourceType, number>> = {};
    const failures: Array<{ resource: ResourceType; scope: string; code: string }> = [];
    const observedAt = new Date().toISOString();

    const syncSnapshot = async (spec: SnapshotSpec): Promise<JsonObject[] | null> => {
      const scope = spec.scopeKey || "";
      const endpoint = buildTrackingUrl(config.baseUrl, spec.path);
      const response = await ssxPost(endpoint, config.token!, spec.body, config.requestTimeoutMs);
      const items = response.status === 204 ? [] : strictObjectArray(response.parsed);
      const normalized = items ? normalizeSnapshot(items, spec.keyField) : null;
      logSsxCall({
        routine: "sync-governance", endpoint, method: "POST", apiVersion: "v1",
        attemptType: spec.resourceType, statusCode: response.status,
        durationMs: response.durationMs,
        responsePreview: redactedSsxResponsePreview(response.text, response.networkError),
        result: response.ok && normalized ? (normalized.length ? "success" : "empty") : "error",
        errorClass: response.ok ? undefined : response.errorClass,
      });
      if (!response.ok || !normalized) {
        failures.push({ resource: spec.resourceType, scope, code: response.errorClass || "invalid_schema" });
        return null;
      }
      const { data, error } = await admin.rpc("replace_ssx_tracking_snapshot_v1", {
        _integration_account_id: accountId,
        _resource_type: spec.resourceType,
        _scope_key: scope,
        _items: normalized,
        _received_at: observedAt,
      });
      if (error) {
        failures.push({ resource: spec.resourceType, scope, code: "persistence_failed" });
        return null;
      }
      counts[spec.resourceType] = (counts[spec.resourceType] || 0) + (Number(data) || 0);
      return items;
    };

    const globalSpecs: SnapshotSpec[] = [
      { resourceType: "evaluation_formula", path: "/Tracking/EvaluationFormula/List", keyField: "EvaluationFormulaIntegrationCode", body: null },
      { resourceType: "person_role", path: "/Tracking/Person/ListPersonRole", keyField: "PersonRoleIntegrationCode", body: null },
      { resourceType: "trailer", path: "/Tracking/Trailer/List", keyField: "IntegrationCode", body: null },
      { resourceType: "logged_rule", path: "/Tracking/RuleList/ListRuleOfLoggedUser", keyField: "RuleIntegrationCode", body: null },
    ];
    const globalResults = await mapBounded(globalSpecs, 4, syncSnapshot);
    const loggedRules = globalResults[3] || [];

    const { data: units, error: unitsError } = await admin.from("provider_units")
      .select("external_code").eq("integration_account_id", accountId).eq("active", true)
      .order("external_code").limit(251);
    if (unitsError) return jsonResp({ error: "Failed to read provider units" }, 500);
    if ((units || []).length > 250) {
      failures.push({ resource: "unit_rule", scope: "", code: "unit_limit_exceeded" });
    }
    const unitCodes = (units || []).slice(0, 250)
      .map((unit) => String(unit.external_code || "").trim()).filter(Boolean);
    await mapBounded(unitCodes, 4, async (unitCode) => {
      await syncSnapshot({
        resourceType: "compatible_rule", path: "/Tracking/RuleCompatible/List",
        keyField: "RuleIntegrationCode", scopeKey: unitCode,
        body: { TrackingUnitIntegrationCode: unitCode },
      });
      await syncSnapshot({
        resourceType: "unit_rule", path: "/Tracking/RuleList/ListRulesByUnitTracked",
        keyField: "RuleIntegrationCode", scopeKey: unitCode,
        body: [{ PropertyName: "TrackedUnitIntegrationCode", Condition: "=", Value: unitCode }],
      });
    });

    const ruleCodes = loggedRules.map((rule) => String(rule.RuleIntegrationCode || "").trim())
      .filter(Boolean).slice(0, 250);
    if (loggedRules.length > 250) {
      failures.push({ resource: "rule_unit", scope: "", code: "rule_limit_exceeded" });
    }
    await mapBounded(ruleCodes, 4, (ruleCode) => syncSnapshot({
      resourceType: "rule_unit", path: "/Tracking/RuleList/ListUnitTrackedByRule",
      keyField: "TrackedUnitIntegrationCode", scopeKey: ruleCode,
      body: { RuleIntegrationCode: ruleCode },
    }));

    await logIntegration(admin, {
      tenant_id: account.tenant_id,
      integration_account_id: accountId,
      action: "ssx_sync_governance",
      success: failures.length === 0,
      error_message: failures.length ? "One or more SSX governance resources failed" : undefined,
      metadata: { counts, failures: failures.slice(0, 50) },
    });
    return jsonResp({
      success: failures.length === 0,
      status: failures.length === 0 ? "success" : "partial",
      snapshots: counts,
      failed_resources: failures,
    }, failures.length === 0 ? 200 : 502);
  } catch (error: unknown) {
    console.error("[SSX:sync-governance] internal failure", {
      kind: error instanceof Error ? error.name : "unknown",
    });
    return jsonResp({ error: "Internal error" }, 500);
  }
});
