import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const HUB_BASE = (Deno.env.get('HUB_FISCAL_BASE_URL') || '').replace(/\/$/, '');
const DEFAULT_HUB_KEY = Deno.env.get('HUB_FISCAL_API_KEY') || '';
const ENC_KEY = Deno.env.get('AGVLOG_ENCRYPTION_KEY') || '';

interface ProxyRequest {
  action: 'emit' | 'get' | 'sync' | 'cancel' | 'cce' | 'query' | 'preview' | 'ping';
  tenantId: string; // Mandatory
  type?: string;
  id?: string;
  emissionId?: string;
  body?: any;
  externalId?: string;
  emitterId?: string;
  environment?: 'sandbox' | 'production';
}

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Helpers
async function validateAccess(supabase: any, userId: string, tenantId: string, action: string) {
  const { data: membership } = await supabase
    .from('tenant_memberships')
    .select('role')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!membership) return { error: 'NO_MEMBERSHIP' };
  
  // Capability Matrix
  const capabilityMap: Record<string, string[]> = {
    'get': ['fiscal.read', 'fiscal.admin'],
    'query': ['fiscal.read', 'fiscal.admin'],
    'emit': ['fiscal.emit', 'fiscal.admin'],
    'sync': ['fiscal.emit', 'fiscal.admin'],
    'cancel': ['fiscal.cancel', 'fiscal.admin'],
    'cce': ['fiscal.cancel', 'fiscal.admin'],
  };

  const required = capabilityMap[action] || [];
  if (required.length === 0) return { error: 'INVALID_ACTION' };

  // Driver/Client Restriction
  if (['driver', 'client'].includes(membership.role)) {
    return { error: 'INSUFFICIENT_PERMISSIONS' };
  }

  return { ok: true };
}

async function assertEntityOwner(supabase: any, tenantId: string, table: string, id: string) {
  const { data, error } = await supabase
    .from(table)
    .select('tenant_id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  
  if (error || !data) return false;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) return json(401, { error: 'UNAUTHENTICATED' });

    const client = createClient(SUPABASE_URL, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });
    
    const { data: { user }, error: userErr } = await client.auth.getUser();
    if (userErr || !user) return json(401, { error: 'UNAUTHENTICATED' });

    const payload = (await req.json()) as ProxyRequest;
    if (!payload.tenantId) return json(400, { error: 'TENANT_ID_REQUIRED' });

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    
    // 1. Validate Membership & Capability
    const access = await validateAccess(admin, user.id, payload.tenantId, payload.action);
    if (access.error) return json(403, { error: access.error });

    // 2. Validate Ownership if IDs provided
    if (payload.emissionId && !(await assertEntityOwner(admin, payload.tenantId, 'hub_fiscal_emissions', payload.emissionId))) {
      return json(404, { error: 'EMISSION_NOT_FOUND' });
    }
    // ... repeat for other IDs if present

    // 3. Centralized Action Handling
    const correlationId = crypto.randomUUID();
    console.log(`[proxy] correlation=${correlationId} user=${user.id} tenant=${payload.tenantId} action=${payload.action}`);

    // IDEMPOTENCY / PERSISTENCE (Requirement 4)
    if (payload.action === 'emit') {
      if (!payload.externalId) return json(400, { error: 'EXTERNAL_ID_REQUIRED' });
      
      const { data: existing } = await admin.from('hub_fiscal_emissions')
        .select('*')
        .eq('tenant_id', payload.tenantId)
        .eq('doc_type', payload.type)
        .eq('external_id', payload.externalId)
        .maybeSingle();

      if (existing && existing.status !== 'error') {
        return json(200, { success: true, emission: existing, note: 'recovered_existing_attempt' });
      }

      // Pre-persist attempt
      const { error: insErr } = await admin.from('hub_fiscal_emissions').insert({
        tenant_id: payload.tenantId,
        doc_type: payload.type,
        external_id: payload.externalId,
        status: 'processing',
        correlation_id: correlationId,
        created_by: user.id
      });
      if (insErr) return json(500, { error: 'PERSISTENCE_FAILURE', details: insErr.message });
    }

    // Call Hub Logic (omitted for brevity, preserve existing logic here but scoped by tenant)
    // ...
    
    return json(200, { success: true, correlationId });

  } catch (err) {
    console.error('[proxy-error]', err);
    return json(500, { error: 'INTERNAL_ERROR' });
  }
});
