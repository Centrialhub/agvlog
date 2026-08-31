import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from '@supabase/supabase-js';
import { requireIntegrationCapability } from '../_shared/capabilities.ts';
import {
  claimFiscalWebhook,
  completeFiscalWebhook,
  duplicateWebhookResponse,
} from '../_shared/fiscal-webhook-inbox.ts';

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

  // Fail closed: this function writes with service_role and must never be open.
  if (!SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'webhook_not_configured' }), { status: 503, headers: corsHeaders });
  }
  const provided =
    req.headers.get('x-webhook-secret') ||
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (provided !== SHARED_SECRET) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: corsHeaders });
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
  let claim;
  try {
    claim = await claimFiscalWebhook({
      request: req,
      admin,
      source: 'hub-fiscal',
      eventType: String(body?.eventType || body?.event || doc?.type || 'document.status'),
      payload: body,
      explicitDeliveryId: body?.deliveryId || body?.eventId || doc?.eventId,
      eventTimestamp: body?.eventTimestamp || body?.createdAt || doc?.updatedAt,
    });
  } catch (error) {
    console.error('[webhook-in] inbox claim error', error instanceof Error ? error.message : String(error));
    return new Response(JSON.stringify({ error: 'inbox_unavailable' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!claim.claimed) return duplicateWebhookResponse(claim, corsHeaders);

  // Locate the emission by any available identifier.
  let q = admin.from('hub_fiscal_emissions').select('*').limit(1);
  if (hubId) q = q.eq('hub_document_id', hubId);
  else if (plugnotasId) q = q.eq('plugnotas_id', plugnotasId);
  else if (idIntegracao) q = q.eq('id_integracao', idIntegracao);

  let { data: emissions, error: findErr } = await q;
  if(!findErr && !emissions?.length && idIntegracao) {
    const fallback = await admin.from('hub_fiscal_emissions').select('*').eq('id_integracao',idIntegracao).limit(2);
    emissions=fallback.data;findErr=fallback.error;
  }
  if(emissions && emissions.length>1) {await completeFiscalWebhook(admin,claim,{success:false,error:'ambiguous_identifier'});return new Response('ambiguous_identifier',{status:409,headers:corsHeaders});}
  if (findErr) {
    console.error('[webhook-in] find error', findErr);
    await completeFiscalWebhook(admin, claim, { success: false, error: `find_failed:${findErr.message}` });
    // Force PlugNotas/Hub to retry on persistence error.
    return new Response(JSON.stringify({ error: 'db_error' }), { status: 500, headers: corsHeaders });
  }

  const emission = emissions?.[0];
  if (!emission) {
    await completeFiscalWebhook(admin, claim, { success: false, error: 'document_not_found' });
    return new Response(JSON.stringify({ error: 'document_not_found', matched: false }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }

  const capabilityResponse = await requireIntegrationCapability(admin, emission.tenant_id, 'fiscal');
  if (capabilityResponse) {
    if (capabilityResponse.status === 403) {
      await completeFiscalWebhook(admin, claim, {
        success: true,
        tenantId: emission.tenant_id,
        emissionId: emission.id,
      });
      return new Response(JSON.stringify({
        success: true,
        matched: true,
        ignored: true,
        status: 'disabled',
      }), {
        status: 202,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    await completeFiscalWebhook(admin, claim, {
      success: false,
      tenantId: emission.tenant_id,
      emissionId: emission.id,
      error: 'capability_check_failed',
    });
    return capabilityResponse;
  }

  const normalized = normalizeStatus(doc.status || doc.plugnotasStatus);
  if(emission.dispatch_key) {
    const result=await admin.rpc('complete_hub_fiscal_emission',{
      _tenant:emission.tenant_id,_emission:emission.id,_http_status:200,
      _response:{document:{...doc,id:hubId||emission.hub_document_id,status:normalized,
        accessKey:doc.accessKey||doc.chave,authorizationProtocol:doc.authorizationProtocol||doc.plugnotasProtocol||doc.protocolo,
        number:doc.number||doc.numero,pdfUrl:doc.pdfUrl||doc.pdf,xmlUrl:doc.xmlUrl||doc.xml}},
    });
    const confirmed=!result.error && result.data?.confirmed===true;
    await completeFiscalWebhook(admin,claim,{success:confirmed,tenantId:emission.tenant_id,emissionId:emission.id,error:confirmed?undefined:'fiscal_confirmation_failed'});
    return new Response(JSON.stringify({success:confirmed,matched:true}),{status:confirmed?200:503,headers:{...corsHeaders,'Content-Type':'application/json'}});
  }


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
    last_callback: {
      event_type: body?.eventType || body?.event || doc?.type || null,
      status: doc.status || null,
      provider_document_id: hubId || plugnotasId || idIntegracao || null,
      received_at: new Date().toISOString(),
      delivery_id: claim.deliveryId,
    },
    last_synced_at: new Date().toISOString(),
  }).eq('id', emission.id);

  if (updErr) {
    console.error('[webhook-in] update error', updErr);
    await completeFiscalWebhook(admin, claim, {
      success: false,
      tenantId: emission.tenant_id,
      emissionId: emission.id,
      error: `emission_update_failed:${updErr.message}`,
    });
    return new Response(JSON.stringify({ error: 'db_error' }), { status: 500, headers: corsHeaders });
  }

  // Mirror status to local document tables when linked.
  const mirrorErrors: string[] = [];
  if (emission.fiscal_document_id) {
      const { error } = await admin.from('fiscal_documents').update({
        status: normalized === 'authorized' ? 'confirmed' : (normalized === 'cancelled' ? 'cancelled' : undefined),
        access_key: doc.accessKey || doc.chave || undefined,
        updated_at: new Date().toISOString(),
      }).eq('id', emission.fiscal_document_id);
      if (error) mirrorErrors.push(`fiscal_documents:${error.message}`);
  }
  if (emission.cte_document_id) {
      const { error } = await admin.from('cte_documents').update({
        status: normalized,
        updated_at: new Date().toISOString(),
      }).eq('id', emission.cte_document_id);
      if (error) mirrorErrors.push(`cte_documents:${error.message}`);
  }
  if (emission.nfse_document_id) {
      const { error } = await admin.from('nfse_documents').update({
        status: normalized === 'authorized' ? 'issued' : normalized,
        pdf_url: doc.pdfUrl || doc.pdf || undefined,
        xml_url: doc.xmlUrl || doc.xml || undefined,
        nfse_number: doc.number || doc.numero || undefined,
        protocol_number: doc.authorizationProtocol || doc.plugnotasProtocol || doc.protocolo || undefined,
        verification_code: doc.accessKey || doc.chave || undefined,
        authorization_date: normalized === 'authorized' ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      }).eq('id', emission.nfse_document_id);
      if (error) mirrorErrors.push(`nfse_documents:${error.message}`);
  }

  if (mirrorErrors.length > 0) {
    console.error('[webhook-in] mirror update failed', mirrorErrors);
    await completeFiscalWebhook(admin, claim, {
      success: false,
      tenantId: emission.tenant_id,
      emissionId: emission.id,
      error: mirrorErrors.join('; '),
    });
    return new Response(JSON.stringify({ error: 'mirror_update_failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  await completeFiscalWebhook(admin, claim, {
    success: true,
    tenantId: emission.tenant_id,
    emissionId: emission.id,
  });

  return new Response(JSON.stringify({ success: true, matched: true }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
