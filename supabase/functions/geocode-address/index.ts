import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';
import { requireActiveTenant } from '../_shared/active-tenant.ts';
import { isCronRequest } from '../_shared/cron-auth.ts';

type ProviderResult = {
  lat?: string;
  lon?: string;
  display_name?: string;
  importance?: number;
  boundingbox?: string[];
  type?: string;
};

type RequestBody = {
  tenant_id?: unknown;
  address?: unknown;
  limit?: unknown;
  entity_type?: unknown;
  entity_id?: unknown;
  queue_id?: unknown;
  lease_token?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=300' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anonKey || !serviceKey) return json({ error: 'server_not_configured' }, 503);

    const cron = await isCronRequest(req, url, serviceKey);
    const authorization = req.headers.get('Authorization');
    let actorId: string | null = null;
    if (!cron) {
      if (!authorization?.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);
      const client = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) return json({ error: 'unauthorized' }, 401);
      actorId = data.user.id;
    }

    const body = await req.json() as RequestBody;
    if (!cron) {
      const tenantContextError = requireActiveTenant(req, body.tenant_id);
      if (tenantContextError) return tenantContextError;
    }
    let tenantId = String(body.tenant_id || '');
    let address = typeof body.address === 'string' ? body.address.trim().replace(/\s+/g, ' ') : '';
    const limit = Math.min(5, Math.max(1, Number(body.limit) || 5));
    const provider = Deno.env.get('GEOCODING_PROVIDER') || 'nominatim';
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const hasEntityTarget = body.entity_type !== undefined || body.entity_id !== undefined;
    if (hasEntityTarget && (!['client', 'dispatch_stop'].includes(String(body.entity_type))
      || typeof body.entity_id !== 'string' || !UUID.test(body.entity_id))) {
      return json({ error: 'invalid_entity_target' }, 400);
    }
    if (cron) {
      if (typeof body.queue_id !== 'string' || !UUID.test(body.queue_id)
        || typeof body.lease_token !== 'string' || !UUID.test(body.lease_token)) {
        return json({ error: 'invalid_queue_claim' }, 400);
      }
      const { data: claim, error: claimError } = await admin.rpc('get_claimed_address_resolution_item_v1', {
        _queue_id: body.queue_id,
        _lease_token: body.lease_token,
      });
      const claimed = claim && typeof claim === 'object' ? claim as Record<string, unknown> : null;
      if (claimError || !claimed || typeof claimed.tenant_id !== 'string' || typeof claimed.address_snapshot !== 'string') {
        return json({ error: 'queue_claim_not_available' }, 409);
      }
      tenantId = claimed.tenant_id;
      address = claimed.address_snapshot.trim().replace(/\s+/g, ' ');
      if (body.tenant_id !== tenantId || body.address !== address || body.entity_id !== claimed.entity_id
        || body.entity_type !== claimed.entity_type) {
        return json({ error: 'queue_claim_mismatch' }, 409);
      }
    } else {
      const { data: membership, error: membershipError } = await admin.from('tenant_memberships')
        .select('role').eq('tenant_id', tenantId).eq('user_id', actorId).eq('active', true).maybeSingle();
      if (membershipError) return json({ error: 'membership_check_unavailable' }, 503);
      const role = typeof membership?.role === 'string' ? membership.role : '';
      if (!['owner', 'admin', 'operator'].includes(role)) return json({ error: 'forbidden' }, 403);
      if (hasEntityTarget && !['owner', 'admin'].includes(role)) return json({ error: 'forbidden' }, 403);
    }
    if (address.length < 8 || address.length > 500 || !UUID.test(tenantId)) return json({ error: 'invalid_address' }, 400);
    const addressHash = await sha256(address.toLocaleLowerCase('pt-BR'));
    const recordEntityCandidates = async (candidates: unknown[]) => {
      if (cron) return;
      const entityType = body.entity_type;
      if ((entityType !== 'client' && entityType !== 'dispatch_stop')
        || typeof body.entity_id !== 'string' || !UUID.test(body.entity_id)) return;
      const entityTable = entityType === 'client' ? 'clients' : 'dispatch_stops';
      const { data: entity, error: entityError } = await admin.from(entityTable).select('id,canonical_address_id')
        .eq('tenant_id', tenantId).eq('id', body.entity_id).maybeSingle();
      if (entityError) throw new Error('entity_lookup_failed');
      if (!entity?.id || typeof entity.canonical_address_id !== 'string') return;
      const { data: canonical, error: canonicalError } = await admin.from('canonical_addresses').select('address_hash')
        .eq('tenant_id', tenantId).eq('id', entity.canonical_address_id).maybeSingle();
      if (canonicalError) throw new Error('canonical_address_lookup_failed');
      if (canonical?.address_hash !== addressHash) return;
      const status = candidates.length === 1 ? 'pending' : candidates.length > 1 ? 'ambiguous' : 'error';
      const queueResult = await admin.from('address_resolution_queue').upsert({
          tenant_id: tenantId, entity_type: entityType, entity_id: entity.id,
          canonical_address_id: entity.canonical_address_id,
          address_snapshot: address, address_hash: addressHash, status, candidates,
          attempts: 1, last_error: candidates.length === 0 ? 'no_candidates' : null,
          processed_at: candidates.length > 0 ? new Date().toISOString() : null,
          next_attempt_at: new Date(Date.now() + (candidates.length > 0 ? 0 : 60_000)).toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id,entity_type,entity_id' });
      const entityResult = entityType === 'client'
        ? await admin.from('clients').update({ address_geocode_status: status === 'error' ? 'error' : status })
          .eq('tenant_id', tenantId).eq('id', entity.id).eq('canonical_address_id', entity.canonical_address_id)
        : { error: null };
      if (queueResult.error || entityResult.error) throw new Error('entity_candidates_persistence_failed');
    };
    const { data: cached } = await admin.from('address_geocoding_cache')
      .select('id,candidates,hit_count').eq('tenant_id', tenantId).eq('address_hash', addressHash)
      .eq('provider', provider).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (cached && Array.isArray(cached.candidates)) {
      await admin.from('address_geocoding_cache').update({
        hit_count: (Number((cached as { hit_count?: unknown }).hit_count) || 0) + 1,
        last_used_at: new Date().toISOString(),
      }).eq('id', cached.id);
      await recordEntityCandidates(cached.candidates);
      return json({ query: address, provider, candidates: cached.candidates, cache: 'hit' });
    }

    const { data: quota, error: quotaError } = await admin.rpc('consume_geocoding_quota_v1', {
      _tenant_id: tenantId,
      _provider: provider,
    });
    if (quotaError) return json({ error: 'geocoding_quota_unavailable' }, 503);
    const quotaResult = quota && typeof quota === 'object' ? quota as { allowed?: unknown; retry_after_ms?: unknown } : {};
    if (quotaResult.allowed !== true) {
      return json({ error: 'geocoding_rate_limited', retry_after_ms: Number(quotaResult.retry_after_ms) || 1000 }, 429);
    }

    const endpoint = new URL(Deno.env.get('GEOCODING_BASE_URL') || 'https://nominatim.openstreetmap.org/search');
    endpoint.searchParams.set('q', address);
    endpoint.searchParams.set('format', 'jsonv2');
    endpoint.searchParams.set('addressdetails', '1');
    endpoint.searchParams.set('countrycodes', 'br');
    endpoint.searchParams.set('limit', String(limit));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': Deno.env.get('GEOCODING_USER_AGENT') || 'AGVLog-TMS/1.0 (geocoding; contato operacional configuravel)',
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return json({ error: 'geocoding_provider_unavailable', status: response.status }, 502);
    const raw = await response.json();
    if (!Array.isArray(raw)) return json({ error: 'invalid_geocoding_response' }, 502);

    const candidates = (raw as ProviderResult[]).flatMap((item) => {
      const latitude = Number(item.lat);
      const longitude = Number(item.lon);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return [];
      const bounds = Array.isArray(item.boundingbox) && item.boundingbox.length === 4
        ? item.boundingbox.map(Number) : null;
      const confidence = Math.max(0, Math.min(1, Number(item.importance) || 0));
      return [{
        label: String(item.display_name || address).slice(0, 500), latitude, longitude, confidence,
        accuracy_m: confidence >= 0.7 ? 50 : confidence >= 0.4 ? 150 : 500,
        bounds: bounds?.every(Number.isFinite) ? bounds : null,
        provider, provider_type: item.type || null,
      }];
    });
    await admin.from('address_geocoding_cache').upsert({
      tenant_id: tenantId,
      address_hash: addressHash,
      normalized_address: address,
      provider,
      candidates,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      last_used_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id,address_hash,provider' });

    await recordEntityCandidates(candidates);
    return json({ query: address, provider, candidates, cache: 'miss' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return json({ error: 'geocoding_timeout' }, 504);
    console.error('[geocode-address]', error);
    return json({ error: 'geocoding_failed' }, 500);
  }
});
