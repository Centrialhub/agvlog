// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountId, tables, tenant, unitId, type RpcArgs } from './helpers/ssxPositionPollRuntimeFixture';

const state = vi.hoisted(() => ({
  handler: null as null | ((request: Request) => Promise<Response>), account: {} as Record<string, unknown>,
  cursor: null as null | Record<string, unknown>, queries: [] as string[], rpc: [] as { name: string; args: RpcArgs }[],
  shortCooldown: false, providerStatus: 204, retryAfter: undefined as string | undefined, invalidReceipt: false,
  requests: [] as Record<string, unknown>[][],
}));
vi.mock('../../supabase/functions/_shared/cron-auth.ts', () => ({ isCronRequest: vi.fn().mockResolvedValue(true) }));
vi.mock('../../supabase/functions/_shared/capabilities.ts', () => ({ requireIntegrationCapability: vi.fn().mockResolvedValue(null) }));
vi.mock('../../supabase/functions/_shared/ssx-utils.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../../supabase/functions/_shared/ssx-utils.ts')>();
  return { ...actual, logIntegration: vi.fn(), logSsxCall: vi.fn() };
});
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  rpc: async (name: string, args: RpcArgs) => {
    state.rpc.push({ name, args });
    if (state.invalidReceipt) return { data: { version: 99 }, error: null };
    return { data: { version: 1, tenant_id: args._tenant_id, integration_account_id: args._integration_account_id,
      provider_unit_id: args._provider_unit_id, tracker_link_id: args._tracker_link_id, vehicle_id: args._vehicle_id,
      attempted: 0, inserted: 0, duplicates: 0, latest_applied: false, observed_at: args._observed_at,
      cleared: true, cooldown_until: state.shortCooldown && name === 'record_ssx_account_cooldown_v1'
        ? '2026-10-06T13:21:00.000Z' : args._cooldown_until }, error: null };
  },
  from: (table: string) => {
    const query = { select: () => query, eq: () => query, in: () => query, order: () => query,
      range: () => query, single: () => query,
      then: (resolve: (value: unknown) => unknown) => {
        state.queries.push(table);
        const data = table === 'integration_accounts' ? state.account : table === 'ingestion_cursors' ? state.cursor : tables[table] ?? [];
        return Promise.resolve({ data, error: null }).then(resolve);
      } };
    return query;
  },
}) }));
beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: () => undefined }, serve: (handler: typeof state.handler) => { state.handler = handler; } });
  await import('../../supabase/functions/ssx-poll-positions/index.ts');
});
afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-06T13:19:00Z');
  state.account = { id: accountId, tenant_id: tenant, provider: 'SSX', token_cache: 'QA_NOT_A_REAL_TOKEN',
    token_expires_at: '2099-01-01T00:00:00Z', settings: { api_version: 'v3', poll_window_minutes: 15,
      request_spacing_ms: 0, discovery_request_spacing_ms: 0 } };
  state.cursor = null; state.queries = []; state.rpc = []; state.requests = [];
  state.shortCooldown = false; state.providerStatus = 204; state.retryAfter = undefined; state.invalidReceipt = false;
  vi.spyOn(console, 'log').mockImplementation(() => undefined); vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
    state.requests.push(JSON.parse(String(init.body)));
    return new Response(null, { status: state.providerStatus, headers: state.retryAfter ? { 'Retry-After': state.retryAfter } : {} });
  }));
});
const request = async (body: Record<string, unknown>) => {
  if (!state.handler) throw Error('Real handler not loaded');
  return state.handler(new Request('https://edge.invalid', { method: 'POST', body: JSON.stringify({ integration_account_id: accountId, ...body }) }));
};
const cursor = (extra: Record<string, unknown> = {}) => ({ tenant_id: tenant, provider_unit_id: unitId,
  last_success_at: '2026-10-04T00:00:00Z', ...extra });
const manual = { manual_run: true, provider_unit_ids: [unitId], lookback_minutes: 5 };
describe('real SSX handler enforces polling controls without external I/O', () => {
  it.each([{ manual_run: 'false' }, { manual_run: 'true' }, { force_rediscovery: 1 }, { lookback_minutes: 0 }, { lookback_minutes: -5 }, { lookback_minutes: '5' }])('rejects malformed option %j before database/provider', async body => {
    expect((await request(body)).status).toBe(400); expect(state.queries).toEqual([]); expect(state.requests).toEqual([]);
  });
  it.each([false, true])('account cooldown blocks manual=%s before querying units', async manual_run => {
    state.account.poll_cooldown_until = '2026-10-06T13:21:00Z';
    state.account.settings = { ...state.account.settings as Record<string, unknown>, poll_cooldown_until: '2026-10-06T13:29:00Z' };
    const response = await request({ manual_run });
    expect(response.status).toBe(429); expect(await response.json()).toMatchObject({ retry_after_seconds: 600 });
    expect(state.queries).toEqual(['integration_accounts']); expect(state.requests).toEqual([]); expect(state.rpc).toEqual([]);
  });
  it('false JSON boolean preserves broadband route and expired cooldown permits polling', async () => {
    state.account.poll_cooldown_until = '2026-10-06T13:18:00Z';
    const response = await request({ manual_run: false, lookback_minutes: 5 });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ mode: 'broadband' });
    expect(state.requests).toHaveLength(1); expect(state.queries).not.toContain('ingestion_cursors');
  });
  it.each([false, true])('unit backoff blocks manual=%s in selected-unit route', async manual_run => {
    state.cursor = cursor({ backoff_until: '2026-10-06T13:29:00Z' });
    const response = await request({ ...manual, manual_run });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ results: [{ status: 'skipped', reason: 'In backoff period' }] });
    expect(state.requests).toEqual([]); expect(state.rpc).toEqual([]);
  });
  it.each([true, false])('manual stale cursor and rediscovery=%s honor five-minute lower/upper filters', async force_rediscovery => {
    state.cursor = cursor();
    await request({ ...manual, force_rediscovery });
    expect(state.requests.length).toBeGreaterThan(0);
    for (const body of state.requests) {
      expect(body.find(filter => filter.Condition === '>=' )?.Value).toBe('2026-10-06T13:14:00.000Z');
      expect(body.find(filter => filter.Condition === '<' )?.Value).toBe('2026-10-06T13:19:00.000Z');
    }
  });
  it('first manual poll preserves explicit 30 days and binding start clamp', async () => {
    await request({ ...manual, force_rediscovery: true, lookback_minutes: 43200 });
    expect(state.requests[0]).toEqual(expect.arrayContaining([{ PropertyName: 'EventDate', Condition: '>=', Value: '2026-09-06T13:19:00.000Z' }]));
  });
  it.each([{}, manual])('real ssxPost 429 Retry-After reaches account and unit RPCs for %j', async body => {
    state.providerStatus = 429; state.retryAfter = '600'; state.cursor = cursor();
    const response = await request(body);
    expect(response.status).toBe(429); expect(await response.json()).toMatchObject({ abort_reason: 'rate_limited', retry_after_seconds: 600 });
    expect(state.requests).toHaveLength(1);
    expect(state.rpc.find(call => call.name === 'record_ssx_account_cooldown_v1')?.args._cooldown_until).toBe('2026-10-06T13:29:00.000Z');
    expect(state.rpc.find(call => call.name === 'record_ssx_poll_error_v1')?.args._backoff_until).toBe('2026-10-06T13:29:00.000Z');
    expect(state.rpc.some(call => call.name === 'commit_ssx_position_batch_v1' || call.name === 'clear_ssx_account_cooldown_v1')).toBe(false);
  });
  it('HTTP-date Retry-After retains ten-minute cooldown through real ssxPost', async () => {
    state.providerStatus = 429; state.retryAfter = 'Tue, 06 Oct 2026 13:29:00 GMT';
    const response = await request({});
    expect(response.status).toBe(429); expect(state.rpc[1].args._cooldown_until).toBe('2026-10-06T13:29:00.000Z');
  });
  it('invalid cooldown receipt fails closed without committing cursor or positions', async () => {
    state.providerStatus = 429; state.retryAfter = '600'; state.invalidReceipt = true;
    const response = await request(manual);
    expect(response.status).toBe(500); expect(await response.json()).toMatchObject({ success: false, abort_reason: 'persistence_failure' });
    expect(state.rpc.some(call => call.name === 'commit_ssx_position_batch_v1')).toBe(false);
  });
  it('rejects a syntactically valid receipt that silently shortens the provider wait', async () => {
    state.providerStatus = 429; state.retryAfter = '600'; state.shortCooldown = true;
    const response = await request({});
    expect(response.status).toBe(500); expect(await response.json()).toMatchObject({ abort_reason: 'persistence_failure' });
    expect(state.rpc.some(call => call.name === 'clear_ssx_account_cooldown_v1')).toBe(false);
  });
  it('existing memo carries 429 wait without rediscovery fan-out', async () => {
    state.cursor = cursor({ poll_memo: { memo_version: 10, poll_working_property: 'IdTrackedUnit', poll_working_value_source: 'id_tracked_unit',
      poll_working_url: 'https://integration.systemsatx.com.br/v3/Tracking/PositionHistory/List', poll_working_format: 'array', poll_working_time_prop: 'EventDate' } });
    state.providerStatus = 429; state.retryAfter = '600';
    expect((await request(manual)).status).toBe(429); expect(state.requests).toHaveLength(1);
    expect(state.rpc.find(call => call.name === 'record_ssx_account_cooldown_v1')?.args._cooldown_until).toBe('2026-10-06T13:29:00.000Z');
  });
});
