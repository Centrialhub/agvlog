// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (request: Request) => Promise<Response>;
type Payload = Record<string, unknown>;
type QueueState = {
  status: string; candidates: unknown[]; attempts: number; last_error: string | null;
  lease_token: string | null; lease_expires_at: Date | null; next_attempt_at: Date;
  processed_at: Date | null; last_worker_request_key: string | null;
};
const tenant = '10000000-0000-4000-8000-000000000001';
const otherTenant = '10000000-0000-4000-8000-000000000002';
const queueId = '20000000-0000-4000-8000-000000000001';
const clientId = '30000000-0000-4000-8000-000000000001';
const canonicalId = '40000000-0000-4000-8000-000000000001';
const lease = '50000000-0000-4000-8000-000000000001';
const addressHash = 'a'.repeat(64);
const claimed = {
  id: queueId, tenant_id: tenant, entity_type: 'client', entity_id: clientId,
  canonical_address_id: canonicalId, address_snapshot: 'Synthetic fixture address',
  address_hash: addressHash, lease_token: lease, attempts: 2,
};
const candidate = { latitude: -19.9, longitude: -43.9, provider: 'fixture',
  accuracy_m: 25, confidence: 0.8, label: 'Synthetic location' };

const state = vi.hoisted(() => ({
  handler: null as Handler | null,
  ackPayloads: [] as Payload[],
  claimArgs: [] as Payload[],
  ack: null as null | ((payload: Payload) => Promise<unknown>),
}));

vi.mock('../../supabase/functions/_shared/cron-auth.ts', () => ({
  isCronRequest: async () => true,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (name: string, args: Payload) => {
      const result = (async () => {
      if (name === 'claim_address_resolution_queue_v2') {
        state.claimArgs.push(args);
        return { data: [claimed], error: null };
      }
      if (name !== 'ack_address_resolution_queue_item_v2' || !state.ack) {
        throw new Error(`Unexpected RPC ${name}`);
      }
      // Match the JSON transport: preserve explicit JSON null and omit undefined.
      const payload = JSON.parse(JSON.stringify(args._payload)) as Payload;
      state.ackPayloads.push(payload);
      try { return { data: await state.ack(payload), error: null }; }
      catch (error) { return { data: null, error }; }
      })();
      return Object.assign(result, { abortSignal: (_signal: AbortSignal) => result });
    },
  }),
}));

let db: PGlite;
const migration = readFileSync(
  'supabase/migrations/20260916152615_finalize_geofence_automation.sql', 'utf8',
).replace(/\r\n/g, '\n');
// Execute the historical ACK, then the approved containment; no cron schedule,
// unrelated migrations or any shared database. Dependencies use minimal tables;
// geofence synchronization is an observable fixture stub, not full geofence QA.
const ackSql = migration.match(
  /create or replace function public\.ack_address_resolution_queue_item_v2\(_payload jsonb\)[\s\S]*?grant execute on function public\.ack_address_resolution_queue_item_v2\(jsonb\) to service_role;/,
)?.[0];
if (!ackSql) throw new Error('Candidate ACK definition not found');

async function ack(payload: Payload) {
  return (await db.query<{ result: Payload }>(
    'select public.ack_address_resolution_queue_item_v2($1::jsonb) result',
    [JSON.stringify(payload)],
  )).rows[0].result;
}
async function queue() {
  return (await db.query<QueueState>(
    `select status,candidates,attempts,last_error,lease_token,lease_expires_at,
       next_attempt_at,processed_at,last_worker_request_key
     from public.address_resolution_queue where id=$1`, [queueId],
  )).rows[0];
}
function validPayload(extra: Payload = {}): Payload {
  return { queue_id: queueId, lease_token: lease, address_hash: addressHash,
    request_key: `${queueId}:${addressHash}:3`, candidates: [], error: 'fixture_failure', ...extra };
}
async function runWorker() {
  if (!state.handler) throw new Error('Worker not loaded');
  return (await state.handler(new Request('https://worker.example.test', {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      'x-agvlog-cron-secret': 'synthetic-fixture-secret' }, body: JSON.stringify({ limit: 1 }),
  }))).json();
}
function geocoder(body: unknown, status = 200) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })));
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role service_role; create role authenticated; create role anon;
    create schema private;
    create table public.canonical_addresses(id uuid primary key,tenant_id uuid,address_hash text,
      normalized_address text,status text,latitude float8,longitude float8,provider text,
      accuracy_m float8,confidence float8,resolved_at timestamptz,resolved_by uuid,updated_at timestamptz);
    create table public.clients(id uuid primary key,tenant_id uuid,canonical_address_id uuid,
      address_lat float8,address_lng float8,address_geocode_status text,address_geocode_provider text,
      address_geocode_accuracy_m float8,address_geocode_confidence float8,address_geocoded_at timestamptz,
      address_geocoded_by uuid,address_geocode_hash text,address_geocode_audit jsonb);
    create table public.dispatch_stops(id uuid primary key,tenant_id uuid,canonical_address_id uuid,
      latitude float8,longitude float8,location_source text,location_address text,location_provider text,
      location_accuracy_m float8,location_confidence float8,location_resolved_at timestamptz,
      location_resolved_by uuid,location_verification_status text,location_invalidated_at timestamptz,
      location_audit jsonb,status text);
    create table public.address_resolution_queue(id uuid primary key,tenant_id uuid,entity_type text,
      entity_id uuid,canonical_address_id uuid,address_snapshot text,address_hash text,status text,
      candidates jsonb,attempts integer,last_error text,processed_at timestamptz,next_attempt_at timestamptz,
      updated_at timestamptz,resolved_lat float8,resolved_lng float8,resolved_provider text,
      resolved_accuracy_m float8,resolved_confidence float8,resolved_at timestamptz,resolved_by uuid,
      lease_token uuid,lease_expires_at timestamptz,last_worker_request_key text,
      resolution_kind text,resolution_details jsonb);
    create table public.fixture_geofence_sync(tenant_id uuid,canonical_address_id uuid);
    create function public.stop_terminal_statuses() returns text[] language sql
      as $$ select array['completed','cancelled']::text[] $$;
    create function private.sync_fleet_geofences_for_canonical_v1(uuid,uuid) returns integer language plpgsql
      as $$ begin insert into public.fixture_geofence_sync values($1,$2); return 1; end $$;
    grant usage on schema private to service_role;
    grant select,insert,update on all tables in schema public to service_role;
  `);
  await db.exec(ackSql);
  const containment = readFileSync('supabase/migrations/20261009151836_address_queue_business_errors_no_serialization_retry.sql', 'utf8');
  const claimedRpc = containment.match(/CREATE OR REPLACE FUNCTION public\.get_claimed_address_resolution_item_v1[\s\S]*?\$function\$ ;/)?.[0];
  if (!claimedRpc) throw new Error('Contained get-claimed definition missing');
  const containedAck = containment.match(/CREATE OR REPLACE FUNCTION public\.ack_address_resolution_queue_item_v2[\s\S]*?\$function\$ ;/)?.[0];
  if (!containedAck) throw new Error("Contained ACK definition missing");
  await db.exec(containedAck);
  await db.exec(claimedRpc);
  await db.exec('revoke all on function public.get_claimed_address_resolution_item_v1(uuid,uuid) from public,anon,authenticated,service_role; grant execute on function public.get_claimed_address_resolution_item_v1(uuid,uuid) to service_role;');
  await db.exec(containment);
  state.ack = ack;
  vi.stubGlobal('Deno', {
    env: { get: (key: string) => ({ SUPABASE_URL: 'https://db.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', SUPABASE_ANON_KEY: 'synthetic-anon',
      GEOCODING_PROVIDER: 'fixture' } as Record<string, string>)[key] },
    serve: (handler: Handler) => { state.handler = handler; },
  });
  const workerPath = '../../supabase/functions/process-address-resolution-queue/index.ts';
  await import(workerPath);
}, 30_000);

beforeEach(async () => {
  vi.unstubAllGlobals();
  // Keep the captured real handler; only its Deno environment is needed per call.
  vi.stubGlobal('Deno', { env: { get: (key: string) => ({
    SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
    SUPABASE_ANON_KEY: 'synthetic-anon', GEOCODING_PROVIDER: 'fixture',
  } as Record<string, string>)[key] } });
  state.ackPayloads = [];
  state.claimArgs = [];
  await db.exec(`reset role; truncate public.address_resolution_queue,public.clients,
    public.dispatch_stops,public.canonical_addresses,public.fixture_geofence_sync;
    insert into public.canonical_addresses(id,tenant_id,address_hash,normalized_address,status)
      values('${canonicalId}','${tenant}','${addressHash}','Synthetic fixture address','pending');
    insert into public.clients(id,tenant_id,canonical_address_id,address_geocode_hash,address_geocode_status)
      values('${clientId}','${tenant}','${canonicalId}','${addressHash}','pending'),
        ('30000000-0000-4000-8000-000000000002','${otherTenant}','${canonicalId}','${addressHash}','pending');
    insert into public.dispatch_stops(id,tenant_id,canonical_address_id,latitude,longitude,location_source,status)
      values('60000000-0000-4000-8000-000000000001','${tenant}','${canonicalId}',1,2,'map_selected','pending'),
        ('60000000-0000-4000-8000-000000000002','${tenant}','${canonicalId}',null,null,'address_geocoded','pending');
    insert into public.address_resolution_queue(id,tenant_id,entity_type,entity_id,canonical_address_id,
      address_snapshot,address_hash,status,candidates,attempts,next_attempt_at,lease_token,lease_expires_at)
      values('${queueId}','${tenant}','client','${clientId}','${canonicalId}','Synthetic fixture address',
        '${addressHash}','pending','[]',2,clock_timestamp(),'${lease}',clock_timestamp()+interval '45 seconds');
    set role service_role;
  `);
});
afterAll(async () => { vi.unstubAllGlobals(); await db?.close(); });

describe('address worker error ACK with the contained SQL contract', () => {
  it.each([
    ['HTTP 502', 502, { error: 'provider_unavailable' }, 'provider_unavailable'],
    ['non-2xx even with candidates', 429, { candidates: [candidate] }, 'geocode_http_429'],
    ['missing candidates', 200, {}, 'geocode_http_200'],
    ['JSON null candidates', 200, { candidates: null }, 'geocode_http_200'],
    ['malformed object candidates', 200, { candidates: {} }, 'geocode_http_200'],
    ['malformed string candidates', 200, { candidates: 'invalid' }, 'geocode_http_200'],
    ['bounded provider error', 503, { error: 'x'.repeat(400) }, 'x'.repeat(300)],
  ])('persists %s, backoff and lease release', async (_case, status, body, expectedError) => {
    geocoder(body, status);
    const before = await queue();
    expect(await runWorker()).toMatchObject({ success: true, claimed: 1,
      results: [{ acknowledged: true, result: { status: 'error' }, error: null }] });
    expect(state.ackPayloads[0]).toMatchObject(validPayload({ error: expectedError,
      provider: 'fixture', cache: null, retry_after_ms: null }));
    expect(state.claimArgs).toEqual([{ _limit: 1, _lease_seconds: 45 }]);
    const after = await queue();
    expect(after).toMatchObject({ status: 'error', candidates: [], attempts: 3,
      last_error: expectedError, processed_at: null, lease_token: null, lease_expires_at: null,
      last_worker_request_key: `${queueId}:${addressHash}:3` });
    expect(after.next_attempt_at.getTime() - before.next_attempt_at.getTime()).toBeGreaterThanOrEqual(480_000);
    expect(after.next_attempt_at.getTime() - before.next_attempt_at.getTime()).toBeLessThan(490_000);
    expect((await db.query('select address_geocode_status from public.clients where tenant_id=$1',
      [otherTenant])).rows[0]).toEqual({ address_geocode_status: 'pending' });
  });

  it.each([
    ['network exception', new Error('synthetic_network_failure'), 'synthetic_network_failure'],
    ['timeout rejection', new DOMException('synthetic_timeout', 'AbortError'), 'synthetic_timeout'],
  ])('acknowledges %s with the original error', async (_case, failure, expectedError) => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw failure; }));
    expect(await runWorker()).toMatchObject({ success: true });
    expect(state.ackPayloads[0]).toMatchObject({ candidates: [], error: expectedError });
    expect(await queue()).toMatchObject({ attempts: 3, last_error: expectedError,
      status: 'error', lease_token: null, lease_expires_at: null });
  });

  it('preserves invalid JSON fallback and provider retry delay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{', { status: 502 })));
    expect(await runWorker()).toMatchObject({ success: true });
    expect(await queue()).toMatchObject({ last_error: 'geocode_http_502', attempts: 3 });
  });

  it('honors retry_after_ms and preserves cache metadata on failures', async () => {
    geocoder({ error: 'rate_limited', retry_after_ms: 900_000, cache: 'miss' }, 429);
    const before = await queue();
    expect(await runWorker()).toMatchObject({ success: true });
    expect(state.ackPayloads[0]).toMatchObject({ candidates: [], error: 'rate_limited',
      retry_after_ms: 900_000, cache: 'miss' });
    expect((await queue()).next_attempt_at.getTime() - before.next_attempt_at.getTime()).toBeGreaterThanOrEqual(900_000);
  });

  it('keeps a successful empty array as no_candidates without inventing a transport error', async () => {
    geocoder({ candidates: [], cache: 'hit' });
    expect(await runWorker()).toMatchObject({ success: true });
    expect(state.ackPayloads[0]).toMatchObject({ candidates: [], error: null, cache: 'hit' });
    expect(await queue()).toMatchObject({ status: 'error', last_error: 'no_candidates', attempts: 3 });
  });

  it('keeps successful multiple candidates ambiguous and preserves their array', async () => {
    const candidates = [candidate, { ...candidate, latitude: -20 }];
    geocoder({ candidates, cache: 'hit' });
    expect(await runWorker()).toMatchObject({ success: true });
    expect(state.ackPayloads[0]).toMatchObject({ candidates, error: null, cache: 'hit' });
    expect(await queue()).toMatchObject({ status: 'ambiguous', candidates, last_error: null,
      attempts: 3, lease_token: null });
  });

  it('resolves a unique valid candidate, retaining tenant and manual location boundaries', async () => {
    geocoder({ candidates: [candidate], cache: 'hit' });
    expect(await runWorker()).toMatchObject({ success: true, results: [{ result: { status: 'resolved' } }] });
    expect(await queue()).toMatchObject({ status: 'resolved', candidates: [candidate], attempts: 3,
      last_error: null, lease_token: null, lease_expires_at: null });
    expect((await db.query('select status,latitude,longitude from public.canonical_addresses')).rows[0])
      .toEqual({ status: 'verified', latitude: candidate.latitude, longitude: candidate.longitude });
    expect((await db.query('select address_geocode_status from public.clients where tenant_id=$1',
      [otherTenant])).rows[0]).toEqual({ address_geocode_status: 'pending' });
    expect((await db.query("select latitude,longitude from public.dispatch_stops where location_source='map_selected'")).rows[0])
      .toEqual({ latitude: 1, longitude: 2 });
    expect((await db.query('select * from public.fixture_geofence_sync')).rows)
      .toEqual([{ tenant_id: tenant, canonical_address_id: canonicalId }]);
  });
});

describe('SQL guards and replay remain unchanged', () => {
  it.each([null, {}, 'invalid', 42])('rejects external non-array candidates %j before any state mutation', async candidates => {
    const before = await queue();
    await expect(ack(validPayload({ candidates }))).rejects.toMatchObject({
      code: '22023', message: 'invalid_geocoding_candidates',
    });
    expect(await queue()).toEqual(before);
  });

  it('accepts an absent candidates property while preserving the error', async () => {
    const payload = validPayload();
    delete payload.candidates;
    expect(await ack(payload)).toMatchObject({ ok: true, status: 'error' });
    expect(await queue()).toMatchObject({ candidates: [], last_error: 'fixture_failure', attempts: 3 });
  });

  it.each([
    ['wrong lease', { lease_token: '50000000-0000-4000-8000-000000000002' }, 'address_queue_lease_lost'],
    ['changed hash', { address_hash: 'b'.repeat(64) }, 'address_queue_hash_changed'],
  ])('rejects %s without mutation', async (_case, extra, message) => {
    const before = await queue();
    await expect(ack(validPayload(extra))).rejects.toMatchObject({ code: 'P0001', message });
    expect(await queue()).toEqual(before);
  });

  it('rejects an expired lease without mutation', async () => {
    await db.exec("update public.address_resolution_queue set lease_expires_at=clock_timestamp()-interval '1 second'");
    const before = await queue();
    await expect(ack(validPayload())).rejects.toMatchObject({ code: 'P0001', message: 'address_queue_lease_lost' });
    expect(await queue()).toEqual(before);
  });

  it('replays the same error ACK without incrementing attempts or moving backoff', async () => {
    geocoder({ error: 'provider_unavailable' }, 502);
    expect(await runWorker()).toMatchObject({ success: true });
    const before = await queue();
    expect(await ack(state.ackPayloads[0])).toMatchObject({ ok: true, idempotent: true, status: 'error' });
    expect(await queue()).toEqual(before);
  });

  it('rejects excessive candidates and invalid queue identifiers without mutation', async () => {
    const before = await queue();
    await expect(ack(validPayload({ candidates: Array(6).fill(candidate) })))
      .rejects.toMatchObject({ code: '22023', message: 'too_many_geocoding_candidates' });
    await expect(ack(validPayload({ request_key: '' })))
      .rejects.toMatchObject({ code: '22023', message: 'invalid_address_queue_ack' });
    expect(await queue()).toEqual(before);
  });

  it('retains service-only execution and SECURITY INVOKER', async () => {
    const signature = 'public.ack_address_resolution_queue_item_v2(jsonb)';
    expect((await db.query(`select prosecdef definer,proconfig config,
      has_function_privilege('authenticated',$1,'execute') authenticated,
      has_function_privilege('anon',$1,'execute') anon,
      has_function_privilege('service_role',$1,'execute') service
      from pg_proc where oid=to_regprocedure($1)`, [signature])).rows[0])
      .toEqual({ definer: false, config: ['search_path=""'], authenticated: false, anon: false, service: true });
    await db.exec('reset role; set role authenticated');
    await expect(ack(validPayload())).rejects.toMatchObject({ code: '42501' });
  });
});
