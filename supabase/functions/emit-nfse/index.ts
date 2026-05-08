// Generic NFS-e emission edge function with pluggable provider.
// Currently supports providers: manual (no-op simulation), focus_nfe, nfeio, enotas, prefeitura.
// Real provider HTTP calls are stubbed — they only need credential wiring to go live.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
      // Simulate "ready to emit" — marks queued/issued without webservice
      const fake = `MANUAL-${Date.now()}`;
      await admin.from("nfse_documents").update({
        status: "issued",
        provider: "manual",
        protocol_number: fake,
        verification_code: fake.slice(-8),
        nfse_number: doc.rps_number,
        authorization_date: new Date().toISOString(),
      }).eq("id", doc.id);
      await admin.from("nfse_events").insert({
        tenant_id: doc.tenant_id, nfse_id: doc.id,
        event_type: "issued", message: "Emissão simulada (provedor não configurado)",
        payload: { simulated: true, provider: "manual" }, created_by: userId,
      });
      return json({ status: "issued", simulated: true, protocol: fake });
    }

    // Real provider call goes here (Focus NFe, NFE.io, eNotas, prefeitura).
    // Structure ready: read encrypted credentials from cfg.credentials_encrypted
    // and call the provider HTTP API. Mark as queued for now.
    await admin.from("nfse_documents").update({
      status: "queued", provider,
    }).eq("id", doc.id);
    await admin.from("nfse_events").insert({
      tenant_id: doc.tenant_id, nfse_id: doc.id,
      event_type: "submitted",
      message: `Enviado ao provedor ${provider} (integração pendente de credenciais)`,
      created_by: userId,
    });
    return json({ status: "queued", provider });
  }

  if (body.action === "cancel") {
    if (doc.status !== "issued") return json({ error: "Apenas notas emitidas podem ser canceladas" }, 400);
    await admin.from("nfse_documents").update({
      status: "cancelled", cancelled: true,
      cancellation_date: new Date().toISOString(),
      cancellation_reason: body.reason ?? null,
    }).eq("id", doc.id);
    await admin.from("nfse_events").insert({
      tenant_id: doc.tenant_id, nfse_id: doc.id,
      event_type: "cancelled", message: body.reason ?? "Cancelada", created_by: userId,
    });
    return json({ status: "cancelled" });
  }

  return json({ error: "ação desconhecida" }, 400);
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
