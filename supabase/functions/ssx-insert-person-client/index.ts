/**
 * Clients are legal/commercial entities and are not Tracking Person records.
 * This endpoint is retained only as a fail-closed compatibility boundary. A
 * future client export must use the separately licensed Administration/Client
 * capability and its own reviewed contract.
 */

import { createClient } from "@supabase/supabase-js";
import { requireIntegrationCapability } from "../_shared/capabilities.ts";
import { requireActiveTenant } from "../_shared/active-tenant.ts";
import { corsHeaders, getTenantRole } from "../_shared/ssx-utils.ts";

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResp({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await anonClient.auth.getUser();
    if (userError || !userData?.user) return jsonResp({ error: "Unauthorized" }, 401);

    const body = await req.json() as Record<string, unknown>;
    const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
    const accountId = typeof body.integration_account_id === "string"
      ? body.integration_account_id
      : "";
    if (!tenantId || !accountId) {
      return jsonResp({ error: "tenant_id and integration_account_id required" }, 400);
    }
    const tenantContextError = requireActiveTenant(req, tenantId);
    if (tenantContextError) return tenantContextError;

    const admin = createClient(supabaseUrl, serviceKey);
    const role = await getTenantRole(admin, tenantId, userData.user.id);
    if (!role || !["owner", "admin", "operator"].includes(role)) {
      return jsonResp({ error: "Forbidden" }, 403);
    }
    const capabilityResponse = await requireIntegrationCapability(admin, tenantId, "ssx");
    if (capabilityResponse) return capabilityResponse;

    const { data: matchesWorkspace, error: workspaceError } = await admin.rpc(
      "integration_account_matches_tenant_workspace_v1",
      { _tenant_id: tenantId, _integration_account_id: accountId },
    );
    if (workspaceError || matchesWorkspace !== true) {
      return jsonResp({ error: "Integration account not found" }, 404);
    }

    return jsonResp({
      error: "SSX_CLIENT_REQUIRES_ADMINISTRATION_CAPABILITY",
      message: "Clientes empresariais não podem ser enviados como pessoas do produto Tracking.",
    }, 409);
  } catch (error: unknown) {
    console.error("[SSX:person-client-disabled] internal failure", {
      kind: error instanceof Error ? error.name : "unknown",
    });
    return jsonResp({ error: "Internal error" }, 500);
  }
});
