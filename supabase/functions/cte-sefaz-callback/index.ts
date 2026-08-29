// Webhook que a integração fiscal chama para atualizar status SEFAZ dos CT-e.
// Aceita identificação por id (uuid do cte_document) OU por access_key (chave de 44 dígitos).
// Mapeia o status reportado para o vocabulário interno (sefaz_status) e registra o evento bruto.
import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';
import { requireIntegrationCapability } from '../_shared/capabilities.ts';
import {
  claimFiscalWebhook,
  completeFiscalWebhook,
} from '../_shared/fiscal-webhook-inbox.ts';

const STATUS_MAP: Record<string, string> = {
  pending: 'pending',
  enviar: 'pending',
  sending: 'sending',
  enviando: 'sending',
  sent: 'sent',
  enviado: 'sent',
  sent_error: 'sent_error',
  'enviado_erro': 'sent_error',
  'enviado (erro)': 'sent_error',
  processing: 'processing',
  processando: 'processing',
  processed: 'processed',
  processado: 'processed',
  authorized: 'processed',
  autorizado: 'processed',
  processed_error: 'processed_error',
  'processado (erro)': 'processed_error',
  rejected: 'processed_error',
  rejeitado: 'processed_error',
  cancel_pending: 'cancel_pending',
  'a_cancelar': 'cancel_pending',
  'à cancelar': 'cancel_pending',
  cancelling: 'cancelling',
  cancelando: 'cancelling',
  cancelled: 'cancelled',
  cancelado: 'cancelled',
  cancel_error: 'cancel_error',
  'cancelado (erro)': 'cancel_error',
  closed: 'closed',
  encerrado: 'closed',
  invalidated: 'invalidated',
  inutilizado: 'invalidated',
};

function normalizeStatus(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const k = raw.trim().toLowerCase();
  return STATUS_MAP[k] ?? null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Fail closed: this function writes with service_role and must never be open.
  const expectedToken = Deno.env.get('FISCAL_WEBHOOK_TOKEN');
  if (!expectedToken) {
    return new Response(JSON.stringify({ error: 'webhook_not_configured' }), {
      status: 503,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const provided = req.headers.get('x-fiscal-token');
  if (provided !== expectedToken) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_json' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const items: any[] = Array.isArray(body) ? body : [body];
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const results: any[] = [];
  const requestDeliveryId =
    req.headers.get('x-webhook-id') ||
    req.headers.get('x-delivery-id') ||
    req.headers.get('idempotency-key');

  for (const [itemIndex, item] of items.entries()) {
    const id: string | undefined = item?.id || item?.cte_document_id;
    const accessKey: string | undefined = item?.access_key || item?.chave;
    const status = normalizeStatus(item?.status);
    if (!status || (!id && !accessKey)) {
      results.push({ ok: false, retryable: false, error: 'missing_identifier_or_status' });
      continue;
    }

    let claim;
    try {
      const itemDeliveryId = item?.delivery_id || item?.event_id || item?.eventId;
      claim = await claimFiscalWebhook({
        request: req,
        admin: supabase,
        source: 'cte-sefaz',
        eventType: String(item?.event_type || status),
        payload: item,
        explicitDeliveryId: itemDeliveryId || (requestDeliveryId
          ? `${requestDeliveryId}:${itemIndex}`
          : undefined),
        eventTimestamp: item?.event_timestamp || item?.occurred_at || item?.updated_at,
      });
    } catch (error) {
      console.error('[cte-sefaz-callback] inbox claim error', error instanceof Error ? error.message : String(error));
      results.push({ ok: false, retryable: true, error: 'inbox_unavailable', id, accessKey });
      continue;
    }

    if (!claim.claimed) {
      results.push({
        ok: claim.status === 'processed',
        retryable: claim.status !== 'processed',
        duplicate: true,
        status: claim.status,
        retry_after_seconds: claim.retryAfterSeconds,
        id,
        accessKey,
      });
      continue;
    }

    // Resolve o doc.
    let doc: any = null;
    if (id) {
      const { data, error } = await supabase.from('cte_documents').select('id, tenant_id').eq('id', id).maybeSingle();
      if (error) {
        await completeFiscalWebhook(supabase, claim, { success: false, error: `cte_lookup_failed:${error.message}` });
        results.push({ ok: false, retryable: true, error: 'db_error', id });
        continue;
      }
      doc = data;
    } else if (accessKey) {
      const { data, error } = await supabase
        .from('cte_documents')
        .select('id, tenant_id')
        .eq('access_key', accessKey)
        .maybeSingle();
      if (error) {
        await completeFiscalWebhook(supabase, claim, { success: false, error: `cte_lookup_failed:${error.message}` });
        results.push({ ok: false, retryable: true, error: 'db_error', accessKey });
        continue;
      }
      doc = data;
    }
    if (!doc) {
      // Fallback: novo fluxo de emissão grava em fiscal_documents (via useIssueCTe).
      const fdUpdate: Record<string, any> = {
        sefaz_status: status,
        sefaz_message: item?.reason ?? item?.motivo ?? null,
        sefaz_status_code: item?.status_code ?? item?.codigo ?? null,
        sefaz_protocol: item?.protocol_number ?? item?.protocolo ?? null,
        cte_payload: item,
      };
      if (accessKey) fdUpdate.access_key = accessKey;
      if (status === 'processed') fdUpdate.status = 'issued';
      if (status === 'cancelled') fdUpdate.status = 'cancelled';

      let fdLookup = supabase.from('fiscal_documents').select('id, tenant_id');
      if (id) fdLookup = fdLookup.eq('hub_document_id', id);
      else if (accessKey) fdLookup = fdLookup.eq('access_key', accessKey);
      else {
        await completeFiscalWebhook(supabase, claim, { success: false, error: 'missing_identifier' });
        results.push({ ok: false, retryable: false, error: 'missing_identifier' });
        continue;
      }

      const { data: fiscalTargets, error: lookupError } = await fdLookup;
      if (lookupError) {
        await completeFiscalWebhook(supabase, claim, { success: false, error: `fiscal_document_lookup_failed:${lookupError.message}` });
        results.push({ ok: false, retryable: true, error: 'db_error', id, accessKey });
        continue;
      }
      if (!fiscalTargets?.length) {
        await completeFiscalWebhook(supabase, claim, { success: false, error: 'document_not_found' });
        results.push({ ok: false, retryable: true, error: 'document_not_found', id, accessKey });
        continue;
      }

      const targetTenantIds = [...new Set(fiscalTargets.map((target) => target.tenant_id))];
      if (targetTenantIds.length !== 1) {
        await completeFiscalWebhook(supabase, claim, { success: false, error: 'ambiguous_tenant' });
        results.push({ ok: false, retryable: false, error: 'ambiguous_tenant', id, accessKey });
        continue;
      }
      const targetTenantId = targetTenantIds[0];
      const capabilityResponse = await requireIntegrationCapability(supabase, targetTenantId, 'fiscal');
      if (capabilityResponse) {
        const disabled = capabilityResponse.status === 403;
        await completeFiscalWebhook(supabase, claim, {
          success: disabled,
          tenantId: targetTenantId,
          error: disabled ? undefined : 'capability_check_failed',
        });
        results.push({ ok: disabled, retryable: !disabled, ignored: disabled, status: disabled ? 'disabled' : 'degraded' });
        continue;
      }

      const fiscalTargetIds = fiscalTargets.map((target) => target.id);
      const { data: fiscalDocuments, error: fdErr, count } = await supabase
        .from('fiscal_documents')
        .update(fdUpdate)
        .in('id', fiscalTargetIds)
        .select('id, tenant_id', { count: 'exact' });
      if (fdErr) {
        await completeFiscalWebhook(supabase, claim, { success: false, error: `fiscal_document_update_failed:${fdErr.message}` });
        results.push({ ok: false, retryable: true, error: 'db_error', id, accessKey });
        continue;
      }

      await completeFiscalWebhook(supabase, claim, {
        success: true,
        tenantId: fiscalDocuments?.[0]?.tenant_id,
      });
      results.push({ ok: true, target: 'fiscal_documents', matched: count, status });
      continue;
    }

    const capabilityResponse = await requireIntegrationCapability(supabase, doc.tenant_id, 'fiscal');
    if (capabilityResponse) {
      const disabled = capabilityResponse.status === 403;
      await completeFiscalWebhook(supabase, claim, {
        success: disabled,
        tenantId: doc.tenant_id,
        error: disabled ? undefined : 'capability_check_failed',
      });
      results.push({ ok: disabled, retryable: !disabled, ignored: disabled, status: disabled ? 'disabled' : 'degraded' });
      continue;
    }

    const now = new Date().toISOString();
    const update: Record<string, any> = {
      sefaz_status: status,
      sefaz_status_reason: item?.reason ?? item?.motivo ?? null,
      sefaz_status_code: item?.status_code ?? item?.codigo ?? null,
      sefaz_status_at: now,
      sefaz_environment: item?.environment ?? item?.ambiente ?? null,
      protocol_number: item?.protocol_number ?? item?.protocolo ?? undefined,
      access_key: accessKey ?? item?.access_key ?? undefined,
      pdf_url: item?.pdf_url ?? undefined,
      xml_url: item?.xml_url ?? undefined,
      xml_content: item?.xml ?? undefined,
      last_sefaz_event: item,
    };
    if (status === 'sent') update.sent_at = now;
    if (status === 'processed') {
      update.processed_at = now;
      update.issued_at = item?.issued_at ?? now;
      update.status = 'issued';
    }
    if (status === 'cancelled') {
      update.cancelled_at = now;
      update.cancellation_reason = item?.reason ?? item?.motivo ?? null;
      update.status = 'cancelled';
    }
    // Remove undefined keys
    for (const k of Object.keys(update)) if (update[k] === undefined) delete update[k];

    const { error: upErr } = await supabase.from('cte_documents').update(update).eq('id', doc.id);
    if (upErr) {
      await completeFiscalWebhook(supabase, claim, {
        success: false,
        tenantId: doc.tenant_id,
        error: `cte_update_failed:${upErr.message}`,
      });
      results.push({ ok: false, retryable: true, error: 'db_error', id: doc.id });
      continue;
    }

    const { error: eventError } = await supabase.from('cte_sefaz_events').insert({
      tenant_id: doc.tenant_id,
      cte_document_id: doc.id,
      event_type: item?.event_type || status,
      status,
      status_code: update.sefaz_status_code,
      reason: update.sefaz_status_reason,
      protocol_number: update.protocol_number ?? null,
      payload: {
        delivery_id: claim.deliveryId,
        event_type: item?.event_type || status,
        status,
        status_code: update.sefaz_status_code,
        protocol_number: update.protocol_number ?? null,
        received_at: now,
      },
      source: req.headers.get('user-agent') || 'fiscal-webhook',
      occurred_at: now,
    } as any);

    if (eventError && eventError.code !== '23505') {
      await completeFiscalWebhook(supabase, claim, {
        success: false,
        tenantId: doc.tenant_id,
        error: `event_insert_failed:${eventError.message}`,
      });
      results.push({ ok: false, retryable: true, error: 'event_insert_failed', id: doc.id });
      continue;
    }

    await completeFiscalWebhook(supabase, claim, { success: true, tenantId: doc.tenant_id });

    results.push({ ok: true, id: doc.id, status });
  }

  const hasRetryableFailure = results.some((result) => result.ok === false && result.retryable !== false);
  const hasInvalidInput = results.some((result) => result.ok === false && result.retryable === false);
  return new Response(JSON.stringify({ results }), {
    status: hasRetryableFailure ? 500 : (hasInvalidInput ? 400 : 200),
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
