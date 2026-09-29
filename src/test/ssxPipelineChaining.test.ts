// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (request: Request) => Promise<Response>;
type Row = Record<string, unknown>;

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_JWT = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhY3RvciIsImFjdGl2ZV90ZW5hbnRfaWQiOiIxMTExMTExMS0xMTExLTQxMTEtODExMS0xMTExMTExMTExMTEifQ.test';

const state = vi.hoisted(() => ({
  handler: null as Handler | null,
  cron: false,
  capabilityDisabled: false,
  role: 'owner',
  clientCreations: 0,
  healthWrites: [] as Row[],
  checkpointClaims: [] as Row[],
  checkpointFinishes: [] as Row[],
  checkpointDecisions: {} as Record<string, 'claimed' | 'cached' | 'deferred'>,
  checkpointResults: {} as Record<string, Row>,
  nestedCalls: [] as Array<{ name: string; headers: Headers; body: Row }>,
  unitResponse: { status: 200, body: {
    success: true, source_mode: 'tracking_discovery', vehicles_received: 1,
    normalized_count: 1, skipped_non_vehicle: 0, skipped_missing_stable_code: 0, upserted: 1,
  } } as { status: number; body: Row },
  pollResponse: {
    success: true, total_units: 1, total_inserted: 1, touched_vehicles: 1,
  } as Row,
  liveStatusResponse: { ok: true, processed: 1 } as Row,
  liveStatusHttpStatus: 200,
}));

vi.mock('../../supabase/functions/_shared/cron-auth.ts', () => ({
  isCronRequest: async () => state.cron,
}));

vi.mock('../../supabase/functions/_shared/capabilities.ts', () => ({
  requireIntegrationCapability: async () => state.capabilityDisabled
    ? new Response(JSON.stringify({ success: false, code: 'INTEGRATION_DISABLED' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
    : null,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    state.clientCreations++;
    return {
      auth: {
        getUser: async () => ({ data: { user: { id: 'actor' } }, error: null }),
      },
      from: (table: string) => query(table),
      rpc: async (name: string, args: Row) => {
        if (name === 'claim_ssx_sync_checkpoint_v1') {
          state.checkpointClaims.push(args);
          const resource = String(args._resource);
          const decision = state.checkpointDecisions[resource] || 'claimed';
          if (decision === 'deferred') {
            return { data: { decision, error_code: 'rate_limited', retry_after_seconds: 300 }, error: null };
          }
          if (decision === 'cached') {
            return { data: { decision, result: state.checkpointResults[resource] }, error: null };
          }
          return { data: { decision, lease_token: 'test-lease' }, error: null };
        }
        if (name === 'finish_ssx_sync_checkpoint_v1') {
          state.checkpointFinishes.push(args);
          return { data: true, error: null };
        }
        if (name !== 'merge_tenant_pipeline_health_v1') throw new Error(`Unexpected RPC: ${name}`);
        state.healthWrites.push(args._patch as Row);
        return { data: args._patch, error: null };
      },
    };
  },
}));

function tableRows(table: string): Row[] {
  if (table === 'tenant_memberships') {
    return [{ tenant_id: TENANT_ID, user_id: 'actor', active: true, role: state.role }];
  }
  if (table === 'integration_accounts') {
    return [{
      id: 'account', tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, status: 'active',
      token_expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      settings: {}, last_error: null,
    }];
  }
  if (table === 'workspace_ssx_accounts') {
    return [{ workspace_id: WORKSPACE_ID, integration_account_id: 'account', migration_state: 'ready' }];
  }
  if (table === 'positions_last') return [{ tenant_id: TENANT_ID, vehicle_id: 'vehicle' }];
  if (table === 'tenants') return [{ id: TENANT_ID, workspace_id: WORKSPACE_ID, settings: {} }];
  return [];
}

function query(table: string) {
  const filters: Array<[string, unknown]> = [];
  let single = false;
  let update: Row | null = null;
  const builder = {
    select: (_columns?: string) => builder,
    eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
    limit: (_limit: number) => builder,
    single: () => { single = true; return builder; },
    maybeSingle: () => { single = true; return builder; },
    update: (value: Row) => {
      update = value;
      if (table === 'tenants') state.healthWrites.push(value);
      return builder;
    },
    then: (
      resolve: (value: { data: Row | Row[] | null; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => {
      const rows = tableRows(table).filter(row => filters.every(([key, value]) => row[key] === value));
      const data = update ? null : single ? rows[0] || null : rows;
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

function nestedResponse(name: string): { status: number; body: Row } {
  if (name === 'ssx-sync-telemetry') {
    return { status: 200, body: { success: true, catalogs: { telemetry: 2 } } };
  }
  if (name === 'ssx-sync-units') return state.unitResponse;
  if (name === 'ssx-sync-governance') {
    return { status: 200, body: { success: true, snapshots: { logged_rule: 2 } } };
  }
  if (name === 'ssx-poll-positions') return { status: 200, body: state.pollResponse };
  if (name === 'ssx-sync-rule-violations') {
    return { status: 200, body: { success: true, upserted: 1, cursor_advanced: true } };
  }
  if (name === 'agvlog-compute-state') {
    return { status: 200, body: { success: true, processed: 1, events_emitted: 0 } };
  }
  if (name === 'agvlog-aggregate-daily') {
    return { status: 200, body: { success: true, aggregated: 1 } };
  }
  if (name === 'agvlog-run-queue') return { status: 200, body: { success: true, processed: 1 } };
  if (name === 'update-trip-live-status') {
    return { status: state.liveStatusHttpStatus, body: state.liveStatusResponse };
  }
  throw new Error(`Unexpected nested Edge Function: ${name}`);
}

function request(options: { method?: string; cron?: boolean; mode?: 'poll' | 'full' } = {}) {
  if (!state.handler) throw new Error('Pipeline handler was not loaded');
  state.cron = options.cron ?? false;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (state.cron) headers['x-agvlog-cron-secret'] = 'vault-backed-test-secret';
  else {
    headers.Authorization = `Bearer ${ACTOR_JWT}`;
    headers['x-agvlog-tenant-id'] = TENANT_ID;
  }
  const method = options.method ?? 'POST';
  return state.handler(new Request('https://edge.example.test', {
    method,
    headers,
    ...(method === 'POST' ? {
      body: JSON.stringify({ tenant_id: TENANT_ID, pipeline_mode: options.mode || 'poll' }),
    } : {}),
  }));
}

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: (key: string) => ({
      SUPABASE_URL: 'https://db.example.test',
      SUPABASE_ANON_KEY: 'anon-test',
      SUPABASE_SERVICE_ROLE_KEY: 'service-test',
    } as Record<string, string>)[key] },
    serve: (handler: Handler) => { state.handler = handler; },
  });
  const pipelinePath = '../../supabase/functions/agvlog-pipeline-run/index.ts';
  await import(pipelinePath);
});

beforeEach(() => {
  state.cron = false;
  state.capabilityDisabled = false;
  state.role = 'owner';
  state.clientCreations = 0;
  state.healthWrites = [];
  state.checkpointClaims = [];
  state.checkpointFinishes = [];
  state.checkpointDecisions = {};
  state.checkpointResults = {};
  state.nestedCalls = [];
  state.unitResponse = { status: 200, body: {
    success: true, source_mode: 'tracking_discovery', vehicles_received: 1,
    normalized_count: 1, skipped_non_vehicle: 0, skipped_missing_stable_code: 0, upserted: 1,
  } };
  state.pollResponse = {
    success: true, total_units: 1, total_inserted: 1, touched_vehicles: 1,
  };
  state.liveStatusResponse = { ok: true, processed: 1 };
  state.liveStatusHttpStatus = 200;
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const name = new URL(url).pathname.split('/').pop()!;
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body || '{}')) as Row;
    state.nestedCalls.push({ name, headers, body });
    const response = nestedResponse(name);
    return new Response(JSON.stringify(response.body), {
      status: response.status, headers: { 'Content-Type': 'application/json' },
    });
  }));
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SSX pipeline post-ingestion chaining', () => {
  it('forwards the original actor JWT and refreshes trip state after committed telemetry', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      total_inserted: 1,
      touched_vehicles: 1,
      trip_live_status_updated: 1,
      rule_violations: 1,
      trip_live_status_deferred_reason: null,
      steps_executed: ['position_polling', 'rule_violations', 'compute_state', 'queue_processing', 'trip_live_status'],
    });
    expect(state.nestedCalls.map(call => call.name)).toEqual([
      'ssx-poll-positions', 'ssx-sync-rule-violations', 'agvlog-compute-state',
      'agvlog-run-queue', 'update-trip-live-status',
    ]);
    const liveStatus = state.nestedCalls.at(-1)!;
    expect(liveStatus.headers.get('Authorization')).toBe(`Bearer ${ACTOR_JWT}`);
    expect(liveStatus.headers.has('x-agvlog-cron-secret')).toBe(false);
    expect(liveStatus.body).toEqual({ tenant_id: TENANT_ID });
    expect(state.healthWrites.at(-1)).toMatchObject({
      last_run_touched_vehicles: 1,
      last_run_trip_live_status_updated: 1,
      last_run_trip_live_status_deferred_reason: null,
    });
  });

  it('never impersonates a user during cron and exposes the required service-only follow-up', async () => {
    const response = await request({ cron: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      touched_vehicles: 1,
      trip_live_status_updated: 0,
      trip_live_status_deferred_reason: 'cron_requires_actor_jwt',
    });
    expect(state.nestedCalls.map(call => call.name)).not.toContain('update-trip-live-status');
    for (const call of state.nestedCalls) {
      expect(call.headers.get('Authorization')).toBe('Bearer anon-test');
      expect(call.headers.get('x-agvlog-cron-secret')).toBe('vault-backed-test-secret');
    }
    expect(state.healthWrites.at(-1)).toMatchObject({
      last_run_trip_live_status_deferred_reason: 'cron_requires_actor_jwt',
    });
  });

  it('refreshes units before governance during a full synchronization', async () => {
    const response = await request({ mode: 'full' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      reference_catalogs: 2,
      synced_units: 1,
      governance_snapshots: 2,
      rule_violations: 1,
    });
    expect(state.nestedCalls.map(call => call.name)).toEqual([
      'ssx-sync-telemetry', 'ssx-sync-units', 'ssx-sync-governance',
      'ssx-poll-positions', 'ssx-sync-rule-violations', 'agvlog-compute-state',
      'agvlog-run-queue', 'update-trip-live-status', 'agvlog-aggregate-daily',
      'agvlog-compute-state',
    ]);
    expect(state.checkpointClaims.map(claim => claim._resource)).toEqual([
      'pipeline_reference_catalogs', 'pipeline_units',
    ]);
  });

  it('accepts a valid cached zero-unit result and still runs governance', async () => {
    state.checkpointDecisions.pipeline_units = 'cached';
    state.checkpointResults.pipeline_units = {
      upserted: 0, source_mode: 'tracking_discovery', vehicles_received: 0,
      normalized_count: 0, skipped_non_vehicle: 0, skipped_missing_stable_code: 0,
    };
    const response = await request({ mode: 'full' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, synced_units: 0, governance_snapshots: 2 });
    expect(state.nestedCalls.map(call => call.name)).not.toContain('ssx-sync-units');
    expect(state.nestedCalls.map(call => call.name)).toContain('ssx-sync-governance');
  });

  it('accepts a genuinely empty tracking source and checkpoints its evidence', async () => {
    state.unitResponse = { status: 200, body: {
      success: true, source_mode: 'tracking_discovery', vehicles_received: 0,
      normalized_count: 0, skipped_non_vehicle: 0, skipped_missing_stable_code: 0, upserted: 0,
    } };
    const response = await request({ mode: 'full' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, synced_units: 0, governance_snapshots: 2 });
    expect(state.checkpointFinishes.find(call => call._resource === 'pipeline_units')).toMatchObject({
      _error_code: null,
      _result: { vehicles_received: 0, normalized_count: 0, skipped_missing_stable_code: 0, upserted: 0 },
    });
  });

  it('fails a tracking discovery with only missing stable identities before checkpoint success or governance', async () => {
    state.unitResponse = { status: 200, body: {
      success: true, source_mode: 'tracking_discovery', vehicles_received: 3,
      normalized_count: 0, skipped_non_vehicle: 0, skipped_missing_stable_code: 3, upserted: 0,
    } };
    const response = await request({ mode: 'full' });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ errors: [expect.stringContaining('missing_stable_identity')] });
    expect(state.nestedCalls.map(call => call.name)).not.toContain('ssx-sync-governance');
    const finishes = state.checkpointFinishes.filter(call => call._resource === 'pipeline_units');
    expect(finishes).toHaveLength(1);
    expect(finishes[0]).toMatchObject({ _error_code: 'missing_stable_identity', _result: {} });
  });

  it('rejects noninteger discovery evidence before checkpoint success or governance', async () => {
    state.unitResponse = { status: 200, body: {
      success: true, source_mode: 'tracking_discovery', vehicles_received: 1.5,
      normalized_count: 0, skipped_non_vehicle: 0, skipped_missing_stable_code: 0, upserted: 0,
    } };
    const response = await request({ mode: 'full' });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ errors: [expect.stringContaining('unconfirmed_result')] });
    expect(state.nestedCalls.map(call => call.name)).not.toContain('ssx-sync-governance');
    expect(state.checkpointFinishes.find(call => call._resource === 'pipeline_units'))
      .toMatchObject({ _error_code: 'unconfirmed_result', _result: {} });
  });

  it('keeps the run failed and skips governance after a partial unit-sync 409', async () => {
    state.unitResponse = { status: 409, body: { error: 'Unit synchronization conflict' } };
    const response = await request({ mode: 'full' });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      success: false,
      errors: [expect.stringContaining('SyncUnits')],
    });
    expect(state.nestedCalls.map(call => call.name)).toContain('ssx-sync-units');
    expect(state.nestedCalls.map(call => call.name)).not.toContain('ssx-sync-governance');
  });

  it('skips governance when the unit checkpoint is deferred', async () => {
    state.checkpointDecisions.pipeline_units = 'deferred';
    const response = await request({ mode: 'full' });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ errors: [expect.stringContaining('rate_limited')] });
    expect(state.nestedCalls.map(call => call.name)).not.toContain('ssx-sync-units');
    expect(state.nestedCalls.map(call => call.name)).not.toContain('ssx-sync-governance');
  });

  it('rejects an empty cached unit result before governance', async () => {
    state.checkpointDecisions.pipeline_units = 'cached';
    state.checkpointResults.pipeline_units = {};
    const response = await request({ mode: 'full' });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ errors: [expect.stringContaining('unconfirmed_result')] });
    expect(state.nestedCalls.map(call => call.name)).not.toContain('ssx-sync-units');
    expect(state.nestedCalls.map(call => call.name)).not.toContain('ssx-sync-governance');
  });

  it('rejects a legacy cached zero without source evidence but preserves a positive legacy cache', async () => {
    state.checkpointDecisions.pipeline_units = 'cached';
    state.checkpointResults.pipeline_units = { upserted: 0 };
    const rejected = await request({ mode: 'full' });
    expect(rejected.status).toBe(502);
    expect(await rejected.json()).toMatchObject({ errors: [expect.stringContaining('unconfirmed_result')] });
    expect(state.nestedCalls.map(call => call.name)).not.toContain('ssx-sync-governance');

    state.nestedCalls = [];
    state.checkpointResults.pipeline_units = { upserted: 1 };
    const accepted = await request({ mode: 'full' });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ success: true, synced_units: 1 });
    expect(state.nestedCalls.map(call => call.name)).toContain('ssx-sync-governance');
  });

  it('rejects a success response without a confirmed unit count', async () => {
    state.unitResponse = { status: 200, body: { success: true } };
    const response = await request({ mode: 'full' });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ errors: [expect.stringContaining('unconfirmed_result')] });
    expect(state.nestedCalls.map(call => call.name)).not.toContain('ssx-sync-governance');
  });

  it('does not treat a skipped upstream sync without counters as a confirmed catalog', async () => {
    state.unitResponse = { status: 200, body: {
      success: true, skipped: true, last_sync_at: '2026-09-26T20:00:00Z',
    } };
    const response = await request({ mode: 'full' });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ errors: [expect.stringContaining('unconfirmed_result')] });
    expect(state.nestedCalls.map(call => call.name)).not.toContain('ssx-sync-governance');
    expect(state.checkpointFinishes.find(call => call._resource === 'pipeline_units'))
      .toMatchObject({ _error_code: 'unconfirmed_result', _result: {} });
  });

  it('does not refresh trip state after a persistence failure', async () => {
    state.pollResponse = {
      success: false, batch_aborted: true, abort_reason: 'persistence_failure',
      total_units: 1, total_inserted: 0, touched_vehicles: 1,
    };
    const response = await request();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      success: false, trip_live_status_updated: 0, trip_live_status_deferred_reason: null,
    });
    expect(state.nestedCalls.map(call => call.name)).toEqual(['ssx-poll-positions']);
  });

  it('reports an unconfirmed JWT-only refresh instead of claiming success', async () => {
    state.liveStatusHttpStatus = 403;
    state.liveStatusResponse = { error: 'Forbidden' };
    const response = await request();
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      success: false,
      trip_live_status_updated: 0,
      errors: [expect.stringContaining('TripLiveStatus: update-trip-live-status: Forbidden')],
    });
    expect(state.nestedCalls.at(-1)?.headers.get('Authorization')).toBe(`Bearer ${ACTOR_JWT}`);
  });

  it('fails closed before nested work when SSX capability is disabled', async () => {
    state.capabilityDisabled = true;
    const response = await request();
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: 'INTEGRATION_DISABLED' });
    expect(state.nestedCalls).toEqual([]);
    expect(state.healthWrites).toEqual([]);
  });

  it('rejects non-POST requests before auth, database or nested calls', async () => {
    const response = await request({ method: 'GET' });
    expect(response.status).toBe(405);
    expect(state.clientCreations).toBe(0);
    expect(state.nestedCalls).toEqual([]);
  });

  it('keeps the operational evaluator JWT-only while marking cron deferral in source', () => {
    const pipeline = readFileSync('supabase/functions/agvlog-pipeline-run/index.ts', 'utf8');
    const evaluator = readFileSync('supabase/functions/update-trip-live-status/index.ts', 'utf8');
    const config = readFileSync('supabase/config.toml', 'utf8');
    expect(pipeline).toContain('trip_live_status_deferred_reason = "cron_requires_actor_jwt"');
    expect(pipeline).toContain('"update-trip-live-status"');
    expect(evaluator).toContain('const supabase=anon;');
    expect(config).toMatch(/\[functions\.update-trip-live-status\]\s+verify_jwt = true/);
    expect(pipeline).not.toMatch(/serviceKey[^\n]+update-trip-live-status/);
  });
});
