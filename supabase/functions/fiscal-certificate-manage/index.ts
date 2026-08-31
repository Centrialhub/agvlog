import { createClient } from '@supabase/supabase-js';
import { withFiscalCors } from '../_shared/fiscal-cors.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { encryptFiscalCredential } from '../_shared/fiscal-credential-crypto.ts';
import { digits } from '../_shared/tax-registry.ts';
import { parseFiscalPkcs12 } from '../_shared/fiscal-certificate.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ENC_KEY = Deno.env.get('AGVLOG_ENCRYPTION_KEY') || '';
const MAX_FILE_BYTES = 10 * 1024 * 1024;

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function authContext(req: Request, emitterId: string) {
  const authorization = req.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'UNAUTHENTICATED');
  const anon = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authorization } } });
  const { data, error } = await anon.auth.getUser();
  if (error || !data.user) throw new HttpError(401, 'UNAUTHENTICATED');

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: emitter, error: emitterError } = await admin.from('tenant_emitters')
    .select('id,tenant_id,cnpj').eq('id', emitterId).maybeSingle();
  if (emitterError || !emitter) throw new HttpError(404, 'Emitente não encontrado');
  const { data: membership } = await admin.from('tenant_memberships').select('role,active')
    .eq('tenant_id', emitter.tenant_id).eq('user_id', data.user.id).maybeSingle();
  if (!membership?.active) throw new HttpError(403, 'FORBIDDEN');
  return { admin, user: data.user, emitter, isAdmin: ['owner', 'admin'].includes(String(membership.role)) };
}

Deno.serve(withFiscalCors(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    const contentType = req.headers.get('content-type') || '';
    const form = contentType.includes('multipart/form-data') ? await req.formData() : null;
    const body = form ? null : await req.json().catch(() => ({}));
    const action = String(form?.get('action') || body?.action || 'list');
    const emitterId = String(form?.get('emitter_id') || body?.emitter_id || '');
    if (!emitterId) throw new HttpError(400, 'emitter_id obrigatório');
    const context = await authContext(req, emitterId);

    if (action === 'list') {
      await context.admin.from('fiscal_certificates').update({ status: 'expired' })
        .eq('tenant_id', context.emitter.tenant_id).eq('emitter_id', emitterId)
        .eq('status', 'active').lte('valid_to', new Date().toISOString());
      const { data, error } = await context.admin.from('fiscal_certificates')
        .select('id,label,thumbprint_sha256,serial_number,subject_name,certificate_cnpj,valid_from,valid_to,status,last_tested_at,last_test_error,created_at,updated_at')
        .eq('tenant_id', context.emitter.tenant_id).eq('emitter_id', emitterId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return json(200, { certificates: data || [] });
    }

    if (!context.isAdmin) throw new HttpError(403, 'Apenas administradores podem alterar certificados');

    if (action === 'deactivate') {
      const certificateId = String(body?.certificate_id || '');
      const { error } = await context.admin.from('fiscal_certificates').update({ status: 'inactive' })
        .eq('id', certificateId).eq('tenant_id', context.emitter.tenant_id).eq('emitter_id', emitterId);
      if (error) throw error;
      return json(200, { success: true });
    }

    if (action !== 'upload' || !form) throw new HttpError(400, 'Ação inválida');
    if (!ENC_KEY) throw new HttpError(500, 'AGVLOG_ENCRYPTION_KEY não configurada');
    const file = form.get('certificate');
    const password = String(form.get('password') || '');
    const label = String(form.get('label') || 'Certificado A1').trim().slice(0, 120);
    if (!(file instanceof File)) throw new HttpError(400, 'Arquivo PFX/P12 obrigatório');
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new HttpError(400, 'Arquivo de certificado inválido ou maior que 10 MB');
    if (!/\.(pfx|p12)$/i.test(file.name)) throw new HttpError(400, 'Envie um certificado A1 .pfx ou .p12');

    let parsed;
    try { parsed = await parseFiscalPkcs12(new Uint8Array(await file.arrayBuffer()), password); }
    catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'Certificado inválido'); }
    const emitterCnpj = digits(context.emitter.cnpj);
    if (!parsed.certificateCnpj || parsed.certificateCnpj.slice(0, 8) !== emitterCnpj.slice(0, 8)) {
      throw new HttpError(400, 'O CNPJ do certificado não pertence à raiz do emitente');
    }
    const now = new Date();
    if (parsed.validFrom > now) throw new HttpError(400, 'Certificado ainda não é válido');
    if (parsed.validTo <= now) throw new HttpError(400, 'Certificado expirado');

    const ciphertext = await encryptFiscalCredential(JSON.stringify({
      certificatePem: parsed.certificatePem,
      privateKeyPem: parsed.privateKeyPem,
    }), ENC_KEY);
    const { data: inserted, error: insertError } = await context.admin.from('fiscal_certificates').insert({
      tenant_id: context.emitter.tenant_id,
      emitter_id: emitterId,
      label: label || 'Certificado A1',
      certificate_ciphertext: ciphertext,
      thumbprint_sha256: parsed.thumbprint,
      serial_number: parsed.serialNumber,
      subject_name: parsed.subjectName,
      certificate_cnpj: parsed.certificateCnpj,
      valid_from: parsed.validFrom.toISOString(),
      valid_to: parsed.validTo.toISOString(),
      status: 'inactive',
      uploaded_by: context.user.id,
      last_tested_at: now.toISOString(),
    }).select('id').single();
    if (insertError) throw insertError;
    const { error: activationError } = await context.admin.rpc('activate_fiscal_certificate', {
      _tenant: context.emitter.tenant_id,
      _emitter: emitterId,
      _certificate: inserted.id,
    });
    if (activationError) throw activationError;
    return json(200, {
      certificate: {
        id: inserted.id,
        label: label || 'Certificado A1',
        thumbprint_sha256: parsed.thumbprint,
        serial_number: parsed.serialNumber,
        subject_name: parsed.subjectName,
        certificate_cnpj: parsed.certificateCnpj,
        valid_from: parsed.validFrom.toISOString(),
        valid_to: parsed.validTo.toISOString(),
        status: 'active',
      },
    });
  } catch (error) {
    console.error('[fiscal-certificate-manage]', safeError(error));
    const status = error instanceof HttpError ? error.status : 500;
    return json(status, { error: error instanceof Error ? error.message : 'INTERNAL_ERROR' });
  }
}));

function safeError(error: unknown) {
  return error instanceof Error ? { name: error.name, message: error.message } : { message: 'unknown' };
}

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
