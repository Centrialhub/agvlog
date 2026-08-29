import { corsHeaders } from '../_shared/cors.ts';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ENC_KEY = Deno.env.get('AGVLOG_ENCRYPTION_KEY') || '';

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
function bytesToHex(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function encrypt(plaintext: string, keyHex: string): Promise<string> {
  const keyBytes = hexToBytes(keyHex.padEnd(64, '0').slice(0, 64));
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return `enc:v1:${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ct))}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (!ENC_KEY) return json(500, { error: 'AGVLOG_ENCRYPTION_KEY não configurada no backend' });

    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'UNAUTHENTICATED' });

    const anon = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await anon.auth.getUser();
    if (userErr || !userData?.user) return json(401, { error: 'UNAUTHENTICATED' });
    const userId = userData.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const body = await req.json().catch(() => ({} as any));
    const {
      id,
      emitter_id,
      doc_scope = 'all',
      environment = 'production',
      enabled = true,
      token,
    } = body || {};

    if (!emitter_id) return json(400, { error: 'emitter_id obrigatório' });
    if (!token || typeof token !== 'string' || token.trim().length < 8) {
      return json(400, { error: 'Token inválido' });
    }
    const validScopes = ['all', 'nfse', 'cte', 'nfe', 'nfce', 'mdfe', 'nfcom'];
    if (!validScopes.includes(doc_scope)) return json(400, { error: 'doc_scope inválido' });
    if (!['production', 'homologation', 'sandbox'].includes(environment)) return json(400, { error: 'environment inválido' });

    // Authorize: user must be admin/owner in the tenant that owns this emitter
    const { data: em, error: emErr } = await admin
      .from('tenant_emitters')
      .select('id, tenant_id')
      .eq('id', emitter_id)
      .maybeSingle();
    if (emErr || !em) return json(404, { error: 'Emitente não encontrado' });

    const { data: mem } = await admin
      .from('tenant_memberships')
      .select('role, active')
      .eq('tenant_id', em.tenant_id)
      .eq('user_id', userId)
      .maybeSingle();
    if (!mem?.active || !['admin', 'owner'].includes(String(mem.role))) {
      return json(403, { error: 'FORBIDDEN' });
    }
    const clean = token.trim();
    const ciphertext = await encrypt(clean, ENC_KEY);
    const hint = clean.length > 4 ? `••••${clean.slice(-4)}` : '••••';

    const payload: Record<string, unknown> = {
      tenant_id: em.tenant_id,
      emitter_id,
      doc_scope,
      environment,
      enabled,
      secret_ciphertext: ciphertext,
      secret_hint: hint,
      secret_name: null,
    };

    if (id) {
      const { data, error } = await admin
        .from('hub_fiscal_credentials')
        .update(payload)
        .eq('id', id)
        .eq('tenant_id', em.tenant_id)
        .select('id, doc_scope, environment, enabled, secret_hint, updated_at')
        .single();
      if (error) return json(400, { error: error.message });
      return json(200, { credential: data });
    }

    const { data, error } = await admin
      .from('hub_fiscal_credentials')
      .upsert(payload, { onConflict: 'emitter_id,doc_scope,environment' })
      .select('id, doc_scope, environment, enabled, secret_hint, updated_at')
      .single();
    if (error) return json(400, { error: error.message });
    return json(200, { credential: data });
  } catch (e: any) {
    console.error('[hub-fiscal-credential-save] fatal', e);
    return json(500, { error: e?.message || 'INTERNAL_ERROR' });
  }
});

