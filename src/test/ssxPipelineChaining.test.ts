// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (request: Request) => Promise<Response>;
type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  handler: null as Handler | null,
  cron: false,
  capabilityDisabled: false,
  role: 'owner',
  clientCreations: 0,
  healthWrites: [] as Row[],
  nestedCalls: [] as Array<{ name: string; headers: Headers; body: Row }>,
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
    };
  },
}));

function tableRows(table: string): Row[] {
  if (table === 'tenant_memberships') {
    return [{ tenant_id: 'tenant', user_id: 'actor', active: true, role: state.role }];
  }
  if (table === 'integration_accounts') {
    return [{
      id: 'account', tenant_id: 'tenant', status: 'active',
      token_expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      settings: {}, last_error: null,
    }];
  }
  if (table === 'positions_last') return [{ tenant_id: 'tenant', vehicle_id: 'vehicle' }];
  if (table === 'tenants') return [{ id: 'tenant', settings: {} }];
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
  if (name === 'ssx-poll-positions') return { status: 200, body: state.pollResponse };
  if (name === 'agvlog-compute-state') {
    return { status: 200, body: { success: true, processed: 1, events_emitted: 0 } };
  }
  if (name === 'agvlog-run-queue') return { status: 200, body: { success: true, processed: 1 } };
  if (name === 'update-trip-live-status') {
    return { status: state.liveStatusHttpStatus, body: state.liveStatusResponse };
  }
  throw new Error(`Unexpected nested Edge Function: ${name}`);
}

function request(options: { method?: string; cron?: boolean } = {}) {
  if (!state.handler) throw new Error('Pipeline handler was not loaded');
  state.cron = options.cron ?? false;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (state.cron) headers['x-agvlog-cron-secret'] = 'vault-backed-test-secret';
  else headers.Authorization = 'Bearer actor-jwt';
  const method = options.method ?? 'POST';
  return state.handler(new Request('https://edge.example.test', {
    method,
    headers,
    ...(method === 'POST' ? { body: JSON.stringify({ tenant_id: 'tenant', pipeline_mode: 'poll' }) } : {}),
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
  state.nestedCalls = [];
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
      trip_live_status_deferred_reason: null,
      steps_executed: ['position_polling', 'compute_state', 'queue_processing', 'trip_live_status'],
    });
    expect(state.nestedCalls.map(call => call.name)).toEqual([
      'ssx-poll-positions', 'agvlog-compute-state', 'agvlog-run-queue', 'update-trip-live-status',
    ]);
    const liveStatus = state.nestedCalls.at(-1)!;
    expect(liveStatus.headers.get('Authorization')).toBe('Bearer actor-jwt');
    expect(liveStatus.headers.has('x-agvlog-cron-secret')).toBe(false);
    expect(liveStatus.body).toEqual({ tenant_id: 'tenant' });
    expect(state.healthWrites.at(-1)).toMatchObject({ settings: { pipeline_health: {
      last_run_touched_vehicles: 1,
      last_run_trip_live_status_updated: 1,
      last_run_trip_live_status_deferred_reason: null,
    } } });
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
    expect(state.healthWrites.at(-1)).toMatchObject({ settings: { pipeline_health: {
      last_run_trip_live_status_deferred_reason: 'cron_requires_actor_jwt',
    } } });
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
    expect(state.nestedCalls.at(-1)?.headers.get('Authorization')).toBe('Bearer actor-jwt');
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
