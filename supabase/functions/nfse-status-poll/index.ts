// Consulta periódica de status das NFS-e que ficaram "processando" no provedor.
// Invocada pelo pg_cron (a cada 5 min) e também sob demanda pela UI.
// Para cada NFS-e pendente: consulta o Hub Fiscal (GET /hub_documents_get),
// grava a resposta completa (para conferência posterior) e atualiza o status
// local quando o provedor sai de "processando".

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HUB_BASE = (Deno.env.get('HUB_FISCAL_BASE_URL') ||
  'https://rvgcsmuyvesusbxsqevr.supabase.co/functions/v1').replace(/\/$/, '');
const DEFAULT_HUB_KEY = Deno.env.get('HUB_FISCAL_API_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ENC_KEY = Deno.env.get('AGVLOG_ENCRYPTION_KEY') || '';

const PENDING = ['processing', 'queued', 'submitted', 'pending', 'transmitting'];
const MAX_DOCS = 40;

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function hexToBytes(hex: string): Uint8Array {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return b;
}

async function decryptAesGcm(encrypted: string, keyHex: string): Promise<string> {
  const parts = encrypted.split(':');
  if (parts.length !== 4) throw new Error('Invalid encrypted format');
  const keyBytes = hexToBytes(keyHex.padEnd(64, '0').slice(0, 64));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: hexToBytes(parts[2]) },
    key,
    hexToBytes(parts[3]),
  );
  return new TextDecoder().decode(pt);
}

// deno-lint-ignore no-explicit-any
async function resolveToken(admin: any, emitterId: string | null, environment?: string | null) {
  if (!emitterId) return DEFAULT_HUB_KEY;
  const { data: creds } = await admin.from('hub_fiscal_credentials')
    .select('doc_scope, environment, secret_name, secret_ciphertext')
    .eq('emitter_id', emitterId).eq('enabled', true);
  const list = (creds || []) as Array<Record<string, string>>;
  const pick = (fn: (c: Record<string, string>) => boolean) => list.find(fn);
  const match =
    (environment && pick(c => c.doc_scope === 'nfse' && c.environment === environment)) ||
    pick(c => c.doc_scope === 'nfse') ||
    (environment && pick(c => c.doc_scope === 'all' && c.environment === environment)) ||
    pick(c => c.doc_scope === 'all');
  if (!match) return DEFAULT_HUB_KEY;
  if (match.secret_ciphertext && ENC_KEY) {
    try { return await decryptAesGcm(match.secret_ciphertext, ENC_KEY); } catch { /* cai no fallback */ }
  }
  if (match.secret_name) return Deno.env.get(match.secret_name) || DEFAULT_HUB_KEY;
  return DEFAULT_HUB_KEY;
}

async function hubGet(hubDocumentId: string, token: string) {
  const url = new URL(`${HUB_BASE}/hub_documents_get`);
  url.searchParams.set('id', hubDocumentId);
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const text = await res.text();
  // deno-lint-ignore no-explicit-any
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: res.status, data };
}

function classify(raw: string): 'issued' | 'rejected' | 'cancelled' | null {
  const s = raw.toLowerCase();
  if (['authorized', 'autorizado', 'concluido', 'concluído', 'issued', 'emitida'].includes(s)) return 'issued';
  if (['rejected', 'rejeitado', 'rejeitada', 'erro', 'error', 'denied', 'denegado'].includes(s)) return 'rejected';
  if (['cancelled', 'canceled', 'cancelado', 'cancelada'].includes(s)) return 'cancelled';
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({})) as { nfse_id?: string; tenant_id?: string };

  try {
    let q = admin.from('nfse_documents')
      .select('id, tenant_id, emitter_id, status, rps_number, status_check_attempts')
      .in('status', PENDING)
      .order('last_status_check_at', { ascending: true, nullsFirst: true })
      .limit(MAX_DOCS);
    if (body.nfse_id) q = admin.from('nfse_documents')
      .select('id, tenant_id, emitter_id, status, rps_number, status_check_attempts')
      .eq('id', body.nfse_id);
    else if (body.tenant_id) q = q.eq('tenant_id', body.tenant_id);

    const { data: docs, error } = await q;
    if (error) return json(400, { success: false, error: { code: 'QUERY_FAILED', message: error.message } });

    const results: Array<Record<string, unknown>> = [];

    for (const doc of (docs || [])) {
      const { data: emission } = await admin.from('hub_fiscal_emissions')
        .select('id, hub_document_id, environment, emitter_id')
        .eq('nfse_document_id', doc.id)
        .order('created_at', { ascending: false })
        .limit(1).maybeSingle();

      if (!emission?.hub_document_id) {
        await admin.from('nfse_documents').update({
          last_status_check_at: new Date().toISOString(),
          status_check_attempts: (doc.status_check_attempts || 0) + 1,
          last_status_response: { skipped: 'sem emissão no Hub Fiscal' },
        }).eq('id', doc.id);
        results.push({ id: doc.id, skipped: 'no_hub_document' });
        continue;
      }

      const token = await resolveToken(admin, emission.emitter_id || doc.emitter_id || null, emission.environment);
      const { status, data } = await hubGet(emission.hub_document_id, token);
      // deno-lint-ignore no-explicit-any
      const d = ((data as any)?.document || {}) as Record<string, any>;
      const rawStatus = String(d.status || d.plugnotasStatus || '');
      const outcome = status < 400 ? classify(rawStatus) : null;
      const message =
        d?.raw_response_json?.error?.message || d?.raw_response_json?.message ||
        d.message || (data as Record<string, any>)?.error?.message || null;

      // Histórico: guarda a resposta bruta para conferência posterior.
      await admin.from('hub_fiscal_emissions').update({
        status: rawStatus || undefined,
        plugnotas_status: d.plugnotasStatus || undefined,
        access_key: d.accessKey || undefined,
        authorization_protocol: d.authorizationProtocol || d.plugnotasProtocol || undefined,
        number: d.number || undefined,
        series: d.series || undefined,
        c_stat: d.cStat ?? undefined,
        message: message || undefined,
        last_response: data,
        last_synced_at: new Date().toISOString(),
      }).eq('id', emission.id);

      const patch: Record<string, unknown> = {
        last_status_check_at: new Date().toISOString(),
        status_check_attempts: (doc.status_check_attempts || 0) + 1,
        last_status_response: data,
      };
      if (outcome === 'issued') {
        patch.status = 'issued';
        patch.nfse_number = d.number || null;
        patch.protocol_number = d.authorizationProtocol || d.plugnotasProtocol || null;
        patch.verification_code = d.accessKey || null;
        patch.pdf_url = d.pdfUrl || null;
        patch.xml_url = d.xmlUrl || null;
        patch.authorization_date = new Date().toISOString();
        patch.rejection_messages = null;
      } else if (outcome === 'rejected') {
        patch.status = 'rejected';
        patch.rejection_messages = { message: message || rawStatus || 'Rejeitada pelo provedor' };
      } else if (outcome === 'cancelled') {
        patch.status = 'cancelled';
        patch.cancelled = true;
        patch.cancellation_date = new Date().toISOString();
        // Libera as NFs vinculadas — voltam a aparecer para novo faturamento
        await admin
          .from('fiscal_documents')
          .update({ nfse_emitted_at: null, nfse_emitted_document_id: null })
          .eq('nfse_emitted_document_id', doc.id);
      }

      await admin.from('nfse_documents').update(patch).eq('id', doc.id);

      if (outcome) {
        await admin.from('nfse_events').insert({
          tenant_id: doc.tenant_id,
          nfse_id: doc.id,
          event_type: outcome === 'issued' ? 'issued' : outcome,
          message: outcome === 'issued'
            ? `Autorizada na consulta automática — nº ${d.number || '(sem número)'}`
            : `Consulta automática: ${rawStatus || outcome}${message ? ` — ${message}` : ''}`,
          payload: { source: 'nfse-status-poll', hub: data },
        });
      }

      results.push({ id: doc.id, rps: doc.rps_number, hub_status: rawStatus, outcome: outcome || 'pending' });
    }

    return json(200, { success: true, checked: results.length, results });
  } catch (e) {
    console.error('[nfse-status-poll] error', e);
    return json(500, { success: false, error: { code: 'POLL_FAILED', message: (e as Error).message } });
  }
});