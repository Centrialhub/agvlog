import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HUB_BASE = (Deno.env.get('HUB_FISCAL_BASE_URL') ||
  'https://rvgcsmuyvesusbxsqevr.supabase.co/functions/v1').replace(/\/$/, '');
const DEFAULT_HUB_KEY = Deno.env.get('HUB_FISCAL_API_KEY') || '';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

type Action =
  | 'emit' | 'get' | 'sync' | 'cancel' | 'cce'
  | 'email' | 'file' | 'query' | 'preview';

interface ProxyRequest {
  action: Action;
  type?: 'nfe' | 'nfce' | 'nfse' | 'cte' | 'mdfe';
  id?: string;          // hub document id
  emissionId?: string;  // local hub_fiscal_emissions.id
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  format?: 'pdf' | 'xml';
  // emit-only
  fiscalDocumentId?: string;
  cteDocumentId?: string;
  nfseDocumentId?: string;
  emitterId?: string;   // routes to per-emitter Hub credential
}

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function buildUrl(path: string, qs?: Record<string, string>) {
  const u = new URL(`${HUB_BASE}${path}`);
  if (qs) for (const [k, v] of Object.entries(qs)) if (v != null) u.searchParams.set(k, String(v));
  return u.toString();
}

async function callHub(method: string, path: string, qs?: Record<string, string>, body?: unknown, token?: string) {
  const key = token || DEFAULT_HUB_KEY;
  if (!key) throw new Error('Nenhum token do Hub Fiscal configurado');
  const res = await fetch(buildUrl(path, qs), {
    method,
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  return { status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json(401, { success: false, error: { code: 'UNAUTHENTICATED' } });

    const anon = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await anon.auth.getUser();
    if (userErr || !userData?.user) return json(401, { success: false, error: { code: 'UNAUTHENTICATED' } });
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const payload = (await req.json().catch(() => ({}))) as ProxyRequest;
    const action = payload.action;
    if (!action) return json(400, { success: false, error: { code: 'MISSING_ACTION' } });

    // Resolve tenant via membership of the calling user.
    const { data: memberships } = await admin
      .from('tenant_memberships').select('tenant_id').eq('user_id', userId).limit(1);
    const tenantId = memberships?.[0]?.tenant_id as string | undefined;
    if (!tenantId) return json(403, { success: false, error: { code: 'NO_TENANT' } });

    // Resolve Hub token for this call — per-emitter credential if provided, else per-emission emitter, else default.
    async function resolveToken(scope: string, emitterHint?: string | null): Promise<string> {
      let emId = emitterHint || null;
      if (!emId && payload.emissionId) {
        const { data: em } = await admin.from('hub_fiscal_emissions')
          .select('emitter_id').eq('id', payload.emissionId).maybeSingle();
        emId = em?.emitter_id || null;
      }
      if (!emId) return DEFAULT_HUB_KEY;
      const { data: creds } = await admin.from('hub_fiscal_credentials')
        .select('doc_scope, secret_name, enabled')
        .eq('emitter_id', emId).eq('enabled', true);
      const list = (creds || []) as any[];
      const match = list.find(c => c.doc_scope === scope) || list.find(c => c.doc_scope === 'all');
      if (!match?.secret_name) return DEFAULT_HUB_KEY;
      return Deno.env.get(match.secret_name) || DEFAULT_HUB_KEY;
    }

    switch (action) {
      case 'emit': {
        const type = payload.type;
        if (!type) return json(400, { success: false, error: { code: 'MISSING_TYPE' } });
        const body = payload.body || {};
        const token = await resolveToken(type, payload.emitterId);

        const { status, data } = await callHub('POST', '/hub_documents_emit', { type }, body, token);

        const doc = (data as any)?.document || {};
        const { data: row, error } = await admin.from('hub_fiscal_emissions').insert({
          tenant_id: tenantId,
          emitter_id: payload.emitterId || null,
          doc_type: type,
          environment: (body as any).environment || 'sandbox',
          emitter_cnpj: (body as any).emitterCnpj || null,
          external_id: (body as any).externalId || null,
          id_integracao: doc.idIntegracao || null,
          hub_document_id: doc.id || null,
          plugnotas_id: doc.plugnotasId || null,
          status: doc.status || (status >= 400 ? 'error' : 'processing'),
          fiscal_document_id: payload.fiscalDocumentId || null,
          cte_document_id: payload.cteDocumentId || null,
          nfse_document_id: payload.nfseDocumentId || null,
          request_payload: body as any,
          last_response: data as any,
          created_by: userId,
        }).select().single();
        if (error) console.warn('[hub-fiscal-proxy] insert emission failed', error);

        return json(status, { success: status < 400, hub: data, emission: row });
      }

      case 'get': {
        if (!payload.id) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const token = await resolveToken(payload.type || 'all', payload.emitterId);
        const { status, data } = await callHub('GET', '/hub_documents_get', { id: payload.id }, undefined, token);
        if (status < 400 && payload.emissionId) {
          const d = (data as any)?.document || {};
          await admin.from('hub_fiscal_emissions').update({
            status: d.status || undefined,
            plugnotas_status: d.plugnotasStatus || undefined,
            access_key: d.accessKey || undefined,
            authorization_protocol: d.authorizationProtocol || d.plugnotasProtocol || undefined,
            number: d.number || undefined,
            series: d.series || undefined,
            c_stat: d.cStat ?? undefined,
            message: d.message || undefined,
            last_response: data as any,
            last_synced_at: new Date().toISOString(),
          }).eq('id', payload.emissionId).eq('tenant_id', tenantId);
        }
        return json(status, { success: status < 400, hub: data });
      }

      case 'sync': {
        if (!payload.id) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const token = await resolveToken(payload.type || 'all', payload.emitterId);
        const { status, data } = await callHub('POST', '/hub_documents_sync', { id: payload.id }, undefined, token);
        if (payload.emissionId) {
          await admin.rpc('increment_hfe_sync', { p_id: payload.emissionId }).catch(() => {});
          const d = (data as any)?.document || {};
          await admin.from('hub_fiscal_emissions').update({
            status: d.status || undefined,
            plugnotas_status: d.plugnotasStatus || undefined,
            access_key: d.accessKey || undefined,
            authorization_protocol: d.authorizationProtocol || d.plugnotasProtocol || undefined,
            number: d.number || undefined,
            series: d.series || undefined,
            c_stat: d.cStat ?? undefined,
            message: d.message || undefined,
            last_response: data as any,
            last_synced_at: new Date().toISOString(),
            sync_attempts: (data as any)?.sync_attempts ?? undefined,
          }).eq('id', payload.emissionId).eq('tenant_id', tenantId);
        }
        return json(status, { success: status < 400, hub: data });
      }

      case 'cancel': {
        if (!payload.id) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const justificativa = (payload.body as any)?.justificativa as string | undefined;
        if (!justificativa || justificativa.trim().length < 15) {
          return json(400, { success: false, error: { code: 'INVALID_JUSTIFICATION', message: 'Mínimo 15 caracteres.' } });
        }
        const token = await resolveToken(payload.type || 'all', payload.emitterId);
        const { status, data } = await callHub('POST', '/hub_documents_cancel', { id: payload.id }, { justificativa }, token);
        if (status < 400 && payload.emissionId) {
          await admin.from('hub_fiscal_emissions').update({
            status: 'cancelled',
            cancel_reason: justificativa,
            cancelled_at: new Date().toISOString(),
            last_response: data as any,
          }).eq('id', payload.emissionId).eq('tenant_id', tenantId);
        }
        return json(status, { success: status < 400, hub: data });
      }

      case 'cce': {
        if (!payload.id) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const token = await resolveToken(payload.type || 'all', payload.emitterId);
        const { status, data } = await callHub('POST', '/hub_documents_cce', { id: payload.id }, payload.body || {}, token);
        return json(status, { success: status < 400, hub: data });
      }

      case 'email': {
        if (!payload.id) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const token = await resolveToken(payload.type || 'all', payload.emitterId);
        const { status, data } = await callHub('POST', '/hub_documents_email', { id: payload.id }, payload.body || {}, token);
        return json(status, { success: status < 400, hub: data });
      }

      case 'file': {
        if (!payload.id) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const format = payload.format || 'pdf';
        const token = await resolveToken(payload.type || 'all', payload.emitterId);
        // Stream file content back to the caller.
        const url = buildUrl('/hub_documents_file', { id: payload.id, format });
        const upstream = await fetch(url, { headers: { Authorization: `Bearer ${token || DEFAULT_HUB_KEY}` } });
        const buf = await upstream.arrayBuffer();
        return new Response(buf, {
          status: upstream.status,
          headers: {
            ...corsHeaders,
            'Content-Type': upstream.headers.get('Content-Type') ||
              (format === 'pdf' ? 'application/pdf' : 'application/xml'),
            'Content-Disposition': `attachment; filename="hub-${payload.id}.${format}"`,
          },
        });
      }

      case 'preview': {
        if (!payload.id) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const token = await resolveToken(payload.type || 'all', payload.emitterId);
        const { status, data } = await callHub('GET', '/hub_documents_preview', { id: payload.id }, undefined, token);
        return json(status, { success: status < 400, hub: data });
      }

      case 'query': {
        const token = await resolveToken(payload.type || 'all', payload.emitterId);
        const { status, data } = await callHub('GET', '/hub_documents_query', payload.query || {}, undefined, token);
        return json(status, { success: status < 400, hub: data });
      }

      default:
        return json(400, { success: false, error: { code: 'UNKNOWN_ACTION' } });
    }
  } catch (e: any) {
    console.error('[hub-fiscal-proxy] fatal', e);
    return json(500, { success: false, error: { code: 'INTERNAL_ERROR', message: e?.message } });
  }
});