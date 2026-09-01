// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (request: Request) => Promise<Response>;
type Row = Record<string, unknown>;

const claim = (vehicle = 'vehicle-a', token = '10000000-0000-4000-8000-000000000001') => ({
  tenant_id: 'tenant', vehicle_id: vehicle,
  queued_at: '2026-08-31T20:00:01.000Z',
  last_position_at: '2026-08-31T20:00:00.000Z',
  attempts: 1, claim_token: token, lease_until: '2026-08-31T20:05:01.000Z',
});

const state = vi.hoisted(() => ({
  handler: null as Handler | null,
  claimBatches: [] as Row[][],
  claimError: null as null | { code: string },
  ackResults: [] as boolean[],
  rpcCalls: [] as Array<{ name: string; args: Row }>,
  fromTables: [] as string[],
  positionsError: false,
  capabilityDisabled: false,
  clientCreations: 0,
}));

vi.mock('../../supabase/functions/_shared/cron-auth.ts', () => ({
  isCronRequest: async () => true,
}));

vi.mock('../../supabase/functions/_shared/capabilities.ts', () => ({
  requireIntegrationCapability: async () => state.capabilityDisabled
    ? new Response(JSON.stringify({ code: 'INTEGRATION_DISABLED' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
    : null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    state.clientCreations++;
    return {
      rpc: async (name: string, args: Row) => {
        state.rpcCalls.push({ name, args });
        if (name === 'claim_vehicle_processing_queue_v1') {
          return state.claimError
            ? { data: null, error: state.claimError }
            : { data: state.claimBatches.shift() || [], error: null };
        }
        if (name === 'ack_vehicle_processing_queue_v1') {
          return { data: state.ackResults.shift() ?? true, error: null };
        }
        throw new Error(`Unexpected RPC ${name}`);
      },
      from: (table: string) => {
        state.fromTables.push(table);
        return query(table);
      },
    };
  },
}));

function query(table: string) {
  let single = false;
  const builder = {
    select: (_columns?: string) => builder,
    eq: (_key: string, _value: unknown) => builder,
    gte: (_key: string, _value: unknown) => builder,
    lte: (_key: string, _value: unknown) => builder,
    order: (_key: string, _options?: unknown) => builder,
    limit: (_limit: number) => builder,
    single: () => { single = true; return builder; },
    then: (
      resolve: (value: { data: Row | Row[] | null; error: { message: string } | null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      let data: Row | Row[] | null = [];
      let error: { message: string } | null = null;
      if (table === 'tenants') data = { settings: {}, timezone: 'America/Sao_Paulo' };
      if (table === 'vehicles') data = { speed_limit_kmh: 80, fuel_canonical_key: null, tank_capacity_liters: null };
      if (table === 'positions_raw' && state.positionsError) error = { message: 'synthetic positions failure' };
      if (single && Array.isArray(data)) data = data[0] || null;
      return Promise.resolve({ data, error }).then(resolve, reject);
    },
  };
  return builder;
}

function request(method = 'POST') {
  if (!state.handler) throw new Error('Queue handler not loaded');
  return state.handler(new Request('https://edge.example.test', {
    method,
    headers: { 'Content-Type': 'application/json', 'x-agvlog-cron-secret': 'test-secret' },
    ...(method === 'POST' ? { body: JSON.stringify({ tenant_id: 'tenant', limit: 1 }) } : {}),
  }));
}

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: (key: string) => ({
      SUPABASE_URL: 'https://db.example.test',
      SUPABASE_SERVICE_ROLE_KEY: 'service-test',
      SUPABASE_ANON_KEY: 'anon-test',
    } as Record<string, string>)[key] },
    serve: (handler: Handler) => { state.handler = handler; },
  });
  const queuePath = '../../supabase/functions/agvlog-run-queue/index.ts';
  await import(queuePath);
});

beforeEach(() => {
  state.claimBatches = [[claim()]];
  state.claimError = null;
  state.ackResults = [true];
  state.rpcCalls = [];
  state.fromTables = [];
  state.positionsError = false;
  state.capabilityDisabled = false;
  state.clientCreations = 0;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SSX queue Edge worker claim concurrency', () => {
  it('processes only a database claim and ACKs its exact token/revision', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, processed: 1, errors: 0, superseded: 0 });
    expect(state.rpcCalls).toEqual([
      { name: 'claim_vehicle_processing_queue_v1', args: { _tenant_id: 'tenant', _limit: 1 } },
      { name: 'ack_vehicle_processing_queue_v1', args: {
        _tenant_id: 'tenant', _vehicle_id: 'vehicle-a',
        _claim_token: '10000000-0000-4000-8000-000000000001',
        _last_position_at: '2026-08-31T20:00:00.000Z', _success: true, _error: null,
      } },
    ]);
    expect(state.fromTables).not.toContain('vehicle_processing_queue');
  });

  it('does not report a stale worker as processed when ACK CAS loses', async () => {
    state.ackResults = [false];
    const response = await request();
    expect(await response.json()).toMatchObject({
      success: true, processed: 0, errors: 0, superseded: 1,
    });
    expect(state.fromTables).not.toContain('vehicle_processing_queue');
  });

  it('negative-ACKs a processing failure without a direct queue update', async () => {
    state.positionsError = true;
    const response = await request();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ success: false, processed: 0, errors: 1, superseded: 0 });
    expect(state.rpcCalls.at(-1)).toMatchObject({
      name: 'ack_vehicle_processing_queue_v1',
      args: { _success: false, _error: 'synthetic positions failure' },
    });
    expect(state.fromTables).not.toContain('vehicle_processing_queue');
  });

  it('keeps two worker invocations on distinct claims and tokens', async () => {
    state.claimBatches = [
      [claim('vehicle-a', '10000000-0000-4000-8000-000000000001')],
      [claim('vehicle-b', '10000000-0000-4000-8000-000000000002')],
    ];
    state.ackResults = [true, true];
    const [first, second] = await Promise.all([request(), request()]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const acknowledgements = state.rpcCalls.filter(call => call.name === 'ack_vehicle_processing_queue_v1');
    expect(new Set(acknowledgements.map(call => call.args._vehicle_id))).toEqual(new Set(['vehicle-a', 'vehicle-b']));
    expect(new Set(acknowledgements.map(call => call.args._claim_token)).size).toBe(2);
  });

  it('fails closed when the atomic claim RPC is unavailable', async () => {
    state.claimError = { code: 'PGRST202' };
    const response = await request();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, error: 'Queue claim failed' });
    expect(state.fromTables).toEqual([]);
  });

  it('does not claim work while the SSX capability or kill switch blocks it', async () => {
    state.capabilityDisabled = true;
    const response = await request();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ code: 'INTEGRATION_DISABLED' });
    expect(state.rpcCalls).toEqual([]);
    expect(state.fromTables).toEqual([]);
  });

  it('rejects non-POST before authentication or database access', async () => {
    const response = await request('GET');
    expect(response.status).toBe(405);
    expect(state.clientCreations).toBe(0);
    expect(state.rpcCalls).toEqual([]);
  });
});
