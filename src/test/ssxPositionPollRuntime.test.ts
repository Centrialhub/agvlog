// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type RpcPosition = Record<string, unknown> & { provider_payload_hash?: string };
type RpcArgs = Record<string, unknown> & {
  _positions?: RpcPosition[];
};

const state = vi.hoisted(() => ({
  handler: null as null | ((request: Request) => Promise<Response>),
  provider: { ok: true, status: 200, errorClass: undefined as string | undefined },
  items: [] as Record<string, unknown>[],
  rpcCalls: [] as Array<{ name: string; args: RpcArgs }>,
  writes: [] as string[],
  invalidReceipt: false,
  partialReceipt: false,
  clientCalls: 0,
}));

const tenant = '31000000-0000-4000-8000-000000000001';
const accountId = '32000000-0000-4000-8000-000000000001';
const unitId = '33000000-0000-4000-8000-000000000001';
const linkId = '34000000-0000-4000-8000-000000000001';
const vehicleId = '35000000-0000-4000-8000-000000000001';
const otherUnitId = '33000000-0000-4000-8000-000000000002';
const otherLinkId = '34000000-0000-4000-8000-000000000002';
const otherVehicleId = '35000000-0000-4000-8000-000000000002';

const tables: Record<string, Record<string, unknown>[]> = {
  integration_accounts: [{
    id: accountId, tenant_id: tenant, provider: 'SSX', status: 'ok',
    token_expires_at: '2099-01-01T00:00:00.000Z',
  }],
  provider_units: [{
    id: unitId, tenant_id: tenant, integration_account_id: accountId,
    external_code: 'UNIT-QA', active: true, metadata: { id_tracked_unit: '123' },
  }],
  vehicle_tracker_links: [{
    id: linkId, tenant_id: tenant, provider_unit_id: unitId,
    vehicle_id: vehicleId, active: true, start_at: '2020-01-01T00:00:00.000Z', end_at: null,
  }],
};

vi.mock('../../supabase/functions/_shared/cron-auth.ts', () => ({
  isCronRequest: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../supabase/functions/_shared/capabilities.ts', () => ({
  requireIntegrationCapability: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../supabase/functions/_shared/ssx-utils.ts', () => ({
  corsHeaders: {},
  buildPositionHistoryUrlCandidates: () => ['https://ssx.invalid/PositionHistory'],
  readAccountConfig: () => ({
    token: 'token', baseUrl: 'https://ssx.invalid', apiVersion: 'v3',
    requestTimeoutMs: 1000, pollWindowMinutes: 15, settings: {},
  }),
  extractResponseItems: () => state.items,
  ssxPost: vi.fn(async () => ({
    ...state.provider, parsed: {}, text: '', durationMs: 1,
  })),
  logIntegration: vi.fn().mockResolvedValue(undefined),
  logSsxCall: vi.fn(),
  getTenantRole: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    state.clientCalls++;
    return {
      auth: { getUser: vi.fn() },
      rpc: async (name: string, args: RpcArgs) => {
        state.rpcCalls.push({ name, args });
        const positions = args._positions ?? [];
        if (name === 'record_ssx_poll_error_v1') return {
          data: {
            version: 1,
            tenant_id: args._tenant_id,
            integration_account_id: args._integration_account_id,
            provider_unit_id: args._provider_unit_id,
            tracker_link_id: args._tracker_link_id,
            vehicle_id: args._vehicle_id,
          },
          error: null,
        };
        if (name === 'record_ssx_account_cooldown_v1') return {
          data: {
            version: 1,
            tenant_id: args._tenant_id,
            integration_account_id: args._integration_account_id,
            cooldown_until: args._cooldown_until,
          },
          error: null,
        };
        if (state.invalidReceipt) return { data: { version: 99 }, error: null };
        if (state.partialReceipt) return {
          data: {
            version: 1,
            tenant_id: args._tenant_id,
            integration_account_id: args._integration_account_id,
            provider_unit_id: args._provider_unit_id,
            tracker_link_id: args._tracker_link_id,
            vehicle_id: args._vehicle_id,
            attempted: positions.length,
            inserted: 0,
            duplicates: 0,
            latest_applied: false,
          },
          error: null,
        };
        return {
          data: {
            version: 1,
            tenant_id: args._tenant_id,
            integration_account_id: args._integration_account_id,
            provider_unit_id: args._provider_unit_id,
            tracker_link_id: args._tracker_link_id,
            vehicle_id: args._vehicle_id,
            attempted: positions.length,
            inserted: positions.length,
            duplicates: 0,
            latest_applied: positions.length > 0,
          },
          error: null,
        };
      },
      from: (table: string) => {
        const filters: Array<(row: Record<string, unknown>) => boolean> = [];
        let single = false;
        const builder = {
          select: () => builder,
          eq: (key: string, value: unknown) => {
            filters.push((row) => row[key] === value);
            return builder;
          },
          in: (key: string, values: unknown[]) => {
            filters.push((row) => values.includes(row[key]));
            return builder;
          },
          single: () => { single = true; return builder; },
          update: () => { state.writes.push(table + ':update'); return builder; },
          upsert: () => { state.writes.push(table + ':upsert'); return builder; },
          delete: () => { state.writes.push(table + ':delete'); return builder; },
          then: (resolve: (value: unknown) => unknown) => {
            const rows = (tables[table] || []).filter((row) => filters.every((filter) => filter(row)));
            return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve);
          },
        };
        return builder;
      },
    };
  },
}));

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: (name: string) => ({
      SUPABASE_URL: 'https://db.invalid',
      SUPABASE_ANON_KEY: 'anon',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
    } as Record<string, string>)[name] },
    serve: (handler: typeof state.handler) => { state.handler = handler; },
  });
  await import('../../supabase/functions/ssx-poll-positions/index.ts');
});
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
  state.provider = { ok: true, status: 200, errorClass: undefined };
  state.items = [];
  state.rpcCalls = [];
  state.writes = [];
  state.invalidReceipt = false;
  state.partialReceipt = false;
  state.clientCalls = 0;
  tables.provider_units.splice(1);
  tables.vehicle_tracker_links.splice(1);
  Object.assign(tables.vehicle_tracker_links[0], {
    id: linkId,
    start_at: '2020-01-01T00:00:00.000Z',
    end_at: null,
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

const request = (body: string | Record<string, unknown>, method = 'POST') => {
  if (!state.handler) throw new Error('SSX handler not loaded');
  return state.handler(new Request('https://edge.invalid', {
    method,
    ...(method === 'POST' ? {
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    } : {}),
  }));
};

describe('SSX poll handler atomic persistence contract', () => {
  it('rejects unsupported methods and malformed JSON before database or provider use', async () => {
    expect((await request({}, 'GET')).status).toBe(405);
    expect((await request('{invalid')).status).toBe(400);
    expect(state.clientCalls).toBe(0);
    expect(state.rpcCalls).toHaveLength(0);
  });

  it('sends an observed position only through the service-only atomic RPC', async () => {
    const capturedAt = new Date(Date.now() - 60_000).toISOString();
    state.items = [{
      Latitude: -23.55, Longitude: -46.63, Speed: 44,
      EventDate: capturedAt, IdTrackedUnit: '123',
    }];
    const response = await request({ integration_account_id: accountId });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true, total_inserted: 1, touched_vehicles: 1,
    });
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0]).toMatchObject({
      name: 'commit_ssx_position_batch_v1',
      args: {
        _tenant_id: tenant,
        _integration_account_id: accountId,
        _provider_unit_id: unitId,
        _tracker_link_id: linkId,
        _vehicle_id: vehicleId,
      },
    });
    expect(state.rpcCalls[0].args._positions).toMatchObject([{
      captured_at: capturedAt, lat: -23.55, lng: -46.63, speed: 44,
    }]);
    expect(state.writes).toEqual([]);
  });

  it('commits an empty poll without fabricating a stopped position', async () => {
    const response = await request({ integration_account_id: accountId });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true, vehicles_without_observation: 1,
      results: [{ status: 'no_data', positions_found: false }],
    });
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].args._positions).toEqual([]);
    expect(state.rpcCalls[0].args._poll_memo).toMatchObject({
      combo_source: 'broadband_no_observation',
    });
    expect(state.writes).toEqual([]);
  });

  it.each([
    { label: 'without an identifier', identifier: undefined },
    { label: 'matching more than one unit', identifier: '123' },
  ])('never assigns a broadband point $label to an arbitrary vehicle', async ({ identifier }) => {
    tables.provider_units.push({
      id: otherUnitId, tenant_id: tenant, integration_account_id: accountId,
      external_code: 'UNIT-QA-2', active: true,
      metadata: { id_tracked_unit: identifier === undefined ? '456' : '123' },
    });
    tables.vehicle_tracker_links.push({
      id: otherLinkId, tenant_id: tenant, provider_unit_id: otherUnitId,
      vehicle_id: otherVehicleId, active: true,
      start_at: '2020-01-01T00:00:00.000Z', end_at: null,
    });
    state.items = [{
      Latitude: -23.55, Longitude: -46.63,
      EventDate: new Date(Date.now() - 60_000).toISOString(),
      ...(identifier === undefined ? {} : { IdTrackedUnit: identifier }),
    }];
    const response = await request({ integration_account_id: accountId });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      total_inserted: 0,
      unmatched_positions: 1,
      ambiguous_positions: identifier === undefined ? 0 : 1,
      vehicles_without_observation: 2,
    });
    expect(state.rpcCalls).toHaveLength(2);
    expect(state.rpcCalls.every((call) => call.args._positions?.length === 0)).toBe(true);
  });

  it('rejects a unique broadband near-match instead of using substring identity', async () => {
    state.items = [{
      Latitude: -23.55, Longitude: -46.63,
      EventDate: new Date(Date.now() - 60_000).toISOString(),
      IdTrackedUnit: '1234',
    }];
    const response = await request({ integration_account_id: accountId });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      total_inserted: 0,
      unmatched_positions: 1,
      vehicles_without_observation: 1,
    });
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].args._positions).toEqual([]);
  });

  it('fails closed on an invalid database receipt', async () => {
    state.invalidReceipt = true;
    state.items = [{
      Latitude: -23.55, Longitude: -46.63,
      EventDate: new Date(Date.now() - 60_000).toISOString(),
      IdTrackedUnit: '123',
    }];
    const response = await request({ integration_account_id: accountId });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      success: false, batch_aborted: true, abort_reason: 'persistence_failure',
    });
  });

  it('fails closed when a receipt does not account for every attempted row', async () => {
    state.partialReceipt = true;
    state.items = [{
      Latitude: -23.55, Longitude: -46.63,
      EventDate: new Date(Date.now() - 60_000).toISOString(),
      IdTrackedUnit: '123',
    }];
    const response = await request({ integration_account_id: accountId });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      success: false, batch_aborted: true, abort_reason: 'persistence_failure',
    });
  });

  it('returns upstream and rate-limit failures with non-success HTTP status', async () => {
    state.provider = { ok: false, status: 503, errorClass: 'server_error' };
    expect((await request({ integration_account_id: accountId })).status).toBe(502);
    expect(state.rpcCalls.map((call) => call.name)).toEqual(['record_ssx_poll_error_v1']);
    expect(state.rpcCalls[0].args._poll_memo).toMatchObject({ cleared: true });
    state.provider = { ok: false, status: 429, errorClass: 'rate_limited' };
    expect((await request({ integration_account_id: accountId })).status).toBe(429);
    expect(state.rpcCalls.slice(1).map((call) => call.name)).toEqual([
      'record_ssx_poll_error_v1', 'record_ssx_account_cooldown_v1',
    ]);
    expect(state.writes).toHaveLength(0);
  });

  it('uses canonical SHA-256 hashes so known weak-hash collisions stay distinct', async () => {
    const capturedAt = new Date(Date.now() - 60_000).toISOString();
    state.items = [
      { Latitude: -23.55, Longitude: -46.63, EventDate: capturedAt, IdTrackedUnit: '123', note: 'AzA' },
      { Latitude: -23.55, Longitude: -46.63, EventDate: capturedAt, IdTrackedUnit: '123', note: 'BZ`' },
    ];
    expect((await request({ integration_account_id: accountId })).status).toBe(200);
    const rows = state.rpcCalls[0].args._positions!;
    expect(rows[0].provider_payload_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[1].provider_payload_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0].provider_payload_hash).not.toBe(rows[1].provider_payload_hash);
  });

  it('keeps the SHA-256 payload hash stable across telemetry key order', async () => {
    const capturedAt = new Date(Date.now() - 60_000).toISOString();
    state.items = [
      { Latitude: -23.55, Longitude: -46.63, EventDate: capturedAt, IdTrackedUnit: '123', a: 1, b: 2 },
      { b: 2, a: 1, IdTrackedUnit: '123', EventDate: capturedAt, Longitude: -46.63, Latitude: -23.55 },
    ];
    expect((await request({ integration_account_id: accountId })).status).toBe(200);
    const rows = state.rpcCalls[0].args._positions!;
    expect(rows[0].provider_payload_hash).toBe(rows[1].provider_payload_hash);
  });

  it('versions the canonical payload hash by tracker link across a remap', async () => {
    const capturedAt = new Date(Date.now() - 60_000).toISOString();
    state.items = [{
      Latitude: -23.55, Longitude: -46.63,
      EventDate: capturedAt, IdTrackedUnit: '123',
    }];
    expect((await request({ integration_account_id: accountId })).status).toBe(200);
    const oldHash = state.rpcCalls[0].args._positions![0].provider_payload_hash;
    tables.vehicle_tracker_links[0].id = otherLinkId;
    expect((await request({ integration_account_id: accountId })).status).toBe(200);
    const newHash = state.rpcCalls[1].args._positions![0].provider_payload_hash;
    expect(newHash).not.toBe(oldHash);
  });

  it('drops pre-binding broadband history before the atomic commit', async () => {
    tables.vehicle_tracker_links[0].start_at = new Date().toISOString();
    state.items = [{
      Latitude: -23.55, Longitude: -46.63,
      EventDate: new Date(Date.now() - 60_000).toISOString(),
      IdTrackedUnit: '123',
    }];
    const response = await request({ integration_account_id: accountId });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      total_inserted: 0,
      outside_binding_window: 1,
      vehicles_without_observation: 1,
    });
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].args._positions).toEqual([]);
  });

  it('drops a far-future provider point without aborting valid positions in the batch', async () => {
    state.items = [
      {
        Latitude: -23.55, Longitude: -46.63,
        EventDate: new Date(Date.now() - 60_000).toISOString(),
        IdTrackedUnit: '123',
      },
      {
        Latitude: -23.56, Longitude: -46.64,
        EventDate: '2099-01-01T00:00:00.000Z',
        IdTrackedUnit: '123',
      },
    ];
    const response = await request({ integration_account_id: accountId });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total_inserted: 1 });
    expect(state.rpcCalls).toHaveLength(1);
    expect(state.rpcCalls[0].args._positions).toHaveLength(1);
  });
});
