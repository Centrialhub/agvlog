/** Synchronizes the four reference catalogs needed to interpret SSX positions. */

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

type ResourceType = "actuator" | "event" | "sensor" | "telemetry";
type JsonObject = Record<string, unknown>;

interface CatalogSpec {
  resourceType: ResourceType;
  path: string;
  idField: string;
}

const catalogSpecs: CatalogSpec[] = [
  { resourceType: "actuator", path: "/Tracking/Actuator/List", idField: "IdActuator" },
  { resourceType: "event", path: "/Tracking/Event/List", idField: "IdEvent" },
  { resourceType: "sensor", path: "/Tracking/Sensor/List", idField: "IdSensor" },
  { resourceType: "telemetry", path: "/Tracking/Telemetry/List", idField: "IdTelemetry" },
];

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asCatalogArray(value: unknown): JsonObject[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter((item): item is JsonObject =>
    Boolean(item) && typeof item === "object" && !Array.isArray(item)
  );
  return items.length === value.length ? items : null;
}

function normalizeCatalog(items: JsonObject[], spec: CatalogSpec) {
  const normalized: Array<{ external_id: string; name: string | null }> = [];
  const seen = new Set<string>();
  for (const item of items) {
    const idValue = item[spec.idField];
    if (typeof idValue !== "number" || !Number.isInteger(idValue) || idValue < 0) return null;
    const externalId = String(idValue);
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    const name = typeof item.Name === "string" && item.Name.trim()
      ? item.Name.trim().slice(0, 500)
      : null;
    normalized.push({ external_id: externalId, name });
  }
  return normalized;
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
      ? body.integration_account_id
      : "";
    if (!accountId) return jsonResp({ error: "integration_account_id required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: account, error: accountError } = await admin
      .from("integration_accounts").select("*").eq("id", accountId).single();
    if (accountError || !account) return jsonResp({ error: "Integration account not found" }, 404);

    if (!cron && callerId) {
      const tenantContextError = await requireWorkspaceAccountContext(req, admin, accountId);
      if (tenantContextError) return tenantContextError;
      const role = account.workspace_id
        ? await getWorkspaceRoleForAccount(admin, account.workspace_id, callerId)
        : await getTenantRole(admin, account.tenant_id, callerId);
      if (!role || !["owner", "admin"].includes(role)) {
        return jsonResp({ error: "Forbidden: admin role required" }, 403);
      }
    }

    const capabilityResponse = await requireIntegrationCapability(admin, account.tenant_id, "ssx");
    if (capabilityResponse) return capabilityResponse;
    const config = readAccountConfig(account);
    if (!config.token || !account.token_expires_at ||
      new Date(account.token_expires_at).getTime() - Date.now() < 60_000) {
      return jsonResp({ error: "Token expired or missing. Run ssx-login first." }, 409);
    }

    const counts: Record<ResourceType, number> = {
      actuator: 0,
      event: 0,
      sensor: 0,
      telemetry: 0,
    };
    const failures: ResourceType[] = [];

    for (const spec of catalogSpecs) {
      const endpoint = buildTrackingUrl(config.baseUrl, spec.path);
      const response = await ssxPost(endpoint, config.token, null, config.requestTimeoutMs);
      const items = response.status === 204 ? [] : asCatalogArray(response.parsed);
      const normalized = items ? normalizeCatalog(items, spec) : null;
      logSsxCall({
        routine: "sync-reference-catalog",
        endpoint,
        method: "POST",
        apiVersion: "v1",
        attemptType: spec.resourceType,
        statusCode: response.status,
        durationMs: response.durationMs,
        responsePreview: redactedSsxResponsePreview(response.text, response.networkError),
        result: response.ok && normalized ? (normalized.length > 0 ? "success" : "empty") : "error",
        errorClass: response.ok ? undefined : response.errorClass,
      });
      if (!response.ok || !normalized) {
        failures.push(spec.resourceType);
        continue;
      }

      const { data: replaced, error: replaceError } = await admin.rpc(
        "replace_ssx_tracking_reference_catalog_v1",
        {
          _integration_account_id: accountId,
          _resource_type: spec.resourceType,
          _items: normalized,
        },
      );
      if (replaceError) {
        failures.push(spec.resourceType);
        console.error("[SSX:sync-reference-catalog] persistence failed", {
          resource: spec.resourceType,
          code: replaceError.code,
        });
        continue;
      }
      counts[spec.resourceType] = Number(replaced) || 0;

      if (spec.resourceType === "telemetry") {
        for (const item of normalized) {
          await admin.from("telemetry_catalog").upsert({
            provider: "SSX",
            telemetry_id: item.external_id,
            name: item.name,
            description: item.name,
            raw: { IdTelemetry: Number(item.external_id), Name: item.name },
            updated_at: new Date().toISOString(),
          }, { onConflict: "provider,telemetry_id" });
        }
      }
    }

    await logIntegration(admin, {
      tenant_id: account.tenant_id,
      integration_account_id: accountId,
      action: "ssx_sync_reference_catalogs",
      success: failures.length === 0,
      error_message: failures.length > 0 ? "One or more SSX catalogs failed" : undefined,
      metadata: { counts, failed_resources: failures },
    });
    return jsonResp({
      success: failures.length === 0,
      status: failures.length === 0 ? "success" : "partial",
      catalogs: counts,
      upserted: counts.telemetry,
      failed_resources: failures,
    }, failures.length === 0 ? 200 : 502);
  } catch (error: unknown) {
    console.error("[SSX:sync-reference-catalog] internal failure", {
      kind: error instanceof Error ? error.name : "unknown",
    });
    return jsonResp({ error: "Internal error" }, 500);
  }
});
