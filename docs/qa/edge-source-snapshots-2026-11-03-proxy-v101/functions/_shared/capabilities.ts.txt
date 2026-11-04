import type { SupabaseClient } from "@supabase/supabase-js";

import { corsHeaders } from "./cors.ts";

export type IntegrationCapability = "ssx" | "fiscal";

function response(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Shared fail-closed guard for every Edge Function that can contact SSX or the
 * fiscal provider. A missing migration or an unavailable database blocks the
 * operation instead of silently enabling the integration.
 */
export async function requireIntegrationCapability(
  client: SupabaseClient,
  tenantId: string,
  capability: IntegrationCapability,
): Promise<Response | null> {
  const { error } = await client.rpc("assert_tenant_integration_capability_v1", {
    _tenant_id: tenantId,
    _capability: capability,
  });

  if (!error) return null;

  if (error.message.includes("integration_capability_disabled")) {
    return response(403, {
      success: false,
      code: "INTEGRATION_DISABLED",
      capability,
      status: "disabled",
      message: "Integração em implantação",
    });
  }

  console.error("[capability-guard] capability check failed", {
    capability,
    tenant_id: tenantId,
    code: error.code,
  });
  return response(503, {
    success: false,
    code: "CAPABILITY_CHECK_FAILED",
    capability,
    status: "degraded",
    message: "Não foi possível validar a disponibilidade da integração",
  });
}
