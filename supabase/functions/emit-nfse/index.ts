// Legacy NFS-e endpoint kept only to reject unsupported provider paths safely.
// Production emission/cancellation is performed by hub-fiscal-proxy.

import { createClient } from "@supabase/supabase-js";
import { requireIntegrationCapability } from "../_shared/capabilities.ts";
import { corsHeaders } from "../_shared/cors.ts";

interface Body {
  action: "emit" | "cancel" | "consult";
  nfse_id: string;
  reason?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: claims, error: cErr } = await supabase.auth.getClaims(
    authHeader.replace("Bearer ", ""),
  );
  if (cErr || !claims?.claims) return json({ error: "Unauthorized" }, 401);
  const userId = claims.claims.sub;

  let body: Body;
  try { body = await req.json(); }
  catch { return json({ error: "Invalid body" }, 400); }

  if (!body?.nfse_id || !body?.action) return json({ error: "nfse_id and action required" }, 400);

  // Load NFS-e (RLS ensures tenant access)
  const { data: doc, error: dErr } = await supabase
    .from("nfse_documents").select("*").eq("id", body.nfse_id).maybeSingle();
  if (dErr) return json({ error: dErr.message }, 400);
  if (!doc) return json({ error: "NFS-e não encontrada" }, 404);

  const { data: membership } = await admin
    .from("tenant_memberships")
    .select("role")
    .eq("tenant_id", doc.tenant_id)
    .eq("user_id", userId)
    .eq("active", true)
    .in("role", ["owner", "admin", "operator"])
    .maybeSingle();
  if (!membership) return json({ error: "Forbidden" }, 403);

  const capabilityResponse = await requireIntegrationCapability(admin, doc.tenant_id, "fiscal");
  if (capabilityResponse) return capabilityResponse;

  // Load provider config
  const { data: cfg } = await supabase
    .from("nfse_provider_configs").select("*")
    .eq("tenant_id", doc.tenant_id)
    .eq("branch_code", doc.branch_code)
    .maybeSingle();

  const provider = cfg?.provider ?? "manual";
  const enabled = !!cfg?.enabled;

  if (body.action === "emit") {
    if (!enabled || provider === "manual") {
      await admin.from("nfse_events").insert({
        tenant_id: doc.tenant_id, nfse_id: doc.id,
        event_type: "configuration_error",
        message: "Emissão bloqueada: provedor fiscal real não configurado",
        payload: { provider }, created_by: userId,
      });
      return json({
        error: "Provedor fiscal real não configurado. Use uma credencial Hub Fiscal habilitada.",
        code: "NFSE_PROVIDER_NOT_CONFIGURED",
      }, 409);
    }

    await admin.from("nfse_events").insert({
      tenant_id: doc.tenant_id, nfse_id: doc.id,
      event_type: "configuration_error",
      message: `Emissão bloqueada: integração ${provider} não implementada`,
      created_by: userId,
    });
    return json({
      error: `Integração ${provider} não implementada. Use o Hub Fiscal.`,
      code: "NFSE_PROVIDER_NOT_IMPLEMENTED",
    }, 501);
  }

  if (body.action === "cancel") {
    return json({
      error: "Cancelamento legado bloqueado. Cancele a NFS-e pelo Hub Fiscal.",
      code: "NFSE_LEGACY_CANCEL_DISABLED",
    }, 409);
  }

  return json({ error: "ação desconhecida" }, 400);
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
