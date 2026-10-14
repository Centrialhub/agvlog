// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
type Handler = (request: Request) => Promise<Response>;
const ids = ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'];
const state = vi.hoisted(() => ({
  db: null as PGlite | null, handlers: [] as Handler[], fetches: 0,
  rpcCalls: [] as { name: string; args: Row }[], failRpc: '', cursorReadFailure: false,
  capabilityDenied: false, idle: false, cron: true, checkpointReadFailure: false, lastRpcError: '',
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
      return await state.db!.transaction(async tx => {
        await tx.exec('set local role service_role');
        const rows = (await tx.query<Row>(contract[0], contract[1].map(key =>
          ['_items', '_result'].includes(key) ? JSON.stringify(args[key]) : args[key]))).rows;
        const data = name === 'get_ssx_rule_violation_window_v1'
          ? { ...rows[0], ...(state.idle ? { should_poll: false } : {}) } : rows[0].value;
        return { data, error: null };
      });
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
function latch() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function rows(table: string) { return (await state.db!.query<Row>('select * from ' + table)).rows; }

describe('violations account lease through two real handlers and existing SQL', () => {
  it('commits all 7984 violations across bounded SQL batches with one cursor effect and replay', async () => {
    await state.db!.query("update positions_raw set provider_position_id=16,telemetry=jsonb_build_object('IdPosition','16') where integration_account_id=$1",[ids[0]]);
    vi.stubGlobal('fetch',vi.fn(async (_input,init) => {
      state.fetches++;
      const filters=JSON.parse(String(init?.body)) as {Condition:string;Value:string}[];
      const start=Number(filters.find(filter=>filter.Condition==='>=')!.Value);
      const end=Number(filters.find(filter=>filter.Condition==='<=')!.Value);
      const items=[];
      for(let position=start;position<=end && items.length<500;position++){
        for(let index=1;index<=499 && items.length<500;index++)items.push({IdRuleViolation:position*1000+index});
      }
      return Response.json(items);
    }));
    expect(await invoke()).toMatchObject({status:200,body:{status:'success',cursor_advanced:true,upserted:7984}});
    expect((await rows('ssx_rule_violation_cursors'))[0].last_position_id).toBe(16);
    expect(await rows('ssx_rule_violations')).toHaveLength(7984);
    expect(state.fetches).toBe(31);
    expect((await invoke(1)).body.status).toBe('success');
    expect(await rows('ssx_rule_violations')).toHaveLength(7984);
  },30000);

  it('defers a second instance before HTTP and preserves a single effect and replay', async () => {
    const entered = latch(), held = latch();
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (++state.fetches === 1) { entered.release(); await held.promise; }
      return new Response(JSON.stringify([{ IdRuleViolation: 101, InitialDate: '2026-09-25T12:00:00Z' }]));
    }));
    const first = invoke(); await entered.promise;
    let second: Awaited<ReturnType<typeof invoke>>;
    try { second = await invoke(1); } finally { held.release(); }
    const completed = await first;
    expect(state.fetches).toBe(1);
    expect(second!).toMatchObject({ status: 200, body: { status: 'deferred', requests: 0 } });
    expect(completed.body).toMatchObject({ status: 'success', cursor_advanced: true, upserted: 1 });
    expect(await rows('ssx_rule_violations')).toHaveLength(1);
    expect((await rows('ssx_rule_violation_cursors'))[0].last_position_id).toBe(10);
    expect((await rows('ssx_sync_checkpoints'))[0]).toMatchObject({ status: 'success', lease_token: null });
    expect((await invoke(1)).body.status).toBe('success');
    expect(await rows('ssx_rule_violations')).toHaveLength(1);
  });
  it('allows independent accounts while another account holds its lease', async () => {
    const entered = latch(), held = latch();
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (++state.fetches === 1) { entered.release(); await held.promise; }
      return new Response('[]');
    }));
    const first = invoke(); await entered.promise;
    let other: Awaited<ReturnType<typeof invoke>>;
    try { other = await invoke(1, ids[1]); } finally { held.release(); }
    expect(other!.body.status).toBe('success'); expect((await first).body.status).toBe('success');
    expect(state.fetches).toBe(2); expect(await rows('ssx_rule_violation_cursors')).toHaveLength(2);
  });
  it('retains long Retry-After in both cursor and checkpoint and performs no extra fetch', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { state.fetches++; return new Response('', {
      status: 429, headers: { 'Retry-After': '7200' },
    }); }));
    expect(await invoke()).toMatchObject({ status: 502, body: { code: 'rate_limited:7200' } });
    const cursor = (await rows('ssx_rule_violation_cursors'))[0];
    expect(cursor).toMatchObject({ last_position_id: 0, last_error_code: 'rate_limited:7200' });
    const checkpoint = (await rows('ssx_sync_checkpoints'))[0];
    expect(checkpoint).toMatchObject({ status: 'failed', error_code: 'rate_limited', lease_token: null });
    expect((checkpoint.retry_at as Date).getTime() - (checkpoint.updated_at as Date).getTime()).toBe(7200_000);
    expect((await invoke(1)).body).toMatchObject({ status: 'deferred', requests: 0 });
    expect(state.fetches).toBe(1); expect(await rows('ssx_rule_violations')).toHaveLength(0);
  });
  it.each(['claim_ssx_sync_checkpoint_v1', 'get_ssx_rule_violation_window_v1'])(
    'fails closed on %s before HTTP', async name => {
      state.failRpc = name; expect((await invoke()).status).toBeGreaterThanOrEqual(500);
      expect(state.fetches).toBe(0); expect(await rows('ssx_rule_violations')).toHaveLength(0);
      expect(state.rpcCalls.some(call => call.name === 'ack_ssx_rule_violation_window_v1')).toBe(false);
    });
  it('never acquires a privileged lease when capability is denied', async () => {
    state.capabilityDenied = true; expect((await invoke()).status).toBe(403);
    expect(state.rpcCalls).toHaveLength(0); expect(state.fetches).toBe(0);
  });
  it.each([undefined, 'Bearer SYNTHETIC_INVALID'])('rejects unauthenticated manual caller %s before a lease', async authorization => {
    state.cron = false;
    expect((await invoke(0, ids[0], authorization)).status).toBe(401);
    expect(state.rpcCalls).toHaveLength(0); expect(state.fetches).toBe(0);
  });
  it('releases a lease after an idle window without advancing the cursor', async () => {
    state.idle = true; expect((await invoke()).body).toMatchObject({ status: 'idle', requests: 0 });
    expect(state.fetches).toBe(0);
    expect((await rows('ssx_sync_checkpoints'))[0]).toMatchObject({ status: 'success', lease_token: null });
    expect((await rows('ssx_rule_violation_cursors'))[0].last_position_id).toBe(0);
  });
  it('does not commit data or an ACK after exhausting the lease-safe HTTP budget', async () => {
    let elapsed = 0; vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    vi.stubGlobal('fetch', vi.fn(async () => {
      state.fetches++; elapsed = 40_000;
      return new Response(JSON.stringify([{ IdRuleViolation: 101 }]));
    }));
    expect(await invoke()).toMatchObject({ status: 502, body: { code: 'time_budget_exhausted' } });
    expect(await rows('ssx_rule_violations')).toHaveLength(0);
    expect((await rows('ssx_rule_violation_cursors'))[0].last_position_id).toBe(0);
    expect(state.rpcCalls.some(call => call.name === 'commit_ssx_rule_violation_window_v3')).toBe(false);
  });
  it('uses the durable retry even when recording the cursor cooldown fails', async () => {
    state.failRpc = 'fail_ssx_rule_violation_window_v2';
    vi.stubGlobal('fetch', vi.fn(async () => { state.fetches++; return new Response('', { status: 429 }); }));
    expect((await invoke()).body.code).toBe('rate_limited');
    expect((await invoke(1)).body).toMatchObject({ status: 'deferred', requests: 0 });
    expect(state.fetches).toBe(1);
  });
  it('surfaces an unconfirmed release and leaves the lease held until its bounded expiry', async () => {
    state.idle = true; state.failRpc = 'finish_ssx_sync_checkpoint_v1';
    expect(await invoke()).toMatchObject({ status: 502, body: { code: 'checkpoint_not_confirmed' } });
    expect((await rows('ssx_sync_checkpoints'))[0].status).toBe('running');
    expect((await invoke(1)).body).toMatchObject({ status: 'deferred', requests: 0 });
    expect(state.fetches).toBe(0);
  });
  it('preserves the newer cooldown when an expired owner resumes after its local deadline', async () => {
    let elapsed = 0; vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const entered = latch(), held = latch();
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (++state.fetches === 1) { entered.release(); await held.promise; return new Response('[]'); }
      return new Response('', { status: 429, headers: { 'Retry-After': '7200' } });
    }));
    const first = invoke(); await entered.promise;
    await state.db!.exec("update ssx_sync_checkpoints set lease_until=clock_timestamp()-interval '1 second'");
    let later: Awaited<ReturnType<typeof invoke>>;
    try {
      later = await invoke(1);
      elapsed = 100_000;
    } finally { held.release(); }
    expect(later!).toMatchObject({ status: 502, body: { code: 'rate_limited:7200' } });
    expect((await first).body.code).toBe('checkpoint_not_confirmed');
    expect((await rows('ssx_rule_violation_cursors'))[0]).toMatchObject({
      last_position_id: 0, last_error_code: 'rate_limited:7200',
    });
    expect((await rows('ssx_sync_checkpoints'))[0]).toMatchObject({ status: 'failed', error_code: 'rate_limited' });
    expect(state.rpcCalls.filter(call => call.name === 'fail_ssx_rule_violation_window_v2')).toHaveLength(2);
  });
  it('recovers an orphaned lease after expiry and rejects the old token without clearing new state', async () => {
    const old = (await state.db!.query<{ value: { lease_token: string } }>(
      "select claim_ssx_sync_checkpoint_v1($1,'rule_violations_gate','',0) value", [ids[0]],
    )).rows[0].value;
    expect((await invoke(1)).body).toMatchObject({ status: 'deferred', requests: 0 });
    expect(state.fetches).toBe(0);
    await state.db!.exec("update ssx_sync_checkpoints set lease_until=clock_timestamp()-interval '1 second'");
    expect((await invoke(1)).body.status).toBe('success');
    const before = await rows('ssx_sync_checkpoints');
    expect((await state.db!.query<{ value: boolean }>(
      "select finish_ssx_sync_checkpoint_v1($1,'rule_violations_gate','',$2,'{}',null,0) value", [ids[0], old.lease_token],
    )).rows[0].value).toBe(false);
    expect(await rows('ssx_sync_checkpoints')).toEqual(before);
    expect(state.fetches).toBe(1);
  });
  it('keeps both v2 finalizers invoker and executable only by service_role', async () => {
    const acl = (await state.db!.query<Row>(`select proname,prosecdef,
      has_function_privilege('anon',oid,'execute') anon,
      has_function_privilege('authenticated',oid,'execute') authenticated,
      has_function_privilege('service_role',oid,'execute') service
      from pg_proc where proname in ('commit_ssx_rule_violation_window_v2','fail_ssx_rule_violation_window_v2')`)).rows;
    expect(acl).toHaveLength(2);
    for (const row of acl) expect(row).toMatchObject({ prosecdef: false, anon: false, authenticated: false, service: true });
  });
  it('rejects the wrong token and a token from another account without data or cursor effects', async () => {
    await state.db!.query('select * from get_ssx_rule_violation_window_v1($1,200,20000)', [ids[0]]);
    const gate = (await state.db!.query<{ value: { lease_token: string } }>(
      "select claim_ssx_sync_checkpoint_v1($1,'rule_violations_gate','',0) value", [ids[0]],
    )).rows[0].value;
    const checkpoint = await rows('ssx_sync_checkpoints'), cursor = await rows('ssx_rule_violation_cursors');
    await state.db!.transaction(async tx => {
      await tx.exec('set local role service_role');
      expect((await tx.query<{ value: Row }>(
        'select commit_ssx_rule_violation_window_v2($1,$2,0,10,$3::jsonb) value',
        [ids[0], 'ffffffff-ffff-4fff-8fff-ffffffffffff', JSON.stringify([{ provider_violation_id: 101, payload: {} }])],
      )).rows[0].value).toMatchObject({ committed: false, upserted: 0 });
      expect((await tx.query<{ value: boolean }>(
        "select fail_ssx_rule_violation_window_v2($1,$2,0,10,'rate_limited:7200',7200) value",
        [ids[1], gate.lease_token],
      )).rows[0].value).toBe(false);
    });
    expect(await rows('ssx_rule_violations')).toHaveLength(0);
    expect(await rows('ssx_rule_violation_cursors')).toEqual(cursor);
    expect(await rows('ssx_sync_checkpoints')).toEqual(checkpoint);
  });
  it.each(['lease_loss', 'ack_failure'])('rolls back the upsert and ACK together on %s inside SQL', async failure => {
    if (failure === 'lease_loss') await state.db!.exec(`
      create function qa_interrupt() returns trigger language plpgsql as $$begin
        update ssx_sync_checkpoints set lease_until=clock_timestamp()-interval '1 second'
          where integration_account_id=new.integration_account_id; return new; end$$;
      create trigger qa_interrupt before insert on ssx_rule_violations for each row execute function qa_interrupt();
    `);
    else await state.db!.exec(`
      create function qa_interrupt() returns trigger language plpgsql as $$begin
        if new.last_position_id>old.last_position_id then raise exception 'qa_ack_failure'; end if;
        return new; end$$;
      create trigger qa_interrupt before update on ssx_rule_violation_cursors for each row execute function qa_interrupt();
    `);
    vi.stubGlobal('fetch', vi.fn(async () => { state.fetches++; return new Response('[{"IdRuleViolation":101}]'); }));
    try {
      expect((await invoke()).body.code).toBe('persistence_failed');
      expect(await rows('ssx_rule_violations')).toHaveLength(0);
      expect((await rows('ssx_rule_violation_cursors'))[0].last_position_id).toBe(0);
      expect((await rows('ssx_sync_checkpoints'))[0]).toMatchObject({ status: 'failed', lease_token: null });
    } finally {
      await state.db!.exec(`drop trigger qa_interrupt on ${failure === 'lease_loss' ? 'ssx_rule_violations' : 'ssx_rule_violation_cursors'};
        drop function qa_interrupt();`);
    }
  });
});
