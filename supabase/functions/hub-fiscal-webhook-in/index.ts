import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SHARED_SECRET = Deno.env.get('HUB_FISCAL_WEBHOOK_SECRET') || '';

// Map Hub status (or PlugNotas status) -> normalized local status.
function normalizeStatus(s: string | undefined): string {
  if (!s) return 'unknown';
  const v = String(s).toLowerCase();
  if (['authorized', 'concluido', 'autorizado'].includes(v)) return 'authorized';
  if (['cancelled', 'canceled', 'cancelado'].includes(v)) return 'cancelled';
  if (['rejected', 'rejeitado', 'erro', 'error'].includes(v)) return 'rejected';
  if (['processing', 'pending', 'processando'].includes(v)) return 'processing';
  return v;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers: corsHeaders });
  }

  // Verify shared secret (Hub sets either X-Webhook-Secret or Authorization).
  if (SHARED_SECRET) {
    const provided =
      req.headers.get('x-webhook-secret') ||
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
    if (provided !== SHARED_SECRET) {
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: corsHeaders });
    }
  }

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: corsHeaders });
  }

  const doc = body?.document || body || {};
  const hubId: string | undefined = doc.id || doc.hubDocumentId;
  const idIntegracao: string | undefined = doc.idIntegracao;
  const plugnotasId: string | undefined = doc.plugnotasId;

  if (!hubId && !idIntegracao && !plugnotasId) {
    return new Response(JSON.stringify({ error: 'missing_identifier' }), { status: 400, headers: corsHeaders });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Locate the emission by any available identifier.
  let q = admin.from('hub_fiscal_emissions').select('*').limit(1);
  if (hubId) q = q.eq('hub_document_id', hubId);
  else if (plugnotasId) q = q.eq('plugnotas_id', plugnotasId);
  else if (idIntegracao) q = q.eq('id_integracao', idIntegracao);

  const { data: emissions, error: findErr } = await q;
  if (findErr) {
    console.error('[webhook-in] find error', findErr);
    // Force PlugNotas/Hub to retry on persistence error.
    return new Response(JSON.stringify({ error: 'db_error' }), { status: 500, headers: corsHeaders });
  }

  const emission = emissions?.[0];
  if (!emission) {
    // Acknowledge to prevent retries on truly unknown documents.
    return new Response(JSON.stringify({ success: true, matched: false }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const normalized = normalizeStatus(doc.status || doc.plugnotasStatus);

  const { error: updErr } = await admin.from('hub_fiscal_emissions').update({
    status: normalized,
    plugnotas_status: doc.plugnotasStatus || doc.status || undefined,
    access_key: doc.accessKey || doc.chave || undefined,
    authorization_protocol: doc.authorizationProtocol || doc.plugnotasProtocol || doc.protocolo || undefined,
    number: doc.number || doc.numero || undefined,
    series: doc.series || doc.serie || undefined,
    c_stat: doc.cStat ?? undefined,
    message: doc.message || doc.mensagem || undefined,
    pdf_url: doc.pdfUrl || doc.pdf || undefined,
    xml_url: doc.xmlUrl || doc.xml || undefined,
    hub_document_id: emission.hub_document_id || hubId || undefined,
    plugnotas_id: emission.plugnotas_id || plugnotasId || undefined,
    last_callback: body as any,
    last_synced_at: new Date().toISOString(),
  }).eq('id', emission.id);

  if (updErr) {
    console.error('[webhook-in] update error', updErr);
    return new Response(JSON.stringify({ error: 'db_error' }), { status: 500, headers: corsHeaders });
  }

  // Mirror status to local document tables when linked.
  try {
    if (emission.fiscal_document_id) {
      await admin.from('fiscal_documents').update({
        status: normalized === 'authorized' ? 'confirmed' : (normalized === 'cancelled' ? 'cancelled' : undefined),
        access_key: doc.accessKey || doc.chave || undefined,
        updated_at: new Date().toISOString(),
      }).eq('id', emission.fiscal_document_id);
    }
    if (emission.cte_document_id) {
      await admin.from('cte_documents').update({
        status: normalized,
        updated_at: new Date().toISOString(),
      }).eq('id', emission.cte_document_id);
    }
    if (emission.nfse_document_id) {
      await admin.from('nfse_documents').update({
        status: normalized === 'authorized' ? 'issued' : normalized,
        pdf_url: doc.pdfUrl || doc.pdf || undefined,
        xml_url: doc.xmlUrl || doc.xml || undefined,
        nfse_number: doc.number || doc.numero || undefined,
        protocol_number: doc.authorizationProtocol || doc.plugnotasProtocol || doc.protocolo || undefined,
        verification_code: doc.accessKey || doc.chave || undefined,
        authorization_date: normalized === 'authorized' ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      }).eq('id', emission.nfse_document_id);
    }
  } catch (e) {
    console.warn('[webhook-in] mirror update warning', e);
  }

  return new Response(JSON.stringify({ success: true, matched: true }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});