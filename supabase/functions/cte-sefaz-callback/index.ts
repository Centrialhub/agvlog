// Webhook que a integração fiscal chama para atualizar status SEFAZ dos CT-e.
// Aceita identificação por id (uuid do cte_document) OU por access_key (chave de 44 dígitos).
// Mapeia o status reportado para o vocabulário interno (sefaz_status) e registra o evento bruto.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-fiscal-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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

  // Token compartilhado opcional para autenticar a integração fiscal.
  const expectedToken = Deno.env.get('FISCAL_WEBHOOK_TOKEN');
  if (expectedToken) {
    const provided = req.headers.get('x-fiscal-token');
    if (provided !== expectedToken) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
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
  for (const item of items) {
    const id: string | undefined = item?.id || item?.cte_document_id;
    const accessKey: string | undefined = item?.access_key || item?.chave;
    const status = normalizeStatus(item?.status);
    if (!status || (!id && !accessKey)) {
      results.push({ ok: false, error: 'missing_identifier_or_status', input: item });
      continue;
    }

    // Resolve o doc.
    let doc: any = null;
    if (id) {
      const { data } = await supabase.from('cte_documents').select('id, tenant_id').eq('id', id).maybeSingle();
      doc = data;
    } else if (accessKey) {
      const { data } = await supabase
        .from('cte_documents')
        .select('id, tenant_id')
        .eq('access_key', accessKey)
        .maybeSingle();
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

      let fdQuery = supabase.from('fiscal_documents').update(fdUpdate);
      if (id) fdQuery = fdQuery.eq('hub_document_id', id);
      else if (accessKey) fdQuery = fdQuery.eq('access_key', accessKey);
      else {
        results.push({ ok: false, error: 'missing_identifier', input: item });
        continue;
      }
      const { error: fdErr, count } = await fdQuery.select('id', { count: 'exact' });
      if (fdErr) {
        results.push({ ok: false, error: fdErr.message, id, accessKey });
      } else if (!count) {
        results.push({ ok: false, error: 'document_not_found', id, accessKey });
      } else {
        results.push({ ok: true, target: 'fiscal_documents', matched: count, status });
      }
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
      results.push({ ok: false, error: upErr.message, id: doc.id });
      continue;
    }

    await supabase.from('cte_sefaz_events').insert({
      tenant_id: doc.tenant_id,
      cte_document_id: doc.id,
      event_type: item?.event_type || status,
      status,
      status_code: update.sefaz_status_code,
      reason: update.sefaz_status_reason,
      protocol_number: update.protocol_number ?? null,
      payload: item,
      source: req.headers.get('user-agent') || 'fiscal-webhook',
      occurred_at: now,
    } as any);

    results.push({ ok: true, id: doc.id, status });
  }

  return new Response(JSON.stringify({ results }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});