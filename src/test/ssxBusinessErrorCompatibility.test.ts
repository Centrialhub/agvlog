// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PostgrestClient } from '@supabase/postgrest-js';
import { execFileSync } from 'node:child_process';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Handler = (request: Request) => Promise<Response>;
const ids = ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'];
const state = vi.hoisted(() => ({
  db: null as PGlite | null, handlers: [] as Handler[], fetches: 0,
  rpcCalls: [] as { name: string; args: Row }[], failRpc: '', cursorReadFailure: false,
  capabilityDenied: false, idle: false, cron: true, checkpointReadFailure: false, lastRpcError: '',
  loseCommitResponse: false, deferCommitSql: false, lateCommit: null as null | (() => Promise<{ data: unknown; error: null }>),
}));
vi.mock('../../supabase/functions/_shared/cron-auth.ts', () => ({ isCronRequest: async () => state.cron }));
vi.mock('../../supabase/functions/_shared/capabilities.ts', () => ({
  requireIntegrationCapability: async () => state.capabilityDenied ? Response.json({ error: 'Forbidden' }, { status: 403 }) : null,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  from: (table: string) => {
    if (table === 'integration_logs') return { insert: async () => ({ error: null }) };
    if (!['integration_accounts', 'ssx_rule_violation_cursors', 'ssx_sync_checkpoints'].includes(table)) throw Error('Unexpected table: ' + table);
    let account = '';
    const query = {
      select: () => query, eq: (_key: string, value: string) => { if (['id','integration_account_id'].includes(_key)) account = value; return query; },
      single: async () => ({ data: {
        id: account, tenant_id: account, provider: 'SSX', base_url: 'https://integration.systemsatx.com.br',
        token_cache: 'SYNTHETIC_ONLY', token_expires_at: '2099-01-01', settings: { request_timeout_ms: 1000 },
      }, error: null }),
      maybeSingle: async () => table === 'ssx_sync_checkpoints'
        ? state.checkpointReadFailure ? {data:null,error:{message:'synthetic'}}
          : {data:(await state.db!.query<Row>("select result from ssx_sync_checkpoints where integration_account_id=$1 and resource='rule_violations_gate' and scope_key=''",[account])).rows[0]??null,error:null}
        : state.cursorReadFailure ? { data: null, error: { message: 'synthetic' } }
        : { data: (await state.db!.query<Row>(
          'select last_error_code,updated_at from ssx_rule_violation_cursors where integration_account_id=$1',
          [account],
        )).rows[0] ?? null, error: null },
    };
    return query;
  },
  rpc: async (name: string, args: Row) => {
    state.rpcCalls.push({ name, args });
    if (state.failRpc === name) return { data: null, error: { message: 'synthetic failure' } };
    const contracts: Record<string, [string, string[]]> = {
      claim_ssx_sync_checkpoint_v1: ['select claim_ssx_sync_checkpoint_v1($1,$2,$3,$4) value',
        ['_account_id', '_resource', '_scope_key', '_max_age_seconds']],
      finish_ssx_sync_checkpoint_v1: ['select finish_ssx_sync_checkpoint_v1($1,$2,$3,$4,$5::jsonb,$6,$7) value',
        ['_account_id', '_resource', '_scope_key', '_lease_token', '_result', '_error_code', '_retry_seconds']],
      get_ssx_rule_violation_window_v1: ['select * from get_ssx_rule_violation_window_v1($1,$2,$3)',
        ['_integration_account_id', '_overlap', '_window_size']],
      upsert_ssx_rule_violations_v1: ['select upsert_ssx_rule_violations_v1($1,$2::jsonb,$3) value',
        ['_integration_account_id', '_items', '_observed_at']],
      ack_ssx_rule_violation_window_v1: ['select ack_ssx_rule_violation_window_v1($1,$2,$3,$4,$5) value',
        ['_integration_account_id', '_expected_last_position_id', '_end_position_id', '_success', '_error_code']],
      commit_ssx_rule_violation_window_v3: ['select commit_ssx_rule_violation_window_v3($1,$2,$3,$4,$5,$6::jsonb,$7) value',
        ['_integration_account_id','_lease_token','_expected_last_position_id','_end_position_id','_window_end_position_id','_items','_observed_at']],
      commit_ssx_rule_violation_window_v2: ['select commit_ssx_rule_violation_window_v2($1,$2,$3,$4,$5::jsonb,$6) value',
        ['_integration_account_id', '_lease_token', '_expected_last_position_id', '_end_position_id', '_items', '_observed_at']],
      fail_ssx_rule_violation_window_v2: ['select fail_ssx_rule_violation_window_v2($1,$2,$3,$4,$5,$6) value',
        ['_integration_account_id', '_lease_token', '_expected_last_position_id', '_end_position_id', '_error_code', '_retry_seconds']],
    };
    const contract = contracts[name];
    if (!contract) throw Error('Unexpected RPC: ' + name);
    try {
      const run = () => state.db!.transaction(async tx => {
        await tx.exec('set local role service_role');
        const rows = (await tx.query<Row>(contract[0], contract[1].map(key =>
          ['_items', '_result'].includes(key) ? JSON.stringify(args[key]) : args[key]))).rows;
        const data = name === 'get_ssx_rule_violation_window_v1'
          ? { ...rows[0], ...(state.idle ? { should_poll: false } : {}) } : rows[0].value;
        return { data, error: null };
      });
      if (name === 'commit_ssx_rule_violation_window_v3' && state.deferCommitSql) {
        state.deferCommitSql = false; state.lateCommit = run;
        return { data: null, error: { code: 'NETWORK_ABORTED', message: 'synthetic abort after10s; backend not cancelled' } };
      }
      const result = await run();
      if (name === 'commit_ssx_rule_violation_window_v3' && state.loseCommitResponse) {
        state.loseCommitResponse = false; return { data: null, error: { message: 'synthetic response lost after commit' } };
      }
      return result;
    } catch (error) { state.lastRpcError=(error as Error).message; return { data: null, error: { message: state.lastRpcError } }; }
  },
}) }));

beforeAll(async () => {
  state.db = new PGlite();
  await state.db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema ssx_private; grant usage on schema public,ssx_private to service_role;
    create table integration_accounts(id uuid primary key,provider text not null);
    create table positions_raw(id bigint generated always as identity primary key,
      integration_account_id uuid references integration_accounts(id),telemetry jsonb);
    grant select on integration_accounts,positions_raw to service_role;
  `);
  await state.db.exec(readFileSync('supabase/migrations/20260910163922_add_ssx_governance_and_violations.sql', 'utf8'));
  await state.db.exec(readFileSync('supabase/migrations/20260924143248_add_ssx_sync_checkpoints.sql', 'utf8'));
  const legacy = await state.db.query<Row>(`select oid,prosrc,proacl::text,proconfig,prosecdef from pg_proc where proname in
    ('upsert_ssx_rule_violations_v1','ack_ssx_rule_violation_window_v1','get_ssx_rule_violation_window_v1',
     'claim_ssx_sync_checkpoint_v1','finish_ssx_sync_checkpoint_v1') order by oid`);
  await state.db.exec(readFileSync('supabase/migrations/20261007122904_fence_ssx_rule_violation_finalization.sql', 'utf8'));
  expect((await state.db.query<Row>(`select oid,prosrc,proacl::text,proconfig,prosecdef from pg_proc where proname in
    ('upsert_ssx_rule_violations_v1','ack_ssx_rule_violation_window_v1','get_ssx_rule_violation_window_v1',
     'claim_ssx_sync_checkpoint_v1','finish_ssx_sync_checkpoint_v1') order by oid`)).rows).toEqual(legacy.rows);
  const v2Names="('commit_ssx_rule_violation_window_v2','fail_ssx_rule_violation_window_v2')";
  const v2 = await state.db.query<Row>('select oid,prosrc,proacl::text,proconfig,prosecdef from pg_proc where proname in '+v2Names+' order by oid');
  await state.db.exec(readFileSync('supabase/migrations/20261007131504_add_bounded_ssx_violation_commit_v3.sql','utf8'));
  expect((await state.db.query<Row>('select oid,prosrc,proacl::text,proconfig,prosecdef from pg_proc where proname in '+v2Names+' order by oid')).rows).toEqual(v2.rows);
  for (const id of ids) {
    await state.db.query("insert into integration_accounts values ($1,'SSX')", [id]);
    await state.db.query(`insert into positions_raw(integration_account_id,telemetry) values ($1,'{"IdPosition":"10"}')`, [id]);
  }
  vi.stubGlobal('Deno', { env: { get: () => 'SYNTHETIC_ONLY' }, serve: (handler: Handler) => state.handlers.push(handler) });
  // Separate imports construct two handlers, sharing only durable SQL state.
  const path = '../../supabase/functions/ssx-sync-rule-violations/index.ts';
  await import(path); vi.resetModules(); await import(path);
  expect(state.handlers).toHaveLength(2);
}, 30_000);
afterAll(async () => { await state.db?.close(); vi.unstubAllGlobals(); });
beforeEach(async () => {
  await state.db!.exec('truncate ssx_sync_checkpoints,ssx_rule_violation_cursors,ssx_rule_violations');
  await state.db!.exec("update positions_raw set provider_position_id=10,telemetry=jsonb_build_object('IdPosition','10')");
  state.fetches = 0; state.rpcCalls = []; state.failRpc = ''; state.cursorReadFailure = false;
  state.capabilityDenied = false; state.idle = false; state.cron = true; state.checkpointReadFailure = false; state.lastRpcError = '';
  state.loseCommitResponse=false;state.deferCommitSql=false;state.lateCommit=null;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // Every provider transport is replaced. No environment credentials or real HTTP.
  vi.stubGlobal('fetch', vi.fn(async () => { state.fetches++; return new Response('[]'); }));
});
afterEach(() => vi.restoreAllMocks());
async function invoke(handler = 0, account = ids[0], authorization?: string) {
  const response = await state.handlers[handler](new Request('https://edge.invalid', {
    method: 'POST', body: JSON.stringify({ integration_account_id: account }),
    headers: authorization ? { Authorization: authorization } : {},
  }));
  return { status: response.status, body: await response.json() as Row };
}
async function rows(table: string) { return (await state.db!.query<Row>('select * from ' + table)).rows; }


const forwardFiles = [
  '20261007122904_fence_ssx_rule_violation_finalization.sql',
  '20261007131504_add_bounded_ssx_violation_commit_v3.sql',
];
const legacyDefinitions = forwardFiles.flatMap(file => {
  const text = execFileSync('git', ['--no-optional-locks', 'show',
    'e2b5dfb9935431cfc4dceea0025d8b5964331bbf:supabase/migrations/' + file], { encoding: 'utf8' });
  return [...text.matchAll(/create function public\.[\s\S]*?end \$function\$;/g)]
    .map(match => match[0].replace(/^create function/, 'create or replace function'));
});
const currentDefinitions = forwardFiles.flatMap(file =>
  [...readFileSync('supabase/migrations/' + file, 'utf8').replace(/\r\n/g, '\n')
    .matchAll(/create function public\.[\s\S]*?end \$function\$;/g)]
    .map(match => match[0].replace(/^create function/, 'create or replace function')));
async function version(legacy: boolean) {
  for (const definition of legacy ? legacyDefinitions : currentDefinitions) await state.db!.exec(definition);
}
async function prepareClaim() {
  const gate = (await state.db!.query<{ value: { lease_token: string } }>(
    "select claim_ssx_sync_checkpoint_v1($1,'rule_violations_gate','',0) value", [ids[0]],
  )).rows[0].value;
  await state.db!.query('select * from get_ssx_rule_violation_window_v1($1,1000,50000000)', [ids[0]]);
  return gate.lease_token;
}
const payload = JSON.stringify([{ provider_violation_id: 101, payload: {} }]);
async function direct(kind: number | string, token: string) {
  if (kind === 'fail') return state.db!.query<{ value: unknown }>(
    "select fail_ssx_rule_violation_window_v2($1,$2,0,10,'request_failed',0) value", [ids[0], token]);
  return kind === 2 ? state.db!.query<{ value: unknown }>(
    'select commit_ssx_rule_violation_window_v2($1,$2,0,10,$3::jsonb) value', [ids[0], token, payload])
    : state.db!.query<{ value: unknown }>('select commit_ssx_rule_violation_window_v3($1,$2,0,10,20,$3::jsonb) value',
      [ids[0], token, payload]);
}
const snapshot = async () => ({
  gate: await rows('ssx_sync_checkpoints'), cursor: await rows('ssx_rule_violation_cursors'),
  items: await rows('ssx_rule_violations'),
});
async function trigger(mode: string) {
  if (mode === 'cursor') {
    await state.db!.exec("create function public.fixture_suppress_cursor() returns trigger language plpgsql as $$begin update public.ssx_rule_violation_cursors set last_position_id=999 where integration_account_id=new.integration_account_id;return new;end$$;"
      + 'create trigger fixture_cursor after insert or update on public.ssx_rule_violations for each row execute function public.fixture_suppress_cursor();');
  } else {
    await state.db!.exec("create function public.fixture_expire_gate() returns trigger language plpgsql as $$begin "
      + "update public.ssx_sync_checkpoints set lease_until=clock_timestamp()-interval '1 second' "
      + "where integration_account_id=new.integration_account_id and resource='rule_violations_gate';return new;end$$;");
    const table = mode === 'failure-lease' ? 'ssx_rule_violation_cursors' : 'ssx_rule_violations';
    await state.db!.exec('create trigger fixture_lease after insert or update on public.' + table
      + ' for each row execute function public.fixture_expire_gate();');
  }
}
afterEach(async () => {
  await state.db!.exec('drop trigger if exists fixture_cursor on public.ssx_rule_violations;'
    + 'drop trigger if exists fixture_lease on public.ssx_rule_violation_cursors;'
    + 'drop trigger if exists fixture_lease on public.ssx_rule_violations;'
    + 'drop function if exists public.fixture_suppress_cursor();drop function if exists public.fixture_expire_gate();');
  await version(false);
});
const scenarios: Array<[number | string, string, string]> = [
  [2, 'cursor', 'ssx_violation_cursor_conflict'],
  [2, 'lease', 'ssx_violation_lease_lost'],
  ['fail', 'failure-lease', 'ssx_violation_lease_lost'],
  [3, 'cursor', 'ssx_violation_cursor_conflict'],
  [3, 'lease', 'ssx_violation_lease_lost'],
];
describe('five SSX business errors, callers and uncertain results', () => {
  for (const [kind, mode, message] of scenarios) {
    it('historical ' + kind + '/' + mode + ' raises40001 with total rollback', async () => {
      await version(true); const token = await prepareClaim(); await trigger(mode);
      const before = await snapshot();
      await expect(direct(kind, token)).rejects.toMatchObject({ code: '40001', message });
      expect(await snapshot()).toEqual(before);
    });
    it('corrected ' + kind + '/' + mode + ' raisesP0001 with exact message and total rollback', async () => {
      const token = await prepareClaim(); await trigger(mode); const before = await snapshot();
      await expect(direct(kind, token)).rejects.toMatchObject({ code: 'P0001', message });
      expect(await snapshot()).toEqual(before);
    });
  }
  it.each(['expired', 'wrong-token', 'stale-cursor'])('keeps initial %s refusal finite and nonmutating', async mode => {
    let token = await prepareClaim();
    if (mode === 'expired') await state.db!.exec("update ssx_sync_checkpoints set lease_until=clock_timestamp()-interval '1 second'");
    if (mode === 'wrong-token') token = '30000000-0000-4000-8000-000000000099';
    if (mode === 'stale-cursor') await state.db!.exec('update ssx_rule_violation_cursors set last_position_id=999');
    const before = await snapshot();
    expect((await direct(3, token)).rows[0].value).toEqual({ committed: false, upserted: 0 });
    expect(await snapshot()).toEqual(before);
  });
  it('retains v1 and ACL/invoker/searchpath while changing only the three new bodies', async () => {
    const query = "select oid,prosrc,proacl::text,proconfig,prosecdef from pg_proc where proname in "
      + "('upsert_ssx_rule_violations_v1','ack_ssx_rule_violation_window_v1','claim_ssx_sync_checkpoint_v1','finish_ssx_sync_checkpoint_v1') order by oid";
    const before = (await state.db!.query(query)).rows; await version(true); await version(false);
    expect((await state.db!.query(query)).rows).toEqual(before);
    const meta = (await state.db!.query<Row>("select prosrc,proacl::text acl,proconfig,prosecdef from pg_proc where proname in "
      + "('commit_ssx_rule_violation_window_v2','fail_ssx_rule_violation_window_v2','commit_ssx_rule_violation_window_v3')")).rows;
    expect(meta).toHaveLength(3);
    for (const row of meta) {
      expect(row).toMatchObject({ acl: '{postgres=X/postgres,service_role=X/postgres}',
        proconfig: ['search_path=""'], prosecdef: false });
      expect(row.prosrc).not.toContain("'40001'"); expect(row.prosrc).toContain("'P0001'");
    }
  });
  it.each(['anon', 'authenticated'])('keeps %s denied by existing execute ACL', async role => {
    const token = await prepareClaim(); await state.db!.exec('set role ' + role);
    try { await expect(direct(3, token)).rejects.toMatchObject({ code: '42501' }); }
    finally { await state.db!.exec('reset role'); }
  });
  it('preserves backoff300 and does not immediately retry after a persistence refusal', async () => {
    await trigger('cursor');
    vi.stubGlobal('fetch', vi.fn(async () => { state.fetches++; return Response.json([{ IdRuleViolation: 101 }]); }));
    expect((await invoke()).status).toBe(502);
    const gate = (await rows('ssx_sync_checkpoints'))[0];
    expect(gate.status).toBe('failed'); expect(new Date(String(gate.retry_at)).getTime()-new Date(String(gate.updated_at)).getTime()).toBeGreaterThanOrEqual(300_000);
    expect((await invoke(1)).body).toMatchObject({ status: 'deferred', requests: 0 });
    expect(state.fetches).toBe(1);
    expect(state.rpcCalls.filter(call => call.name === 'commit_ssx_rule_violation_window_v3')).toHaveLength(1);
    expect(await rows('ssx_rule_violations')).toHaveLength(0);
  });
  it('keeps a commit with lost response uncertain and replay deduplicated', async () => {
    state.loseCommitResponse = true;
    vi.stubGlobal('fetch', vi.fn(async () => { state.fetches++; return Response.json([{ IdRuleViolation: 101 }]); }));
    expect(await invoke()).toMatchObject({ status: 502, body: { code: 'checkpoint_not_confirmed' } });
    expect(await rows('ssx_rule_violations')).toHaveLength(1);
    expect((await rows('ssx_rule_violation_cursors'))[0].last_position_id).toBe(10);
    expect((await invoke(1)).body).toMatchObject({ success: true });
    expect(await rows('ssx_rule_violations')).toHaveLength(1);
  });
  it('models SQL arriving after an abort reply without assuming cancellation or duplicate writes', async () => {
    state.deferCommitSql = true;
    vi.stubGlobal('fetch', vi.fn(async () => { state.fetches++; return Response.json([{ IdRuleViolation: 101 }]); }));
    expect(await invoke()).toMatchObject({ status: 502, body: { code: 'persistence_failed' } });
    const before = await snapshot(); expect(state.lateCommit).not.toBeNull();
    expect((await state.lateCommit!()).data).toEqual({ committed: false, upserted: 0 });
    expect(await snapshot()).toEqual(before);
    expect((await invoke(1)).body).toMatchObject({ status: 'deferred', requests: 0 });
    expect(state.fetches).toBe(1); expect(await rows('ssx_rule_violations')).toHaveLength(0);
  });
  it.each([[400, 'P0001'], [500, '40001'], [503, '503'], [520, '520']])(
    'real SDK POST status%s/code%s makes one request and preserves the error', async (status, code) => {
      let calls = 0;
      const client = new PostgrestClient('https://sdk-fixture.invalid', { fetch: async (_url, init) => {
        expect(init?.method).toBe('POST'); calls++;
        return Response.json({ code, message: 'synthetic_error', details: null, hint: null }, { status: Number(status) });
      } });
      const result = await client.rpc('synthetic_rpc', {});
      expect(result.error?.code).toBe(String(code)); expect(calls).toBe(1);
    });
});

