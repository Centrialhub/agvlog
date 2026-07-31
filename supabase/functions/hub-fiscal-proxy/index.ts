import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HUB_BASE = (Deno.env.get('HUB_FISCAL_BASE_URL') ||
  'https://rvgcsmuyvesusbxsqevr.supabase.co/functions/v1').replace(/\/$/, '');
const DEFAULT_HUB_KEY = Deno.env.get('HUB_FISCAL_API_KEY') || '';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ENC_KEY = Deno.env.get('AGVLOG_ENCRYPTION_KEY') || '';

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
  const iv = hexToBytes(parts[2]);
  const ct = hexToBytes(parts[3]);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

type Action =
  | 'emit' | 'get' | 'sync' | 'cancel' | 'cce'
  | 'email' | 'file' | 'query' | 'preview' | 'ping'
  | 'desacordo' | 'cent' | 'discard' | 'import';

interface ProxyRequest {
  action: Action;
  type?: 'nfe' | 'nfce' | 'nfse' | 'cte' | 'mdfe';
  id?: string;          // hub document id
  emissionId?: string;  // local hub_fiscal_emissions.id
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  format?: 'pdf' | 'xml' | 'cancel_xml';
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
    interface ResolvedToken {
      token: string;
      source: 'ciphertext' | 'secret_name' | 'default';
      emitter_id: string | null;
      scope_matched: string | null;
    }
    async function resolveToken(scope: string, emitterHint?: string | null): Promise<ResolvedToken> {
      let emId = emitterHint || null;
      if (!emId && payload.emissionId) {
        const { data: em } = await admin.from('hub_fiscal_emissions')
          .select('emitter_id').eq('id', payload.emissionId).maybeSingle();
        emId = em?.emitter_id || null;
      }
      if (!emId) {
        return { token: DEFAULT_HUB_KEY, source: 'default', emitter_id: null, scope_matched: null };
      }
      // Ambiente-alvo: usa o do payload.body.environment quando presente (emit) ou payload.environment.
      const wantedEnv: string | null =
        ((payload as any)?.body?.environment as string | undefined) ||
        ((payload as any)?.environment as string | undefined) ||
        null;
      const { data: creds } = await admin.from('hub_fiscal_credentials')
        .select('doc_scope, environment, secret_name, secret_ciphertext, enabled')
        .eq('emitter_id', emId).eq('enabled', true);
      const list = (creds || []) as any[];
      // Prioriza: (scope exato + env exato) > (scope exato) > (all + env exato) > (all).
      const pick = (fn: (c: any) => boolean) => list.find(fn);
      const match =
        (wantedEnv && pick(c => c.doc_scope === scope && c.environment === wantedEnv)) ||
        pick(c => c.doc_scope === scope) ||
        (wantedEnv && pick(c => c.doc_scope === 'all' && c.environment === wantedEnv)) ||
        pick(c => c.doc_scope === 'all');
      if (!match) {
        console.log('[hub-fiscal-proxy] no credential for emitter', { emitter_id: emId, scope, wantedEnv });
        return { token: DEFAULT_HUB_KEY, source: 'default', emitter_id: emId, scope_matched: null };
      }
      if (match.secret_ciphertext) {
        if (!ENC_KEY) {
          const err: any = new Error('AGVLOG_ENCRYPTION_KEY não configurada — não é possível decriptar o token do emitente.');
          err.code = 'HUB_CREDENTIAL_ENC_KEY_MISSING';
          throw err;
        }
        try {
          const token = await decryptAesGcm(match.secret_ciphertext, ENC_KEY);
          if (!token) {
            const err: any = new Error('Token decriptado vazio.');
            err.code = 'HUB_CREDENTIAL_DECRYPT_FAILED';
            throw err;
          }
          console.log('[hub-fiscal-proxy] token resolved', { emitter_id: emId, scope: match.doc_scope, env: match.environment, wantedEnv, source: 'ciphertext' });
          return { token, source: 'ciphertext', emitter_id: emId, scope_matched: match.doc_scope };
        } catch (e: any) {
          if (e?.code === 'HUB_CREDENTIAL_DECRYPT_FAILED' || e?.code === 'HUB_CREDENTIAL_ENC_KEY_MISSING') throw e;
          const err: any = new Error('Falha ao decriptar credencial do emitente.');
          err.code = 'HUB_CREDENTIAL_DECRYPT_FAILED';
          throw err;
        }
      }
      if (match.secret_name) {
        const token = Deno.env.get(match.secret_name) || '';
        if (!token) {
          const err: any = new Error(`Segredo "${match.secret_name}" não está configurado no ambiente.`);
          err.code = 'HUB_CREDENTIAL_SECRET_MISSING';
          throw err;
        }
        console.log('[hub-fiscal-proxy] token resolved', { emitter_id: emId, scope: match.doc_scope, env: match.environment, wantedEnv, source: 'secret_name' });
        return { token, source: 'secret_name', emitter_id: emId, scope_matched: match.doc_scope };
      }
      return { token: DEFAULT_HUB_KEY, source: 'default', emitter_id: emId, scope_matched: null };
    }

    switch (action) {
      case 'emit': {
        const type = payload.type;
        if (!type) return json(400, { success: false, error: { code: 'MISSING_TYPE' } });
        const body = payload.body || {};
        const resolved = await resolveToken(type, payload.emitterId);
        console.log('[hub-fiscal-proxy] emit', { type, emitter_id: resolved.emitter_id, source: resolved.source });
        const { status, data } = await callHub('POST', '/hub_documents_emit', { type }, body, resolved.token);

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
          access_key: doc.accessKey || null,
          authorization_protocol: doc.authorizationProtocol || doc.plugnotasProtocol || null,
          number: doc.number || null,
          series: doc.series || null,
          c_stat: doc.cStat ?? null,
          message: doc.message || null,
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
        const resolved = await resolveToken(payload.type || 'all', payload.emitterId);
        const { status, data } = await callHub('GET', '/hub_documents_get', { id: payload.id }, undefined, resolved.token);
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
        const resolved = await resolveToken(payload.type || 'all', payload.emitterId);
        const { status, data } = await callHub('POST', '/hub_documents_sync', { id: payload.id }, undefined, resolved.token);
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
        const resolved = await resolveToken(payload.type || 'all', payload.emitterId);
        const { status, data } = await callHub('POST', '/hub_documents_cancel', { id: payload.id }, { justificativa }, resolved.token);
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
        const resolved = await resolveToken(payload.type || 'all', payload.emitterId);
        const { status, data } = await callHub('POST', '/hub_documents_cce', { id: payload.id }, payload.body || {}, resolved.token);
        return json(status, { success: status < 400, hub: data });
      }

      case 'email': {
        if (!payload.id) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const resolved = await resolveToken(payload.type || 'all', payload.emitterId);
        // Hub API espera { destinatarios: string[] }.
        const src = (payload.body || {}) as Record<string, unknown>;
        const destinatarios = (src.destinatarios || src.emails || []) as string[];
        const { status, data } = await callHub('POST', '/hub_documents_email', { id: payload.id }, { destinatarios }, resolved.token);
        return json(status, { success: status < 400, hub: data });
      }

      case 'file': {
        if (!payload.id) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const format = payload.format || 'pdf';
        const resolved = await resolveToken(payload.type || 'all', payload.emitterId);
        const token = resolved.token || DEFAULT_HUB_KEY;
        if (!token) {
          return json(400, {
            success: false,
            error: { code: 'NO_HUB_TOKEN', message: 'Nenhum token do Hub Fiscal configurado para este emitente.' },
          });
        }
        console.log('[hub-fiscal-proxy] file', {
          id: payload.id, format, emitter_id: resolved.emitter_id, source: resolved.source,
        });
        const url = buildUrl('/hub_documents_file', { id: payload.id, format });
        const upstream = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const ct = upstream.headers.get('Content-Type') || '';
        const buf = await upstream.arrayBuffer();

        // O Hub pode responder com JSON: erro, { url } assinada, ou { base64 }.
        if (ct.includes('application/json')) {
          let parsed: any = {};
          try { parsed = JSON.parse(new TextDecoder().decode(buf)); } catch { /* ignore */ }
          const b64 = parsed?.base64 || parsed?.content || parsed?.document?.base64;
          const fileUrl = parsed?.url || parsed?.fileUrl || parsed?.document?.url;
          if (upstream.ok && typeof b64 === 'string' && b64.length > 0) {
            const bytes = Uint8Array.from(atob(b64.replace(/^data:[^,]+,/, '')), (c) => c.charCodeAt(0));
            return new Response(bytes, {
              status: 200,
              headers: {
                ...corsHeaders,
                'Content-Type': format === 'pdf' ? 'application/pdf' : 'application/xml',
                'Content-Disposition': `attachment; filename="hub-${payload.id}.${format}"`,
              },
            });
          }
          if (upstream.ok && typeof fileUrl === 'string' && fileUrl.length > 0) {
            const follow = await fetch(fileUrl);
            if (follow.ok) {
              return new Response(await follow.arrayBuffer(), {
                status: 200,
                headers: {
                  ...corsHeaders,
                  'Content-Type': follow.headers.get('Content-Type') ||
                    (format === 'pdf' ? 'application/pdf' : 'application/xml'),
                  'Content-Disposition': `attachment; filename="hub-${payload.id}.${format}"`,
                },
              });
            }
          }
          const message =
            parsed?.error?.message || parsed?.message || parsed?.error ||
            `Hub Fiscal retornou ${upstream.status} sem conteúdo de arquivo.`;
          return json(upstream.ok ? 502 : upstream.status, {
            success: false,
            error: { code: 'HUB_FILE_ERROR', message: String(message), hub: parsed },
          });
        }

        if (!upstream.ok || buf.byteLength === 0) {
          const text = new TextDecoder().decode(buf).slice(0, 500);
          return json(upstream.ok ? 502 : upstream.status, {
            success: false,
            error: {
              code: 'HUB_FILE_ERROR',
              message: text || `Hub Fiscal retornou ${upstream.status} ao baixar o ${format.toUpperCase()}.`,
            },
          });
        }

        return new Response(buf, {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': ct || (format === 'pdf' ? 'application/pdf' : 'application/xml'),
            'Content-Disposition': `attachment; filename="hub-${payload.id}.${format}"`,
          },
        });
      }

      case 'preview': {
        if (!payload.id) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const resolved = await resolveToken(payload.type || 'all', payload.emitterId);
        const { status, data } = await callHub('GET', '/hub_documents_preview', { id: payload.id }, undefined, resolved.token);
        return json(status, { success: status < 400, hub: data });
      }

      case 'query': {
        const resolved = await resolveToken(payload.type || 'all', payload.emitterId);
        const { status, data } = await callHub('GET', '/hub_documents_query', payload.query || {}, undefined, resolved.token);
        return json(status, { success: status < 400, hub: data });
      }

      case 'desacordo': {
        if (!payload.id) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const justificativa = (payload.body as any)?.justificativa as string | undefined;
        if (!justificativa || justificativa.trim().length < 15) {
          return json(400, { success: false, error: { code: 'INVALID_JUSTIFICATION', message: 'Mínimo 15 caracteres.' } });
        }
        const resolved = await resolveToken(payload.type || 'cte', payload.emitterId);
        const { status, data } = await callHub('POST', '/hub_documents_desacordo', { id: payload.id }, { justificativa }, resolved.token);
        return json(status, { success: status < 400, hub: data });
      }

      case 'cent': {
        if (!payload.id) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const resolved = await resolveToken(payload.type || 'cte', payload.emitterId);
        const { status, data } = await callHub('POST', '/hub_documents_cent', { id: payload.id }, payload.body || {}, resolved.token);
        return json(status, { success: status < 400, hub: data });
      }

      case 'discard': {
        if (!payload.id) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const resolved = await resolveToken(payload.type || 'cte', payload.emitterId);
        const { status, data } = await callHub('POST', '/hub_documents_discard', { id: payload.id }, undefined, resolved.token);
        if (status < 400 && payload.emissionId) {
          await admin.from('hub_fiscal_emissions').update({
            status: 'discarded',
            last_response: data as any,
          }).eq('id', payload.emissionId).eq('tenant_id', tenantId);
        }
        return json(status, { success: status < 400, hub: data });
      }

      case 'import': {
        const body = payload.body || {};
        const resolved = await resolveToken(payload.type || 'cte', payload.emitterId);
        const { status, data } = await callHub('POST', '/hub_documents_import', undefined, body, resolved.token);
        return json(status, { success: status < 400, hub: data });
      }

      case 'ping': {
        // Diagnóstico: resolve o token para (emitterId, type) e devolve a origem — nunca o token.
        const scope = payload.type || 'all';
        try {
          const resolved = await resolveToken(scope, payload.emitterId);
          return json(200, {
            success: true,
            source: resolved.source,
            emitter_id: resolved.emitter_id,
            scope_requested: scope,
            scope_matched: resolved.scope_matched,
            has_token: !!resolved.token,
            default_key_configured: !!DEFAULT_HUB_KEY,
          });
        } catch (e: any) {
          return json(400, {
            success: false,
            error: { code: e?.code || 'HUB_CREDENTIAL_ERROR', message: e?.message || 'Falha ao resolver credencial.' },
            emitter_id: payload.emitterId || null,
            scope_requested: scope,
          });
        }
      }

      default:
        return json(400, { success: false, error: { code: 'UNKNOWN_ACTION' } });
    }
  } catch (e: any) {
    console.error('[hub-fiscal-proxy] fatal', e);
    const code = e?.code || 'INTERNAL_ERROR';
    const status = code.startsWith('HUB_CREDENTIAL_') ? 400 : 500;
    return json(status, { success: false, error: { code, message: e?.message } });
  }
});