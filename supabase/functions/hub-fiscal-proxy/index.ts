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

interface ProxyRequest {
  action:
    | 'emit'
    | 'get'
    | 'sync'
    | 'cancel'
    | 'cancel-nfse'
    | 'cce'
    | 'email'
    | 'file'
    | 'query'
    | 'preview'
    | 'ping'
    | 'desacordo'
    | 'cent'
    | 'discard'
    | 'import'
    | 'deliver'
    | 'links';
  tenantId: string;
  type?: string;
  id?: string;
  emissionId?: string;
  body?: any;
  externalId?: string;
  emitterId?: string;
  environment?: 'sandbox' | 'production';
  fiscalDocumentId?: string;
  cteDocumentId?: string;
  nfseDocumentId?: string;
}

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Access Control Helpers
async function validateAccess(supabase: any, userId: string, tenantId: string, action: string) {
  const { data: membership } = await supabase
    .from('tenant_memberships')
    .select('role')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!membership) return { error: 'NO_MEMBERSHIP' };
  
  const capabilityMap: Record<string, string[]> = {
    'get': ['fiscal.read', 'fiscal.admin'],
    'query': ['fiscal.read', 'fiscal.admin'],
    'links': ['fiscal.read', 'fiscal.admin'],
    'ping': ['fiscal.read', 'fiscal.admin'],
    'emit': ['fiscal.emit', 'fiscal.admin'],
    'sync': ['fiscal.emit', 'fiscal.admin'],
    'import': ['fiscal.emit', 'fiscal.admin'],
    'preview': ['fiscal.emit', 'fiscal.admin'],
    'cancel': ['fiscal.cancel', 'fiscal.admin'],
    'cancel-nfse': ['fiscal.cancel', 'fiscal.admin'],
    'cce': ['fiscal.cancel', 'fiscal.admin'],
    'discard': ['fiscal.cancel', 'fiscal.admin'],
    'desacordo': ['fiscal.cancel', 'fiscal.admin'],
    'email': ['fiscal.admin'],
    'file': ['fiscal.read', 'fiscal.admin'],
    'cent': ['fiscal.admin'],
    'deliver': ['fiscal.admin'],
  };

  const required = capabilityMap[action] || [];
  if (required.length === 0) return { error: 'INVALID_ACTION' };

  if (['driver', 'client'].includes(membership.role)) {
    return { error: 'INSUFFICIENT_PERMISSIONS' };
  }
  return { ok: true };
}

async function assertEntityOwner(supabase: any, tenantId: string, table: string, id: string) {
  const { data } = await supabase.from(table).select('tenant_id').eq('id', id).eq('tenant_id', tenantId).maybeSingle();
  return !!data;
}

async function callHub(method: string, path: string, qs?: Record<string, string>, body?: unknown, token?: string) {
  const key = token || DEFAULT_HUB_KEY;
  const res = await fetch(`${HUB_BASE}${path}${qs ? '?' + new URLSearchParams(qs).toString() : ''}`, {
    method,
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'UNAUTHENTICATED' });

    const client = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await client.auth.getUser();
    if (!user) return json(401, { error: 'UNAUTHENTICATED' });

    const payload = (await req.json()) as ProxyRequest;
    if (!payload.tenantId) return json(400, { error: 'TENANT_ID_REQUIRED' });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const access = await validateAccess(admin, user.id, payload.tenantId, payload.action);
    if (access.error) return json(403, { error: access.error });

    if (payload.emissionId && !(await assertEntityOwner(admin, payload.tenantId, 'hub_fiscal_emissions', payload.emissionId))) {
      return json(404, { error: 'EMISSION_NOT_FOUND' });
    }

    const correlationId = crypto.randomUUID();
    
    // Emissions Persistence & Idempotency
    if (payload.action === 'emit') {
      if (!payload.externalId) return json(400, { error: 'EXTERNAL_ID_REQUIRED' });
      const { data: existing } = await admin.from('hub_fiscal_emissions')
        .select('*').eq('tenant_id', payload.tenantId).eq('doc_type', payload.type).eq('external_id', payload.externalId).maybeSingle();

      if (existing && existing.status !== 'error') {
        return json(200, { success: true, emission: existing, note: 'idempotent_recovery' });
      }

      await admin.from('hub_fiscal_emissions').upsert({
        tenant_id: payload.tenantId,
        doc_type: payload.type,
        external_id: payload.externalId,
        status: 'processing',
        correlation_id: correlationId,
        created_by: user.id
      });
    }

    // Hub API Key Retrieval & Decryption
    let hubKey = DEFAULT_HUB_KEY;
    if (payload.emitterId) {
      const { data: emitter } = await admin
        .from('tenant_emitters')
        .select('credential_id')
        .eq('id', payload.emitterId)
        .eq('tenant_id', payload.tenantId)
        .maybeSingle();
      
      if (emitter?.credential_id) {
        const { data: cred } = await admin
          .from('hub_fiscal_credentials')
          .select('api_key_encrypted')
          .eq('id', emitter.credential_id)
          .maybeSingle();
        
        if (cred?.api_key_encrypted && ENC_KEY) {
          try {
            hubKey = await decryptAesGcm(cred.api_key_encrypted, ENC_KEY);
          } catch (e) {
            console.error('Decryption failed:', e);
          }
        }
      }
    }

    const { action, type, id, body } = payload;
    const typePath = type ? `?type=${type}` : '';
    
    let result: { status: number; data: any };

    switch (action) {
      case 'emit':
        result = await callHub('POST', `/hub_documents_emit${typePath}`, {}, body, hubKey);
        break;
      case 'get':
        result = await callHub('GET', `/hub_documents_get/${id}`, {}, undefined, hubKey);
        break;
      case 'sync':
        result = await callHub('GET', `/hub_documents_sync/${id}`, {}, undefined, hubKey);
        break;
      case 'cancel':
        result = await callHub('POST', `/hub_documents_cancel/${id}`, {}, body, hubKey);
        break;
      case 'cancel-nfse':
        result = await callHub('POST', `/hub_documents_cancel_nfse/${id}`, {}, body, hubKey);
        break;
      case 'cce':
        result = await callHub('POST', `/hub_documents_cce/${id}`, {}, body, hubKey);
        break;
      case 'query':
        result = await callHub('POST', '/hub_documents_query', {}, body, hubKey);
        break;
      case 'preview':
        result = await callHub('POST', `/hub_documents_preview${typePath}`, {}, body, hubKey);
        break;
      case 'ping':
        result = await callHub('GET', '/ping', {}, undefined, hubKey);
        break;
      case 'discard':
        result = await callHub('POST', `/hub_documents_discard/${id}`, {}, body, hubKey);
        break;
      case 'import':
        result = await callHub('POST', `/hub_documents_import${typePath}`, {}, body, hubKey);
        break;
      case 'email':
        result = await callHub('POST', `/hub_documents_email/${id}`, {}, body, hubKey);
        break;
      case 'file':
        result = await callHub('GET', `/hub_documents_file/${id}`, body || {}, undefined, hubKey);
        break;
      case 'desacordo':
        result = await callHub('POST', `/hub_documents_desacordo/${id}`, {}, body, hubKey);
        break;
      case 'cent':
        result = await callHub('POST', '/hub_documents_cent', {}, body, hubKey);
        break;
      case 'deliver':
        result = await callHub('POST', `/hub_documents_deliver/${id}`, {}, body, hubKey);
        break;
      case 'links':
        result = await callHub('GET', `/hub_documents_links/${id}`, {}, undefined, hubKey);
        break;
      default:
        return json(400, { error: 'UNSUPPORTED_ACTION' });
    }

    // Persistence Update
    if (payload.action === 'emit' && result.status < 300) {
      const hubData = result.data;
      const hubDocId = hubData?.document?.id || hubData?.id;
      const idIntegracao = hubData?.document?.idIntegracao || hubData?.idIntegracao;

      if (hubDocId || idIntegracao) {
        await admin.from('hub_fiscal_emissions').update({
          hub_document_id: hubDocId,
          id_integracao: idIntegracao,
          status: result.status === 202 ? 'processing' : 'authorized',
          last_response: hubData,
          updated_at: new Date().toISOString()
        }).eq('correlation_id', correlationId);
      }
    }

    return json(result.status, { 
      success: result.status < 300, 
      hub: result.data, 
      correlationId 
    });
  } catch (err) {
    return json(500, { error: 'INTERNAL_ERROR', message: err.message });
  }
});
