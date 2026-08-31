/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@supabase/supabase-js';
import { withFiscalCors } from '../_shared/fiscal-cors.ts';
import { corsHeaders } from '../_shared/cors.ts';
import {
  buildCadastroEnvelope, digits, parseCadastroResponse, readCertificateBundle,
  registryEndpoint, sha256Hex, type LookupType, type RegistryEnvironment,
} from '../_shared/tax-registry.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const CACHE_HOURS = 24;
const REQUEST_TIMEOUT_MS = 20_000;

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(withFiscalCors(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    const body = await req.json().catch(() => ({}));
    const emitterId = String(body.emitter_id || '');
    if (!emitterId) throw new HttpError(400, 'emitter_id obrigatório');
    const context = await authContext(req, emitterId);

    if (body.action === 'apply') {
      if (!context.isAdmin) throw new HttpError(403, 'Apenas administradores podem aplicar dados oficiais');
      const targetTable = String(body.target_table || '');
      const targetId = String(body.target_id || '');
      const registryId = String(body.registry_id || '');
      const queryId = String(body.query_id || '');
      if (!['clients', 'tenant_emitters'].includes(targetTable) || !targetId || !registryId || !queryId) {
        throw new HttpError(400, 'Dados para aplicação inválidos');
      }
      const { data, error } = await context.admin.rpc('apply_tax_registry_profile', {
        _tenant: context.emitter.tenant_id,
        _registry: registryId,
        _query: queryId,
        _target_table: targetTable,
        _target_id: targetId,
        _user: context.user.id,
      });
      if (error) throw new HttpError(400, translateDatabaseError(error.message));
      return json(200, { success: true, target: data });
    }

    const uf = String(body.uf || '').trim().toUpperCase();
    const lookupType = String(body.lookup_type || 'CNPJ').toUpperCase() as LookupType;
    const environment = String(body.environment || 'production') as RegistryEnvironment;
    const rawValue = String(body.lookup_value || '');
    const lookupValue = lookupType === 'IE' ? rawValue.replace(/[^A-Za-z0-9]/g, '') : digits(rawValue);
    validateLookup(uf, lookupType, lookupValue, environment);
    const endpoint = registryEndpoint(uf, environment);

    if (!body.force_refresh) {
      const cached = await readCache(context.admin, context.emitter.tenant_id, uf, lookupType, lookupValue);
      if (cached) return json(200, { ...cached, cached: true });
    }

    const { data: certificate, error: certificateError } = await context.admin.from('fiscal_certificates')
      .select('id,certificate_ciphertext,valid_from,valid_to,status')
      .eq('tenant_id', context.emitter.tenant_id).eq('emitter_id', emitterId)
      .eq('status', 'active').gt('valid_to', new Date().toISOString()).maybeSingle();
    if (certificateError || !certificate) throw new HttpError(409, 'CERTIFICADO_A1_ATIVO_NAO_ENCONTRADO');
    const bundle = await readCertificateBundle(certificate.certificate_ciphertext);
    const envelope = buildCadastroEnvelope(uf, lookupType, lookupValue);
    const started = Date.now();
    let responseText = '';
    let parsed: ReturnType<typeof parseCadastroResponse>;
    let resultStatus = 'error';
    let responseStatus = 0;
    try {
      const client = Deno.createHttpClient({
        cert: bundle.certificatePem,
        key: bundle.privateKeyPem,
      });
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/soap+xml; charset=utf-8; action="http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4/consultaCadastro"',
            'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/CadConsultaCadastro4/consultaCadastro',
          },
          body: envelope,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          client,
        } as RequestInit & { client: Deno.HttpClient });
        responseStatus = response.status;
        responseText = await response.text();
        if (!response.ok) throw new Error(`SEFAZ_HTTP_${response.status}`);
      } finally {
        client.close();
      }
      parsed = parseCadastroResponse(responseText);
      resultStatus = parsed.records.length > 0 ? 'success'
        : parsed.cStat && [111, 112].includes(parsed.cStat) ? 'invalid_response'
        : 'not_found';
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Falha ao consultar SEFAZ';
      const status = reason.includes('timeout') || reason.includes('SEFAZ_HTTP_5') ? 'unavailable' : 'error';
      await writeQuery(context, {
        certificateId: certificate.id, uf, lookupType, lookupValue, endpoint,
        resultStatus: status, cStat: null, reason, responseText, durationMs: Date.now() - started,
      });
      await context.admin.from('fiscal_certificates').update({
        last_tested_at: new Date().toISOString(), last_test_error: reason,
      }).eq('id', certificate.id).eq('tenant_id', context.emitter.tenant_id);
      throw new HttpError(status === 'unavailable' ? 503 : 502, reason);
    }

    const query = await writeQuery(context, {
      certificateId: certificate.id, uf, lookupType, lookupValue, endpoint,
      resultStatus, cStat: parsed.cStat, reason: parsed.reason, responseText,
      durationMs: Date.now() - started, normalized: parsed.records, responseStatus,
    });
    const profiles = [];
    for (const record of parsed.records) {
      const { data: profile, error } = await context.admin.from('fiscal_party_registry').upsert({
        tenant_id: context.emitter.tenant_id,
        cnpj: record.cnpj,
        uf: record.address.state || uf,
        state_registration: record.stateRegistration,
        legal_name: record.legalName,
        trade_name: record.tradeName,
        registry_status: record.registryStatus,
        status_code: record.statusCode,
        tax_regime: record.taxRegime,
        economic_activity_code: record.economicActivityCode,
        official_address: record.address,
        source: 'SEFAZ_CADCONSULTACADASTRO4',
        source_query_id: query.id,
        verified_at: new Date().toISOString(),
        raw_record: record.raw,
      }, { onConflict: 'tenant_id,cnpj,uf,state_registration' }).select('*').single();
      if (error) throw error;
      profiles.push(profile);
    }
    await context.admin.from('fiscal_certificates').update({
      last_tested_at: new Date().toISOString(), last_test_error: null,
    }).eq('id', certificate.id).eq('tenant_id', context.emitter.tenant_id);

    return json(200, {
      query_id: query.id,
      c_stat: parsed.cStat,
      reason: parsed.reason,
      status: resultStatus,
      cached: false,
      profiles: profiles.map(publicProfile),
    });
  } catch (error) {
    console.error('[tax-registry-consult]', safeError(error));
    return json(error instanceof HttpError ? error.status : 500, {
      error: error instanceof Error ? error.message : 'INTERNAL_ERROR',
    });
  }
}));

async function authContext(req: Request, emitterId: string) {
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'UNAUTHENTICATED');
  const anon = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authorization } } });
  const { data, error } = await anon.auth.getUser();
  if (error || !data.user) throw new HttpError(401, 'UNAUTHENTICATED');
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: emitter, error: emitterError } = await admin.from('tenant_emitters')
    .select('id,tenant_id,cnpj').eq('id', emitterId).eq('active', true).maybeSingle();
  if (emitterError || !emitter) throw new HttpError(404, 'Emitente ativo não encontrado');
  const { data: membership } = await admin.from('tenant_memberships').select('role,active')
    .eq('tenant_id', emitter.tenant_id).eq('user_id', data.user.id).maybeSingle();
  if (!membership?.active) throw new HttpError(403, 'FORBIDDEN');
  return { admin, user: data.user, emitter, isAdmin: ['owner', 'admin'].includes(String(membership.role)) };
}

async function readCache(admin: any, tenantId: string, uf: string, lookupType: LookupType, lookupValue: string) {
  const since = new Date(Date.now() - CACHE_HOURS * 60 * 60 * 1000).toISOString();
  const { data: query } = await admin.from('tax_registry_queries').select('id,c_stat,reason,result_status,created_at')
    .eq('tenant_id', tenantId).eq('uf', uf).eq('lookup_type', lookupType).eq('lookup_value', lookupValue)
    .eq('result_status', 'success').gte('created_at', since).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!query) return null;
  const { data: profiles } = await admin.from('fiscal_party_registry').select('*')
    .eq('tenant_id', tenantId).eq('source_query_id', query.id);
  if (!profiles?.length) return null;
  return {
    query_id: query.id,
    c_stat: query.c_stat,
    reason: query.reason,
    status: query.result_status,
    profiles: profiles.map(publicProfile),
  };
}

async function writeQuery(context: any, input: any) {
  const responsePayload = {
    http_status: input.responseStatus || null,
    normalized_records: input.normalized || [],
    raw_response_excerpt: input.responseText ? input.responseText.slice(0, 4000) : null,
  };
  const { data, error } = await context.admin.from('tax_registry_queries').insert({
    tenant_id: context.emitter.tenant_id,
    emitter_id: context.emitter.id,
    certificate_id: input.certificateId,
    uf: input.uf,
    lookup_type: input.lookupType,
    lookup_value: input.lookupValue,
    endpoint: input.endpoint,
    result_status: input.resultStatus,
    c_stat: input.cStat,
    reason: input.reason,
    response_payload: responsePayload,
    response_hash: await sha256Hex(input.responseText || JSON.stringify(responsePayload)),
    duration_ms: input.durationMs,
    requested_by: context.user.id,
  }).select('id').single();
  if (error) throw error;
  return data;
}

function publicProfile(profile: any) {
  return {
    id: profile.id,
    cnpj: profile.cnpj,
    uf: profile.uf,
    state_registration: profile.state_registration,
    legal_name: profile.legal_name,
    trade_name: profile.trade_name,
    registry_status: profile.registry_status,
    status_code: profile.status_code,
    tax_regime: profile.tax_regime,
    economic_activity_code: profile.economic_activity_code,
    official_address: profile.official_address,
    verified_at: profile.verified_at,
  };
}

function validateLookup(uf: string, type: LookupType, value: string, environment: string) {
  if (!/^[A-Z]{2}$/.test(uf)) throw new HttpError(400, 'UF inválida');
  if (!['CNPJ', 'CPF', 'IE'].includes(type)) throw new HttpError(400, 'Tipo de consulta inválido');
  if (!['production', 'homologation'].includes(environment)) throw new HttpError(400, 'Ambiente inválido');
  if (type === 'CNPJ' && value.length !== 14) throw new HttpError(400, 'CNPJ inválido');
  if (type === 'CPF' && value.length !== 11) throw new HttpError(400, 'CPF inválido');
  if (type === 'IE' && (value.length < 2 || value.length > 14)) throw new HttpError(400, 'IE inválida');
}

function translateDatabaseError(message: string) {
  if (message.includes('cnpj_mismatch')) return 'O CNPJ oficial não corresponde ao estabelecimento selecionado';
  if (message.includes('profile_invalid')) return 'A consulta oficial não é válida para esta aplicação';
  return message;
}

function safeError(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: 'unknown' };
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
