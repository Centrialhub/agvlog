// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { fixture, forwardSql, ssxIds } from './helpers/ssxAccountCooldownContractFixture';

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  db: null as PGlite | null,
  handler: null as null | ((request: Request) => Promise<Response>),
  retryAfter: '7200' as string | undefined, requests: 0,
  rpc: [] as { name: string; args: Args; error?: string }[],
  reads: [] as string[],
}));
vi.mock('../../supabase/functions/_shared/cron-auth.ts', () => ({ isCronRequest: vi.fn().mockResolvedValue(true) }));
vi.mock('../../supabase/functions/_shared/capabilities.ts', () => ({ requireIntegrationCapability: vi.fn().mockResolvedValue(null) }));
vi.mock('../../supabase/functions/_shared/ssx-utils.ts', async importOriginal => {
  const actual = await importOriginal<typeof import('../../supabase/functions/_shared/ssx-utils.ts')>();
  return { ...actual, logIntegration: vi.fn(), logSsxCall: vi.fn() };
});
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  rpc: async (name: string, args: Args) => {
    const call: typeof state.rpc[number] = { name, args };
    state.rpc.push(call);
    if (!state.db) throw Error('Missing owned SQL fixture');
    // Execute actual PL/pgSQL with named-argument mapping, never mock a receipt.
    const contracts: Record<string, { sql: string; keys: string[] }> = {
      record_ssx_account_cooldown_v1: {
        sql: 'select public.record_ssx_account_cooldown_v1($1,$2,$3,$4,$5) result',
        keys: ['_tenant_id', '_integration_account_id', '_observed_at', '_cooldown_until', '_error'],
      },
      record_ssx_poll_error_v1: {
        sql: 'select public.record_ssx_poll_error_v1($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) result',
        keys: ['_tenant_id', '_integration_account_id', '_provider_unit_id', '_tracker_link_id', '_vehicle_id',
          '_observed_at', '_error', '_backoff_until', '_poll_memo'],
      },
    };
    const contract = contracts[name];
    if (!contract) throw Error('Unexpected RPC on 429 path: ' + name);
    await state.db.exec('set role service_role');
    try {
      const values = contract.keys.map(key => key === '_poll_memo' ? JSON.stringify(args[key]) : args[key]);
      const result = await state.db.query<{ result: Row }>(contract.sql, values);
      return { data: result.rows[0].result, error: null };
    } catch (error) {
      call.error = (error as { code: string }).code;
      return { data: null, error: { message: (error as Error).message } };
    } finally { await state.db.exec('reset role'); }
  },
  from: (table: string) => {
    const sources: Record<string, string> = {
      integration_accounts: 'select * from public.integration_accounts',
      provider_units: 'select * from public.provider_units',
      vehicle_tracker_links: 'select * from public.vehicle_tracker_links',
      ingestion_cursors: 'select * from public.ingestion_cursors',
    };
    if (!sources[table]) throw Error('Unexpected table: ' + table);
    const filters: ((row: Row) => boolean)[] = [];
    let one = false;
    let start = 0;
    let end = Number.MAX_SAFE_INTEGER;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query; },
      order: () => query,
      range: (from: number, to: number) => { start = from; end = to; return query; },
      single: () => { one = true; return query; },
      maybeSingle: () => { one = true; return query; },
      then: async (resolve: (value: unknown) => unknown) => {
        if (!state.db) throw Error('Missing owned SQL fixture');
        state.reads.push(table);
        // Match PostgREST JSON timestamps, using only synthetic fixture rows.
        const rows: Row[] = JSON.parse(JSON.stringify((await state.db.query(sources[table])).rows));
        const selected = rows.filter(row => filters.every(filter => filter(row))).slice(start, end + 1);
        return resolve({ data: one ? selected[0] ?? null : selected, error: null });
      },
    };
    return query;
  },
}) }));

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: () => undefined }, serve: (handler: typeof state.handler) => { state.handler = handler; } });
  await import('../../supabase/functions/ssx-poll-positions/index.ts');
});
afterAll(() => { vi.unstubAllGlobals(); });
beforeEach(async () => {
  state.db = await fixture(false);
  state.rpc = []; state.reads = []; state.requests = 0; state.retryAfter = '7200';
  await state.db.query(`update integration_accounts set base_url=$1, token_cache=$2,
    token_expires_at='2099-01-01',settings=$3::jsonb where id=$4`,
  ['https://integration.systemsatx.com.br', 'QA_ONLY_NOT_REAL', JSON.stringify({ api_version: 'v3',
    request_spacing_ms: 0, discovery_request_spacing_ms: 0 }), ssxIds.account]);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async () => {
    state.requests++;
    return new Response(null, { status: 429, headers: state.retryAfter === undefined ? {} : { 'Retry-After': state.retryAfter } });
  }));
});
afterEach(async () => { await state.db?.close(); state.db = null; vi.restoreAllMocks(); });

async function request(manual = false) {
  if (!state.handler) throw Error('Real handler not loaded');
  return state.handler(new Request('https://edge.invalid', { method: 'POST', body: JSON.stringify({
    integration_account_id: ssxIds.account, manual_run: manual, lookback_minutes: 5,
    ...(manual ? { provider_unit_ids: [ssxIds.unit] } : {}),
  }) }));
}
async function persistedWait(seconds: number) {
  if (!state.db) throw Error('Missing fixture');
  const accountCall = state.rpc.find(call => call.name === 'record_ssx_account_cooldown_v1')!;
  const unitCall = state.rpc.find(call => call.name === 'record_ssx_poll_error_v1')!;
  for (const [call, key] of [[accountCall, '_cooldown_until'], [unitCall, '_backoff_until']] as const) {
    expect(call.error).toBeUndefined();
    expect(Date.parse(String(call.args[key])) - Date.parse(String(call.args._observed_at))).toBe(seconds * 1000);
  }
  const account = (await state.db.query<Row>('select poll_cooldown_until from integration_accounts')).rows[0];
  const cursor = (await state.db.query<Row>('select backoff_until,last_success_at from ingestion_cursors')).rows[0];
  expect(account.poll_cooldown_until).toBeInstanceOf(Date);
  expect(cursor.backoff_until).toBeInstanceOf(Date);
  expect((account.poll_cooldown_until as Date).toISOString()).toBe(accountCall.args._cooldown_until);
  expect((cursor.backoff_until as Date).toISOString()).toBe(unitCall.args._backoff_until);
  expect(cursor.last_success_at).toBeNull();
  for (const sql of ['select count(*)::int count from positions_raw', 'select count(*)::int count from positions_last',
    'select count(*)::int count from vehicle_processing_queue']) {
    expect((await state.db.query<{ count: number }>(sql)).rows[0].count).toBe(0);
  }
  expect(state.rpc.map(call => call.name).sort()).toEqual(['record_ssx_account_cooldown_v1', 'record_ssx_poll_error_v1']);
}

describe('HTTP Retry-After through actual handler and SQL cooldown contract', () => {
  it('reproduces old two-hour persistence failure then fixes the same request', async () => {
    expect((await request()).status).toBe(500);
    expect(state.rpc.find(call => call.name === 'record_ssx_account_cooldown_v1')?.error).toBe('22023');
    expect((await state.db!.query<Row>('select poll_cooldown_until from integration_accounts')).rows[0].poll_cooldown_until).toBeNull();
    await state.db!.exec(forwardSql());
    state.rpc = [];
    expect((await request()).status).toBe(429);
    await persistedWait(7200);
  });
  it.each([[false, 3601], [true, 7200], [false, 86400], [true, 86400]] as const)(
    'persists manual=%s wait=%s and blocks another manual call before provider I/O', async (manual, seconds) => {
      await state.db!.exec(forwardSql()); state.retryAfter = String(seconds);
      const response = await request(manual);
      expect(response.status).toBe(429);
      expect(await response.json()).toMatchObject({ abort_reason: 'rate_limited', retry_after_seconds: seconds });
      await persistedWait(seconds);
      expect(state.requests).toBe(1);
      const calls = state.rpc.length; state.reads = [];
      expect((await request(true)).status).toBe(429);
      expect(state.requests).toBe(1); expect(state.rpc).toHaveLength(calls);
      expect(state.reads).toEqual(['integration_accounts']);
    });
  it.each([undefined, 'invalid', '1e999', '9'.repeat(400), '0', 'Wed, 01 Jan 2020 00:00:00 GMT'])(
    'malformed, overflow or elapsed header %s preserves safe existing fallback', async header => {
      await state.db!.exec(forwardSql()); state.retryAfter = header;
      expect((await request()).status).toBe(429); await persistedWait(120);
    });
  it('preserves existing parser cap for a numeric wait outside the supported contract', async () => {
    await state.db!.exec(forwardSql()); state.retryAfter = '86401';
    expect((await request()).status).toBe(429); await persistedWait(86400);
  });
  it('accepts an HTTP-date above one hour without converting it into calendar days', async () => {
    await state.db!.exec(forwardSql());
    state.retryAfter = new Date(Date.now() + 7200_000).toUTCString();
    const response = await request(true);
    expect(response.status).toBe(429);
    const result = await response.json();
    expect(result.retry_after_seconds).toBeGreaterThanOrEqual(7199);
    expect(result.retry_after_seconds).toBeLessThanOrEqual(7200);
    await persistedWait(result.retry_after_seconds);
  });
});
