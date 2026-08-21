import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const HUB_BASE = (Deno.env.get('HUB_FISCAL_BASE_URL') ||
  'https://rvgcsmuyvesusbxsqevr.supabase.co/functions/v1').replace(/\/$/, '');
const DEFAULT_HUB_KEY = Deno.env.get('HUB_FISCAL_API_KEY') || '';
const MANAGERSAAS_BASE = (Deno.env.get('MANAGERSAAS_BASE_URL') ||
  'https://managersaas.tecnospeed.com.br:8081/ManagerAPIWeb').replace(/\/$/, '');
const MANAGERSAAS_GROUP = Deno.env.get('MANAGERSAAS_GROUP') || '';
const MANAGERSAAS_AUTH = Deno.env.get('MANAGERSAAS_AUTH') || '';

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
  | 'desacordo' | 'cent' | 'discard' | 'import'
  | 'deliver' | 'links' | 'cancel-nfse';

interface ProxyRequest {
  action: Action;
  type?: 'nfe' | 'nfce' | 'nfse' | 'cte' | 'mdfe';
  id?: string;          // hub document id
  emissionId?: string;  // local hub_fiscal_emissions.id
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  format?: 'pdf' | 'xml' | 'cancel_xml';
  /** CT-e: variante do XML/PDF no ManagerSaaS (EP-010/EP-012). */
  documento?: 'Cancelamento' | 'CCe';
  /** deliver/links — arquivos pedidos sob demanda. */
  kinds?: ('pdf' | 'xml')[];
  mode?: 'url' | 'inline' | 'email' | 'callback';
  expiresIn?: number;
  forceRefresh?: boolean;
  idIntegracao?: string;
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
  const requestBody = body ? JSON.stringify(body) : undefined;
  const maxAttempts = method === 'POST' && path === '/hub_documents_emit' ? 3 : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await fetch(buildUrl(path, qs), {
      method,
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: requestBody,
    });
    const text = await res.text();
    let data: any;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

    const upstreamCode = String(data?.code || data?.error?.code || '');
    const retryableBootFailure =
      (res.status === 502 || res.status === 503) && upstreamCode === 'BOOT_ERROR';
    if (!retryableBootFailure || attempt === maxAttempts) {
      return { status: res.status, data };
    }

    console.warn('[hub-fiscal-proxy] Hub indisponível durante inicialização; repetindo emissão', {
      path,
      attempt,
      maxAttempts,
      upstreamCode,
    });
    await new Promise((resolve) => setTimeout(resolve, attempt * 750));
  }

  return { status: 503, data: { code: 'BOOT_ERROR', message: 'Hub Fiscal indisponível' } };
}

function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D+/g, '');
}

/**
 * Última barreira de congruência para CT-e.
 *
 * Há clientes com bundles antigos em cache que ainda enviam `inicio` a partir
 * do remetente e CFOP de venda (ex.: 5253). O Hub transforma esses campos em
 * UFIni/UFfim antes de transmitir à SEFAZ; por isso a correção precisa ocorrer
 * também no proxy, imediatamente antes do POST upstream.
 */
function normalizeCteEmissionBody(source: Record<string, unknown>): Record<string, unknown> {
  const body = structuredClone(source) as Record<string, any>;
  const inner = (body.payload && typeof body.payload === 'object'
    ? body.payload
    : body) as Record<string, any>;

  const emitterAddress = inner.emitente?.endereco;
  const destinationAddress = inner.recebedor?.endereco || inner.destinatario?.endereco;

  const location = (address: Record<string, unknown> | undefined) => {
    if (!address) return undefined;
    const city = address.municipio || address.cidade;
    const state = String(address.uf || address.estado || '').toUpperCase() || undefined;
    const cityCode = onlyDigits(address.codigoMunicipio || address.codigoCidade || address.cMun) || undefined;
    if (!city && !state && !cityCode) return undefined;
    return {
      codigoCidade: cityCode,
      cMun: cityCode,
      municipio: city,
      cidade: city,
      uf: state,
      estado: state,
    };
  };

  const inicio = location(emitterAddress);
  const fim = location(destinationAddress);
  if (inicio) inner.inicio = inicio;
  if (fim) inner.fim = fim;

  const ufIni = String(inner.inicio?.uf || '').toUpperCase();
  const ufFim = String(inner.fim?.uf || '').toUpperCase();
  const prefix = ufIni && ufFim && ufIni !== ufFim ? '6' : '5';
  const rawCfop = onlyDigits(inner.CFOP || inner.cfop || inner.ide?.CFOP);
  const validTransportCfop = /^[56](3(5[1-9]|60)|932)$/.test(rawCfop);
  const normalizedCfop = validTransportCfop
    ? `${prefix}${rawCfop.slice(1)}`
    : `${prefix}353`;

  inner.CFOP = normalizedCfop;
  inner.cfop = normalizedCfop;
  inner.ide = { ...(inner.ide || {}), CFOP: normalizedCfop };

  console.log('[hub-fiscal-proxy] CT-e normalized before upstream emission', {
    ufIni,
    ufFim,
    receivedCfop: rawCfop || null,
    sentCfop: normalizedCfop,
  });
  return body;
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
      // Nunca cruza ambientes: uma emissão de produção não pode usar credencial sandbox e vice-versa.
      const pick = (fn: (c: any) => boolean) => list.find(fn);
      const match = wantedEnv
        ? pick(c => c.doc_scope === scope && c.environment === wantedEnv)
          || pick(c => c.doc_scope === 'all' && c.environment === wantedEnv)
        : pick(c => c.doc_scope === scope) || pick(c => c.doc_scope === 'all');
      if (!match) {
        console.log('[hub-fiscal-proxy] no credential for emitter', { emitter_id: emId, scope, wantedEnv });
        const err: any = new Error(
          wantedEnv
            ? `Nenhuma credencial habilitada para ${scope} no ambiente ${wantedEnv}.`
            : `Nenhuma credencial habilitada para ${scope}.`,
        );
        err.code = 'HUB_CREDENTIAL_ENVIRONMENT_MISMATCH';
        throw err;
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
        const body = type === 'cte'
          ? normalizeCteEmissionBody(payload.body || {})
          : (payload.body || {});
        const resolved = await resolveToken(type, payload.emitterId);
        console.log('[hub-fiscal-proxy] emit', { type, emitter_id: resolved.emitter_id, source: resolved.source });
        const { status, data } = await callHub('POST', '/hub_documents_emit', { type }, body, resolved.token);

        const doc = (data as any)?.document || {};
        const documentAccessKey = doc.accessKey || doc.access_key || null;
        const upstreamCode = String((data as any)?.code || (data as any)?.error?.code || '');
        const upstreamBootFailure = status === 503 && upstreamCode === 'BOOT_ERROR';
        const responseData = upstreamBootFailure
          ? {
              error: {
                code: 'HUB_TEMPORARILY_UNAVAILABLE',
                message: 'O serviço de emissão do Fiscal Hub não iniciou. A tentativa foi registrada e pode ser reenviada.',
                retryable: true,
                upstreamCode,
              },
            }
          : data;
        // Snapshot do bloco de seguro (seguradora/apólice/averbação) para auditoria
        const inner = ((body as any).payload || {}) as Record<string, any>;
        const seg = (inner.seguro || inner.seguradora || inner.seguros?.[0] || {}) as Record<string, any>;
        const segNum = (v: unknown) => (v == null || v === '' ? null : Number(v));
        const { data: row, error } = await admin.from('hub_fiscal_emissions').insert({
          tenant_id: tenantId,
          emitter_id: payload.emitterId || null,
          doc_type: type,
          environment: (body as any).environment || 'sandbox',
          emitter_cnpj: (body as any).emitterCnpj || payload.emitterCnpj || null,
          external_id: (body as any).externalId || null,
          id_integracao: doc.idIntegracao || (body as any)?.payload?.idIntegracao || (body as any).externalId || null,
          hub_document_id: doc.id || null,
          plugnotas_id: doc.plugnotasId || null,
          status: doc.status || (status >= 400 ? 'error' : 'processing'),
          access_key: documentAccessKey,
          authorization_protocol: doc.authorizationProtocol || doc.plugnotasProtocol || null,
          number: doc.number || null,
          series: doc.series || null,
          c_stat: doc.cStat ?? null,
          message: doc.message || (upstreamBootFailure ? (responseData as any).error.message : null),
          fiscal_document_id: payload.fiscalDocumentId || null,
          cte_document_id: payload.cteDocumentId || null,
          nfse_document_id: payload.nfseDocumentId || null,
          request_payload: body as any,
           insurer_name: seg.seguradora || seg.nome || seg.xSeg || null,
           insurer_cnpj: seg.cnpjSeguradora || seg.cnpj || null,
          insurer_policy: seg.apolice || seg.nApol || null,
          insurer_endorsement:
            seg.averbacao || (Array.isArray(seg.nAver) ? seg.nAver[0] : seg.nAver) || null,
          insured_amount: segNum(seg.valorSegurado),
          insurance_premium: segNum(seg.valorSeguro),
          last_response: responseData as any,
          created_by: userId,
        }).select().single();
        if (error) console.warn('[hub-fiscal-proxy] insert emission failed', error);

        if (status < 400 && payload.fiscalDocumentId && documentAccessKey) {
          await admin.from('fiscal_documents').update({
            access_key: documentAccessKey,
            hub_document_id: doc.id || undefined,
          }).eq('id', payload.fiscalDocumentId).eq('tenant_id', tenantId);
        }

        // BOOT_ERROR pertence à função upstream do Fiscal Hub, não ao runtime do
        // AGVLog. HTTP 200 evita que o SDK gere FunctionsHttpError/tela de erro;
        // `success: false` mantém a operação como falha recuperável na aplicação.
        return json(upstreamBootFailure ? 200 : status, {
          success: status < 400 && !upstreamBootFailure,
          hub: responseData,
          emission: row,
          retryable: upstreamBootFailure,
        });
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
        
        // Se a ação for sync e o documento estiver no Hub, o proxy atualiza fiscal_documents
        // para garantir que o polling reflita o estado real da SEFAZ.
        const d = (data as any)?.document || {};
        const success = status < 400 && !((data as any)?.error);

        if (success && payload.fiscalDocumentId) {
          const update: any = {
            sefaz_status: d.status || undefined,
            sefaz_status_code: d.cStat != null ? String(d.cStat) : undefined,
            sefaz_message: d.message || undefined,
            access_key: d.accessKey || undefined,
            sefaz_protocol: d.authorizationProtocol || d.plugnotasProtocol || undefined,
          };
          
          if (d.status === 'authorized') update.status = 'authorized';
          if (d.status === 'cancelled') update.status = 'cancelled';
          if (d.status === 'rejected') update.status = 'rejected';
          
          for (const k of Object.keys(update)) if (update[k] === undefined) delete update[k];

          await admin.from('fiscal_documents')
            .update(update)
            .eq('id', payload.fiscalDocumentId)
            .eq('tenant_id', tenantId);
        }

        if (payload.emissionId) {
          await admin.rpc('increment_hfe_sync', { p_id: payload.emissionId }).catch(() => {});
          const dSync = (data as any)?.document || {};
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
        const body = (payload.body || {}) as Record<string, unknown>;
        const justificativa = (body.justificativa || body.reason || body.motivo) as string | undefined;
        if (!justificativa || justificativa.trim().length < 15) {
          return json(400, { success: false, error: { code: 'INVALID_JUSTIFICATION', message: 'Mínimo 15 caracteres.' } });
        }
        const resolved = await resolveToken(payload.type || 'all', payload.emitterId);
        // A API v1 do Hub valida o campo `reason`; mantemos `justificativa` por compatibilidade.
        const reason = justificativa.trim();
        const { status, data } = await callHub(
          'POST',
          '/hub_documents_cancel',
          { id: payload.id, type: payload.type || 'cte' },
          { reason, justificativa: reason },
          resolved.token,
        );
        const hubError = (data as any)?.error;
        const cancelRejected = status === 409 && (
          hubError?.code === 'NOT_CANCELABLE' ||
          /cancel_rejected|cannot be cancelled/i.test(String(hubError?.message || ''))
        );
        const cancelFailed = status >= 400;
        const hubDocumentStatus = String((data as any)?.document?.status || '').toLowerCase();
        const cancellationConfirmed = status < 400 && hubDocumentStatus === 'cancelled';
        const rejectionMessage =
          hubError?.technicalMessage ||
          hubError?.message ||
          (data as any)?.document?.message ||
          'Cancelamento rejeitado pela SEFAZ';
        if (cancelFailed && payload.fiscalDocumentId) {
          const { data: currentDocument } = await admin.from('fiscal_documents')
            .select('sefaz_status, sefaz_message')
            .eq('id', payload.fiscalDocumentId)
            .eq('tenant_id', tenantId)
            .maybeSingle();
          const previousMessage = currentDocument?.sefaz_message || '';
          const shouldPreserveOriginal = cancelRejected &&
            currentDocument?.sefaz_status === 'cancel_rejected' &&
            previousMessage &&
            !/cannot be cancelled|não pode ser cancelado/i.test(previousMessage);
          await admin.from('fiscal_documents').update({
            sefaz_status: 'cancel_rejected',
            sefaz_message: shouldPreserveOriginal ? previousMessage : rejectionMessage,
          }).eq('id', payload.fiscalDocumentId).eq('tenant_id', tenantId);
        } else if (payload.fiscalDocumentId) {
          await admin.from('fiscal_documents').update({
            status: cancellationConfirmed ? 'cancelled' : 'transmitting',
            sefaz_status: cancellationConfirmed ? 'cancelled' : 'cancelling',
            sefaz_message: cancellationConfirmed
              ? String((data as any)?.document?.message || 'CT-e cancelado')
              : `Cancelamento solicitado: ${reason}`,
          }).eq('id', payload.fiscalDocumentId).eq('tenant_id', tenantId);
        }
        if (payload.emissionId) {
          await admin.from('hub_fiscal_emissions').update({
            status: cancellationConfirmed ? 'cancelled' : status < 400 ? 'cancelling' : 'cancel_rejected',
            message: cancellationConfirmed ? 'CT-e cancelado' : status < 400 ? 'Cancelamento solicitado' : rejectionMessage,
            cancel_reason: reason,
            cancelled_at: cancellationConfirmed ? new Date().toISOString() : null,
            last_response: data as any,
          }).eq('id', payload.emissionId).eq('tenant_id', tenantId);
        }
        // NOT_CANCELABLE é uma recusa fiscal esperada. HTTP 200 evita que o SDK
        // transforme o resultado em FunctionsHttpError/tela de erro; a UI trata
        // `success: false` e mostra a orientação operacional ao usuário.
        return json(cancelRejected ? 200 : status, { success: status < 400, hub: data });
      }
      
      case 'cancel-nfse': {
        if (!payload.id) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const body = (payload.body || {}) as Record<string, unknown>;
        const justificativa = (body.justificativa || body.reason || body.motivo) as string | undefined;
        
        if (!justificativa || justificativa.trim().length < 15) {
          return json(400, { success: false, error: { code: 'INVALID_JUSTIFICATION', message: 'Mínimo 15 caracteres.' } });
        }

        const resolved = await resolveToken(payload.type || 'nfse', payload.emitterId);
        const reason = justificativa.trim();
        const { status, data } = await callHub(
          'POST',
          '/hub_documents_cancel',
          { id: payload.id, type: 'nfse' },
          { reason, justificativa: reason },
          resolved.token,
        );

        const hubError = (data as any)?.error;
        const cancelRejected = status === 409 && (
          hubError?.code === 'NOT_CANCELABLE' ||
          /cancel_rejected|cannot be cancelled/i.test(String(hubError?.message || ''))
        );

        const rejectionMessage =
          hubError?.technicalMessage ||
          hubError?.message ||
          (data as any)?.document?.message ||
          'Cancelamento de NFS-e rejeitado';

        if (payload.emissionId) {
          await admin.from('hub_fiscal_emissions').update({
            status: status < 400 ? 'cancelled' : 'cancel_rejected',
            message: status < 400 ? 'NFS-e cancelada' : rejectionMessage,
            cancel_reason: reason,
            cancelled_at: status < 400 ? new Date().toISOString() : null,
            last_response: data as any,
          }).eq('id', payload.emissionId).eq('tenant_id', tenantId);
        }

        return json(cancelRejected ? 200 : status, { success: status < 400, hub: data });
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
        const fileResponse = (body: BodyInit, contentType?: string | null) =>
          new Response(body, {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': contentType || (format === 'pdf' ? 'application/pdf' : 'application/xml'),
              'Content-Disposition': `attachment; filename="hub-${payload.id}.${format}"`,
            },
          });
        const b64ToBytes = (b64: string) =>
          Uint8Array.from(atob(b64.replace(/^data:[^,]+,/, '').replace(/\s/g, '')), (c) => c.charCodeAt(0));

        let hubMessage = '';
        const attemptLog: string[] = [];

        // 0) Download SOB DEMANDA (API v1 atualizada): o Hub gera/baixa o arquivo do
        //    provedor no momento do pedido, sem depender de cache.
        //    POST /hub_documents_deliver (mode=url, forceRefresh) e, se pendente,
        //    GET /hub_documents_links?base64=1.
        const fetchSigned = async (url: string, withToken: boolean) => {
          const res = await fetch(url, withToken ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
          if (!res.ok) return null;
          const buf = await res.arrayBuffer();
          if (buf.byteLength === 0) return null;
          return fileResponse(buf, res.headers.get('Content-Type'));
        };
        const tryOnDemand = async (): Promise<Response | null> => {
          // cancel_xml = XML do evento de cancelamento (kind=xml + documento=Cancelamento).
          const kindOnDemand = format === 'cancel_xml' ? 'xml' : format;
          const documento = payload.documento || (format === 'cancel_xml' ? 'Cancelamento' : undefined);
          const readFiles = (data: any) => (data?.files || data?.hub?.files || {}) as Record<string, any>;
          const consume = async (data: any): Promise<Response | null> => {
            const entry = readFiles(data)[kindOnDemand];
            if (!entry) return null;
            if (entry.pending) return null;
            const inlineB64 = entry.base64 || entry.content;
            if (typeof inlineB64 === 'string' && inlineB64.length > 0) {
              if (kindOnDemand === 'xml' && inlineB64.trimStart().startsWith('<')) return fileResponse(inlineB64, 'application/xml');
              try { return fileResponse(b64ToBytes(inlineB64), entry.contentType); } catch { /* segue */ }
            }
            if (typeof entry.signedUrl === 'string' && entry.signedUrl) {
              const r = await fetchSigned(entry.signedUrl, false);
              if (r) return r;
            }
            if (typeof entry.downloadUrl === 'string' && entry.downloadUrl) {
              const r = await fetchSigned(entry.downloadUrl, true);
              if (r) return r;
            }
            return null;
          };
          try {
            const { status, data } = await callHub('POST', '/hub_documents_deliver', undefined, {
              id: payload.id,
              idIntegracao: payload.idIntegracao,
              kinds: [kindOnDemand],
              ...(documento ? { documento } : {}),
              mode: 'url',
              forceRefresh: true,
              expiresIn: 604800,
            }, token);
            const got = await consume(data);
            if (got) {
              console.log('[hub-fiscal-proxy] file via deliver', { id: payload.id, format });
              return got;
            }
            const msg = String((data as any)?.error?.message || (data as any)?.error?.code || '');
            attemptLog.push(`/hub_documents_deliver: ${status} ${msg}`.trim());
            if (msg) hubMessage = msg;
          } catch (e) {
            attemptLog.push(`/hub_documents_deliver: ${String((e as Error)?.message || e).slice(0, 160)}`);
          }
          try {
            const { status, data } = await callHub('GET', '/hub_documents_links', {
              id: payload.id, base64: '1', expiresIn: '604800',
              ...(documento ? { documento } : {}),
            }, undefined, token);
            const got = await consume(data);
            if (got) {
              console.log('[hub-fiscal-proxy] file via links', { id: payload.id, format });
              return got;
            }
            const msg = String((data as any)?.error?.message || (data as any)?.error?.code || '');
            attemptLog.push(`/hub_documents_links: ${status} ${msg}`.trim());
            if (msg) hubMessage = msg;
          } catch (e) {
            attemptLog.push(`/hub_documents_links: ${String((e as Error)?.message || e).slice(0, 160)}`);
          }
          return null;
        };
        const onDemand = await tryOnDemand();
        if (onDemand) return onDemand;

        // Contingência direta TecnoSpeed/ManagerSaaS. Tentada ANTES do Hub quando já
        // conhecemos chave + CNPJ localmente: a rota de arquivos do Hub está
        // indisponível nesta instância e as 5 tentativas gastam segundos por arquivo
        // (inviável em download em lote). Credenciais ficam só nos secrets.
        const managerTried = new Set<string>();
        const tryManagerSaas = async (rawKey: string, rawCnpj: string): Promise<Response | null> => {
          const key = String(rawKey || '').replace(/\D/g, '');
          const cnpj = String(rawCnpj || '').replace(/\D/g, '');
          if ((payload.type || 'cte') !== 'cte') return null;
          if (key.length !== 44 || cnpj.length !== 14) return null;
          if (!MANAGERSAAS_GROUP || !MANAGERSAAS_AUTH) return null;
          const sig = `${key}:${cnpj}:${format}`;
          if (managerTried.has(sig)) return null;
          managerTried.add(sig);
          const directPath = format === 'pdf' ? '/cte/imprime' : '/cte/xml';
          const directUrl = new URL(`${MANAGERSAAS_BASE}${directPath}`);
          directUrl.searchParams.set('Grupo', MANAGERSAAS_GROUP);
          directUrl.searchParams.set('CNPJ', cnpj);
          directUrl.searchParams.set('ChaveNota', key);
          if (format === 'pdf') directUrl.searchParams.set('Url', '0');
          if (format === 'cancel_xml') directUrl.searchParams.set('Documento', 'Cancelamento');
          const authorization = /^Basic\s/i.test(MANAGERSAAS_AUTH)
            ? MANAGERSAAS_AUTH
            : `Basic ${btoa(MANAGERSAAS_AUTH)}`;
          try {
            const direct = await fetch(directUrl, {
              method: 'GET',
              headers: { Authorization: authorization, Accept: format === 'pdf' ? 'application/pdf' : 'application/xml' },
            });
            const directContentType = direct.headers.get('Content-Type') || '';
            const directBuffer = await direct.arrayBuffer();
            const directText = new TextDecoder().decode(directBuffer).trim();
            const directFailed = !direct.ok || directBuffer.byteLength === 0 || /^(EXCEPTION|ERRO\b)/i.test(directText);
            if (!directFailed) {
              if (/^https?:\/\//i.test(directText)) {
                const follow = await fetch(directText);
                if (follow.ok) {
                  console.log('[hub-fiscal-proxy] file via ManagerSaaS URL', { id: payload.id, format });
                  return fileResponse(await follow.arrayBuffer(), follow.headers.get('Content-Type'));
                }
              } else {
                console.log('[hub-fiscal-proxy] file via ManagerSaaS', { id: payload.id, format });
                return fileResponse(directBuffer, directContentType);
              }
            }
            attemptLog.push(`ManagerSaaS${directPath}: ${direct.status} ${directText.slice(0, 160)}`.trim());
          } catch (e) {
            attemptLog.push(`ManagerSaaS${directPath}: ${String((e as Error)?.message || e).slice(0, 160)}`);
          }
          return null;
        };

        // Dados locais (emissão e documento fiscal) para o atalho ManagerSaaS.
        const { data: localEmission } = await admin.from('hub_fiscal_emissions')
          .select('access_key, emitter_cnpj, emitter_id, last_response')
          .eq('tenant_id', tenantId)
          .or(payload.emissionId
            ? `id.eq.${payload.emissionId},hub_document_id.eq.${payload.id}`
            : `hub_document_id.eq.${payload.id}`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const managerData = (localEmission as any)?.last_response?.document?.raw_response_json?.managersaas || {};
        const localKey =
          localEmission?.access_key ||
          (localEmission as any)?.last_response?.document?.access_key ||
          (localEmission as any)?.last_response?.document?.accessKey ||
          managerData?.parsed?.chave ||
          managerData?.data?.csv?.chave ||
          '';
        const localCnpj =
          localEmission?.emitter_cnpj ||
          (localEmission as any)?.last_response?.document?.emitter_cnpj ||
          '';
        const early = await tryManagerSaas(localKey, localCnpj);
        if (early) return early;

        // 1) Rota documentada de download direto: GET /hub_documents_file?id=...&kind=pdf|xml.
        //    Serve do Storage quando disponível; senão o Hub baixa do provedor.
        // EP-012: kind aceita pdf|xml; a variante do evento vai em documento=Cancelamento|CCe.
        const kind = format === 'cancel_xml' ? 'xml' : format;
        const fileDocumento = payload.documento || (format === 'cancel_xml' ? 'Cancelamento' : undefined);
        const attempts: { path: string; query: Record<string, string> }[] = [
          {
            path: '/hub_documents_file',
            query: { id: payload.id, kind, ...(fileDocumento ? { documento: fileDocumento } : {}) },
          },
        ];

        for (const attempt of attempts) {
          let upstream: Response;
          try {
            upstream = await fetch(buildUrl(attempt.path, attempt.query), {
              headers: { Authorization: `Bearer ${token}` },
            });
          } catch (e) {
            attemptLog.push(`${attempt.path}: ${String((e as Error)?.message || e).slice(0, 120)}`);
            continue;
          }
          const ct = upstream.headers.get('Content-Type') || '';
          const buf = await upstream.arrayBuffer();

          if (ct.includes('application/json')) {
            let parsed: any = {};
            try { parsed = JSON.parse(new TextDecoder().decode(buf)); } catch { /* ignore */ }
            const b64 = parsed?.base64 || parsed?.content || parsed?.document?.base64;
            const fileUrl = parsed?.url || parsed?.fileUrl || parsed?.document?.url;
            if (upstream.ok && typeof b64 === 'string' && b64.length > 0) return fileResponse(b64ToBytes(b64));
            if (upstream.ok && typeof fileUrl === 'string' && fileUrl.length > 0) {
              const follow = await fetch(fileUrl);
              if (follow.ok) return fileResponse(await follow.arrayBuffer(), follow.headers.get('Content-Type'));
            }
            const msg = String(parsed?.error?.message || parsed?.message || parsed?.error?.code || '');
            attemptLog.push(`${attempt.path}(${Object.keys(attempt.query).join(',')}): ${upstream.status} ${msg}`.trim());
            if (msg) hubMessage = msg;
          } else if (upstream.ok && buf.byteLength > 0) {
            return fileResponse(buf, ct);
          } else {
            const msg = new TextDecoder().decode(buf).slice(0, 200);
            attemptLog.push(`${attempt.path}: ${upstream.status} ${msg}`.trim());
            if (msg) hubMessage = msg;
          }
        }
        console.log('[hub-fiscal-proxy] file attempts exhausted', { id: payload.id, format, attemptLog });

        // 2) Fallback: o documento no Hub costuma carregar links/base64 do DACTE e XML.
        //    Necessário porque o ManagerSaaS pode não expor a rota de arquivo ("Rota
        //    solicitada não foi encontrada").
        const { status: docStatus, data: docData } = await callHub(
          'GET', '/hub_documents_get', { id: payload.id }, undefined, token,
        );
        const doc = (docData as any)?.document || (docData as any) || {};
        const accessKey = String(doc?.access_key || doc?.accessKey || '').replace(/\D/g, '');
        const emitterCnpj = String(doc?.emitter_cnpj || doc?.emitterCnpj || '').replace(/\D/g, '');
        const isAuthorized =
          String(doc?.status || '').toLowerCase() === 'authorized' ||
          Number(doc?.cstat ?? doc?.cStat) === 100;
        const pick = (...keys: string[]) => {
          for (const k of keys) {
            const v = doc?.[k];
            if (typeof v === 'string' && v.trim().length > 0) return v.trim();
          }
          return null;
        };
        const link = format === 'pdf'
          ? pick('pdfUrl', 'pdf_url', 'dacteUrl', 'urlPdf', 'linkPdf')
          : pick('xmlUrl', 'xml_url', 'urlXml', 'linkXml', 'cancelXmlUrl');
        if (link) {
          const follow = await fetch(link);
          if (follow.ok) return fileResponse(await follow.arrayBuffer(), follow.headers.get('Content-Type'));
        }
        const inline = format === 'pdf'
          ? pick('pdfBase64', 'pdf', 'dacteBase64')
          : pick('xmlBase64', 'xml', 'xmlContent');
        if (inline) {
          if (format === 'xml' && inline.trimStart().startsWith('<')) return fileResponse(inline, 'application/xml');
          try { return fileResponse(b64ToBytes(inline)); } catch { /* not base64 */ }
        }

        // 3) Último fallback: varredura profunda do JSON do documento em busca de
        //    qualquer link ou base64 do arquivo pedido (nomes de campo variam).
        const wanted = format === 'pdf' ? /(pdf|dacte|danfe|print)/i : /(xml)/i;
        const seen = new Set<unknown>();
        const found: { links: string[]; blobs: string[] } = { links: [], blobs: [] };
        const walk = (node: unknown, keyPath: string) => {
          if (!node || typeof node !== 'object' || seen.has(node)) return;
          seen.add(node);
          for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
            const path = `${keyPath}.${k}`;
            if (typeof v === 'string' && v.trim().length > 32 && wanted.test(path)) {
              const val = v.trim();
              if (/^https?:\/\//i.test(val)) found.links.push(val);
              else if (format === 'xml' && val.trimStart().startsWith('<')) found.blobs.push(val);
              else if (/^[A-Za-z0-9+/=\s]+$/.test(val)) found.blobs.push(val);
            } else if (typeof v === 'object') {
              walk(v, path);
            }
          }
        };
        walk(docData, 'doc');
        for (const candidate of found.links) {
          try {
            const follow = await fetch(candidate);
            if (follow.ok) return fileResponse(await follow.arrayBuffer(), follow.headers.get('Content-Type'));
          } catch { /* tenta o próximo */ }
        }
        for (const candidate of found.blobs) {
          if (format === 'xml' && candidate.trimStart().startsWith('<')) return fileResponse(candidate, 'application/xml');
          try {
            const bytes = b64ToBytes(candidate);
            if (bytes.byteLength > 0) return fileResponse(bytes);
          } catch { /* tenta o próximo */ }
        }

        // 4) Segunda tentativa direta na TecnoSpeed/ManagerSaaS, agora com chave e
        //    CNPJ vindos do próprio documento do Hub (caso os dados locais estivessem
        //    incompletos na primeira tentativa).
        const retry = await tryManagerSaas(accessKey || localKey, emitterCnpj || localCnpj);
        if (retry) return retry;
        if ((payload.type || 'cte') === 'cte' && managerTried.size === 0) {
          const missing = [
            String(accessKey || localKey).replace(/\D/g, '').length !== 44 && 'chave',
            String(emitterCnpj || localCnpj).replace(/\D/g, '').length !== 14 && 'CNPJ',
            !MANAGERSAAS_GROUP && 'MANAGERSAAS_GROUP',
            !MANAGERSAAS_AUTH && 'MANAGERSAAS_AUTH',
          ].filter(Boolean);
          attemptLog.push(`ManagerSaaS direto não configurado (${missing.join(', ')})`);
        }

        const upstreamContractIssue =
          docStatus < 400 &&
          isAuthorized &&
          accessKey.length === 44 &&
          attemptLog.some((entry) => /EspdAPIWebRouteNotFoundException|Requested function was not found/i.test(entry));

        return json(502, {
          success: false,
          error: {
            code: upstreamContractIssue ? 'HUB_FILE_ROUTE_MISCONFIGURED' : 'HUB_FILE_UNAVAILABLE',
            message: upstreamContractIssue
              ? `O CT-e está autorizado, mas a rota de arquivo do Hub Fiscal está configurada incorretamente e a contingência direta da TecnoSpeed não conseguiu recuperar o arquivo. ` +
                `Confira as credenciais ManagerSaaS do emitente e o acesso à rota ${format === 'pdf' ? 'GET /cte/imprime' : 'GET /cte/xml'}.`
              : `O Hub Fiscal não disponibilizou o ${format === 'pdf' ? 'DACTE (PDF)' : 'XML'} deste documento` +
                (hubMessage ? ` — ${hubMessage}` : '') +
                '. Verifique no Hub Fiscal se o documento está autorizado e se a rota de download está habilitada para o emitente.',
            attempts: attemptLog,
            document: {
              authorized: isAuthorized,
              hasAccessKey: accessKey.length === 44,
              hasEmitterCnpj: emitterCnpj.length === 14,
            },
          },
        });
      }

      case 'preview': {
        if (!payload.id) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const resolved = await resolveToken(payload.type || 'all', payload.emitterId);
        const { status, data } = await callHub('GET', '/hub_documents_preview', { id: payload.id }, undefined, resolved.token);
        return json(status, { success: status < 400, hub: data });
      }

      case 'deliver': {
        if (!payload.id && !payload.idIntegracao) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const resolved = await resolveToken(payload.type || 'all', payload.emitterId);
        const { status, data } = await callHub('POST', '/hub_documents_deliver', undefined, {
          id: payload.id,
          idIntegracao: payload.idIntegracao,
          kinds: payload.kinds && payload.kinds.length ? payload.kinds : ['pdf', 'xml'],
          ...(payload.documento ? { documento: payload.documento } : {}),
          mode: payload.mode || 'url',
          expiresIn: payload.expiresIn ?? 604800,
          forceRefresh: payload.forceRefresh ?? true,
          ...(payload.body || {}),
        }, resolved.token);
        return json(status, { success: status < 400, hub: data });
      }

      case 'links': {
        if (!payload.id && !payload.idIntegracao) return json(400, { success: false, error: { code: 'MISSING_ID' } });
        const resolved = await resolveToken(payload.type || 'all', payload.emitterId);
        const query: Record<string, string> = { expiresIn: String(payload.expiresIn ?? 604800) };
        if (payload.id) query.id = payload.id;
        if (payload.idIntegracao) query.idIntegracao = payload.idIntegracao;
        if (payload.documento) query.documento = payload.documento;
        const { status, data } = await callHub('GET', '/hub_documents_links', query, undefined, resolved.token);
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