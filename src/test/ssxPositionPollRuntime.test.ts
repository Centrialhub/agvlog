// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accountId, linkId, otherLinkId, otherUnitId, otherVehicleId, tables, tenant, unitId, vehicleId,
  type RpcArgs,
} from './helpers/ssxPositionPollRuntimeFixture';

const state = vi.hoisted(() => ({
  handler: null as null | ((request: Request) => Promise<Response>),
  provider: { ok: true, status: 200, errorClass: undefined as string | undefined },
  items: [] as Record<string, unknown>[],
  itemBatches: [] as Record<string, unknown>[][],
  rpcCalls: [] as Array<{ name: string; args: RpcArgs }>,
  writes: [] as string[],
  invalidReceipt: false,
  partialReceipt: false,
  clientCalls: 0,
}));


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
  extractResponseItems: (parsed: unknown) => Array.isArray(parsed) ? parsed : [],
  ssxPost: vi.fn(async () => ({
    ...state.provider,
    parsed: state.itemBatches.length > 0 ? state.itemBatches.shift() : state.items,
    text: '', durationMs: 1,
  })),
  logIntegration: vi.fn().mockResolvedValue(undefined),
  logSsxCall: vi.fn(),
  redactedSsxResponsePreview: vi.fn(() => ''),
  getTenantRole: vi.fn(),
  getWorkspaceRoleForAccount: vi.fn(),
  requireWorkspaceAccountContext: vi.fn().mockResolvedValue(null),
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
        if (name === 'record_ssx_position_quarantine_batch_v1') {
          const records = Array.isArray(args._records) ? args._records : [];
          return {
            data: {
              version: 1,
              tenant_id: args._tenant_id,
              integration_account_id: args._integration_account_id,
              attempted: records.length,
              recorded: records.length,
            },
            error: null,
          };
        }
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
  state.itemBatches = [];
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
    const positionCommits = state.rpcCalls.filter((call) => call.name === 'commit_ssx_position_batch_v1');
    expect(positionCommits).toHaveLength(2);
    expect(positionCommits.every((call) => call.args._positions?.length === 0)).toBe(true);
    expect(state.rpcCalls[0].name).toBe('record_ssx_position_quarantine_batch_v1');
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
    expect(state.rpcCalls.map((call) => call.name)).toEqual([
      'record_ssx_position_quarantine_batch_v1', 'commit_ssx_position_batch_v1',
    ]);
    expect(state.rpcCalls[1].args._positions).toEqual([]);
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
    expect(state.rpcCalls.map((call) => call.name)).toEqual([
      'record_ssx_position_quarantine_batch_v1', 'commit_ssx_position_batch_v1',
    ]);
    expect(state.rpcCalls[1].args._positions).toEqual([]);
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
    expect(state.rpcCalls.map((call) => call.name)).toEqual([
      'record_ssx_position_quarantine_batch_v1', 'commit_ssx_position_batch_v1',
    ]);
    expect(state.rpcCalls[1].args._positions).toHaveLength(1);
  });

  it('quarantines ValidGPS=false and never promotes it to the current position', async () => {
    state.items = [{
      IdPosition: '9001', IdTrackedUnit: '123', IdTrackedUnitType: 1,
      Latitude: -23.55, Longitude: -46.63,
      EventDate: new Date(Date.now() - 60_000).toISOString(),
      ValidGPS: false,
    }];
    const response = await request({ integration_account_id: accountId });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      total_inserted: 0, quarantined_positions: 1,
      vehicles_without_observation: 1,
    });
    expect(state.rpcCalls.map((call) => call.name)).toEqual([
      'record_ssx_position_quarantine_batch_v1', 'commit_ssx_position_batch_v1',
    ]);
    expect(state.rpcCalls[0].args._records).toMatchObject([{
      reason: 'invalid_gps',
      provider_position_id: '9001',
      payload: { IdPosition: '9001', ValidGPS: false },
    }]);
    expect(state.rpcCalls[1].args._positions).toEqual([]);
  });

  it('blocks a saturated 500-item response instead of acknowledging it as complete', async () => {
    const capturedAt = new Date(Date.now() - 60_000).toISOString();
    state.items = Array.from({ length: 500 }, (_, index) => ({
      IdPosition: String(index + 1), IdTrackedUnit: '123', IdTrackedUnitType: 1,
      Latitude: -23.55, Longitude: -46.63, EventDate: capturedAt, ValidGPS: true,
    }));
    const response = await request({ integration_account_id: accountId });
    expect(response.status).toBe(409);
    const result = await response.json();
    expect(result).toMatchObject({
      success: false,
      batch_aborted: true,
      abort_reason: 'saturated_response',
      saturation_blocked: true,
      total_inserted: 0,
    });
    expect(result.requests).toBeGreaterThan(1);
    expect(result.requests).toBeLessThanOrEqual(32);
    expect(state.rpcCalls.map((call) => call.name)).toEqual(['record_ssx_poll_error_v1']);
  });

  it('subdivides a saturated window and commits only after both halves prove complete', async () => {
    const capturedAt = new Date(Date.now() - 60_000).toISOString();
    const positions = Array.from({ length: 500 }, (_, index) => ({
      IdPosition: String(index + 1), IdTrackedUnit: '123', IdTrackedUnitType: 1,
      Latitude: -23.55, Longitude: -46.63, EventDate: capturedAt, ValidGPS: true,
    }));
    state.itemBatches = [positions, positions.slice(0, 200), positions.slice(200)];
    const response = await request({ integration_account_id: accountId });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      total_positions_received: 500,
      total_inserted: 500,
      touched_vehicles: 1,
    });
    const commits = state.rpcCalls.filter((call) => call.name === 'commit_ssx_position_batch_v1');
    expect(commits).toHaveLength(1);
    expect(commits[0].args._positions).toHaveLength(500);
  });
});
