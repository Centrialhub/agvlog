import { createClient } from '@supabase/supabase-js';
import { corsHeaders } from '../_shared/cors.ts';
import { isCronRequest } from '../_shared/cron-auth.ts';

type ClaimedAddress = {
  id: string;
  tenant_id: string;
  entity_type: 'client' | 'dispatch_stop';
  entity_id: string;
  address_snapshot: string;
  address_hash: string;
  lease_token: string;
  attempts: number;
};

type GeocodeResponse = {
  candidates?: unknown[];
  cache?: 'hit' | 'miss';
  error?: unknown;
  retry_after_ms?: unknown;
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const boundedError = (value: unknown) => String(value || 'geocoding_failed').slice(0, 300);

// Conservative incident throughput: do not lease a five-item serial batch.
const CLAIM_LIMIT = 1;
const LEASE_SECONDS = 45;
const GEOCODER_TIMEOUT_MS = 12_000;
const RPC_TIMEOUT_MS = 5_000;

async function withRpcDeadline<T>(run: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return json({ error: 'server_not_configured' }, 503);
  if (!await isCronRequest(req, url, serviceKey)) return json({ error: 'unauthorized' }, 401);
  const cronSecret = req.headers.get('x-agvlog-cron-secret');
  if (!cronSecret) return json({ error: 'unauthorized' }, 401);

  const input = await req.json().catch(() => ({})) as { limit?: unknown };
  const limit = Math.max(1, Math.min(CLAIM_LIMIT, Number(input.limit) || CLAIM_LIMIT));
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await withRpcDeadline((signal) => admin.rpc('claim_address_resolution_queue_v2', {
    _limit: limit,
    _lease_seconds: LEASE_SECONDS,
  }).abortSignal(signal));
  if (error) return json({ error: 'address_queue_claim_failed' }, 503);
  const claimed = Array.isArray(data) ? data as ClaimedAddress[] : [];
  const results: Array<Record<string, unknown>> = [];

  for (const [index, item] of claimed.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 1_100));
    const requestKey = `${item.id}:${item.address_hash}:${item.attempts + 1}`;
    let status = 0;
    let payload: GeocodeResponse = {};
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEOCODER_TIMEOUT_MS);
    try {
      const response = await fetch(`${url}/functions/v1/geocode-address`, {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`,
          'x-agvlog-cron-secret': cronSecret,
        },
        body: JSON.stringify({
          tenant_id: item.tenant_id,
          address: item.address_snapshot,
          limit: 5,
          entity_type: item.entity_type,
          entity_id: item.entity_id,
          queue_id: item.id,
          lease_token: item.lease_token,
        }),
      });
      status = response.status;
      const decoded: unknown = await response.json().catch(() => ({}));
      if (controller.signal.aborted) throw new Error('geocode_worker_timeout');
      payload = decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)
        ? decoded as GeocodeResponse : { error: 'invalid_geocoder_response' };
    } catch (failure) {
      payload = { error: controller.signal.aborted ? 'geocode_worker_timeout'
        : failure instanceof Error ? failure.message : 'geocoder_unreachable' };
    } finally {
      clearTimeout(timer);
    }

    const candidates = status >= 200 && status < 300 && Array.isArray(payload.candidates)
      ? payload.candidates : null;
    const { data: acknowledgement, error: acknowledgementError } = await withRpcDeadline((signal) => admin.rpc(
      'ack_address_resolution_queue_item_v2',
      { _payload: {
        queue_id: item.id,
        lease_token: item.lease_token,
        request_key: requestKey,
        address_hash: item.address_hash,
        candidates: candidates ?? [],
        provider: Deno.env.get('GEOCODING_PROVIDER') || 'nominatim',
        cache: payload.cache || null,
        error: candidates ? null : boundedError(payload.error || `geocode_http_${status || 503}`),
        retry_after_ms: Number(payload.retry_after_ms) || null,
      } },
    ).abortSignal(signal));
    results.push({
      queue_id: item.id,
      acknowledged: !acknowledgementError,
      result: acknowledgementError ? null : acknowledgement,
      error: acknowledgementError ? 'address_queue_ack_failed' : null,
    });
  }

  return json({
    success: results.every((result) => result.acknowledged === true),
    claimed: claimed.length,
    results,
  });
});
