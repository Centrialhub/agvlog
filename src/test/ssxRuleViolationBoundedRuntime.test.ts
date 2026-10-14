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
async function rows(table: string) { return (await state.db!.query<Row>('select * from ' + table)).rows; }


async function densePositions(max: number, late = false) {
  await state.db!.query("update positions_raw set provider_position_id=$2::bigint,telemetry=jsonb_build_object('IdPosition',($2::bigint)::text) where integration_account_id=$1",[ids[0],max]);
  vi.stubGlobal('fetch',vi.fn(async (_input,init) => {
    state.fetches++;
    const filters=JSON.parse(String(init?.body)) as {Condition:string;Value:string}[];
    const start=Number(filters.find(filter=>filter.Condition==='>=')!.Value);
    const end=Number(filters.find(filter=>filter.Condition==='<=')!.Value);
    const items=[];
    for(let position=start;position<=end && items.length<500;position++) {
      for(let index=1;index<=499 && items.length<500;index++)items.push({
        IdRuleViolation:position*1000+index,
        DriverIntegrationCode:late && position===20 && index===1 ? 'late-update' : 'original',
      });
    }
    return Response.json(items);
  }));
}
async function sqlRole(sql:string,args:unknown[]=[],role='service_role') {
  return state.db!.transaction(async tx=>{await tx.exec('set local role '+role);return tx.query<Row>(sql,args);});
}
async function claim(account=ids[0]) {
  const gate=(await sqlRole("select claim_ssx_sync_checkpoint_v1($1,'rule_violations_gate','',0) value",[account])).rows[0].value as Row;
  await sqlRole('select * from get_ssx_rule_violation_window_v1($1,500,1000)',[account]);
  return gate.lease_token;
}
afterEach(async()=>{
  await state.db!.exec('drop trigger if exists qa_late_batch on ssx_rule_violations;drop function if exists qa_late_batch()');
});

describe('bounded SSX finalization with real SQL and synthetic provider',()=>{
  it('reproduces the inherited v2 5000-item rejection without changing any durable state',async()=>{
    const token=await claim();
    const before=await rows('ssx_sync_checkpoints');
    const items=Array.from({length:7984},(_,i)=>({provider_violation_id:i+1,payload:{}}));
    await expect(sqlRole('select commit_ssx_rule_violation_window_v2($1,$2,0,16,$3::jsonb,clock_timestamp())',
      [ids[0],token,JSON.stringify(items)])).rejects.toThrow('ssx_violation_batch_invalid');
    expect(await rows('ssx_sync_checkpoints')).toEqual(before);
    expect((await rows('ssx_rule_violation_cursors'))[0].last_position_id).toBe(0);
    expect(await rows('ssx_rule_violations')).toHaveLength(0);
  });
  it('finishes a 32-position dense window in bounded pages without loss or duplicate rows',async()=>{
    await densePositions(32);
    expect((await invoke()).body).toMatchObject({status:'partial',requests:32,upserted:7984});
    expect((await rows('ssx_rule_violation_cursors'))[0].last_position_id).toBe(16);
    expect((await rows('ssx_sync_checkpoints'))[0].result).toMatchObject({version:3,cursor_position_id:'16',resume_position_id:'17',window_end_position_id:'32'});
    expect((await invoke(1)).body).toMatchObject({status:'success',requests:31,upserted:7984});
    expect((await rows('ssx_rule_violation_cursors'))[0].last_position_id).toBe(32);
    expect((await rows('ssx_sync_checkpoints'))[0].result).toMatchObject({resume_position_id:null});
    expect(await rows('ssx_rule_violations')).toHaveLength(15968);
    expect(state.fetches).toBe(63);
    expect(await rows('ssx_rule_violations')).toSatisfy((records:Row[])=>records.every(row=>row.integration_account_id===ids[0]));
  },30000);
  it('resumes overlap pages even when the cursor already reached the end, updating late data',async()=>{
    await densePositions(32); await invoke(); await invoke();
    await densePositions(32,true);
    expect((await invoke()).body.status).toBe('partial');
    expect((await rows('ssx_rule_violation_cursors'))[0].last_position_id).toBe(32);
    expect((await rows('ssx_sync_checkpoints'))[0].result).toMatchObject({cursor_position_id:'32',resume_position_id:'17'});
    expect((await state.db!.query<Row>('select driver_integration_code from ssx_rule_violations where provider_violation_id=20001')).rows[0].driver_integration_code).toBe('original');
    expect((await invoke(1)).body.status).toBe('success');
    expect((await state.db!.query<Row>('select driver_integration_code from ssx_rule_violations where provider_violation_id=20001')).rows[0].driver_integration_code).toBe('late-update');
    expect(await rows('ssx_rule_violations')).toHaveLength(15968);
  },30000);
  it('retains pagination through a 429 and resumes after its synthetic cooldown',async()=>{
    await densePositions(32); await invoke();
    const result=(await rows('ssx_sync_checkpoints'))[0].result;
    vi.stubGlobal('fetch',vi.fn(async()=>{state.fetches++;return new Response('',{status:429,headers:{'Retry-After':'7200'}});}));
    expect((await invoke()).body.code).toBe('rate_limited:7200');
    expect((await rows('ssx_sync_checkpoints'))[0].result).toEqual(result);
    expect((await rows('ssx_rule_violation_cursors'))[0]).toMatchObject({last_position_id:16,last_error_code:'rate_limited:7200'});
    expect((await invoke(1)).body).toMatchObject({status:'deferred',requests:0});
    await state.db!.exec("update ssx_sync_checkpoints set retry_at=clock_timestamp()-interval '1 second';update ssx_rule_violation_cursors set updated_at=clock_timestamp()-interval '3 hours'");
    await densePositions(32);
    expect((await invoke()).body).toMatchObject({status:'success',upserted:7984});
    expect(await rows('ssx_rule_violations')).toHaveLength(15968);
  },30000);
  it('rolls back earlier batches when an item in a later batch raises',async()=>{
    await densePositions(16);
    await state.db!.exec("create function qa_late_batch() returns trigger language plpgsql as $$begin if new.provider_violation_id=7001 then raise exception 'qa_batch_failure';end if;return new;end$$;create trigger qa_late_batch before insert or update on ssx_rule_violations for each row execute function qa_late_batch()");
    expect(await invoke()).toMatchObject({status:502,body:{code:'persistence_failed'}});
    expect(state.lastRpcError).toBe('qa_batch_failure');
    expect(await rows('ssx_rule_violations')).toHaveLength(0);
    expect((await rows('ssx_rule_violation_cursors'))[0].last_position_id).toBe(0);
    expect((await rows('ssx_sync_checkpoints'))[0]).toMatchObject({status:'failed',result:{}});
  },30000);
  it('rolls back all batches and cursor when the lease expires inside SQL',async()=>{
    await densePositions(16);
    await state.db!.exec("create function qa_late_batch() returns trigger language plpgsql as $$begin if new.provider_violation_id=7001 then update public.ssx_sync_checkpoints set lease_until=clock_timestamp()-interval '1 second';end if;return new;end$$;create trigger qa_late_batch before insert or update on ssx_rule_violations for each row execute function qa_late_batch()");
    expect(await invoke()).toMatchObject({status:502,body:{code:'persistence_failed'}});
    expect(state.lastRpcError).toBe('ssx_violation_lease_lost');
    expect(await rows('ssx_rule_violations')).toHaveLength(0);
    expect((await rows('ssx_rule_violation_cursors'))[0].last_position_id).toBe(0);
    expect((await rows('ssx_sync_checkpoints'))[0].result).toEqual({});
  },30000);
  it('retains the pending page and makes no provider call if checkpoint reads fail',async()=>{
    await densePositions(32);await invoke();const before=(await rows('ssx_sync_checkpoints'))[0].result;
    state.checkpointReadFailure=true;const count=state.fetches;
    expect(await invoke()).toMatchObject({status:502,body:{code:'checkpoint_read_failed'}});
    expect(state.fetches).toBe(count);
    expect((await rows('ssx_sync_checkpoints'))[0].result).toEqual(before);
    expect(await rows('ssx_rule_violations')).toHaveLength(7984);
  },30000);
  it.each(['anon','authenticated'])('denies the new v3 RPC to %s',async role=>{
    const token=await claim();
    await expect(sqlRole("select commit_ssx_rule_violation_window_v3($1,$2,0,10,10,'[]',clock_timestamp())",[ids[0],token],role)).rejects.toMatchObject({code:'42501'});
    expect(await rows('ssx_rule_violations')).toHaveLength(0);
  });
  it('preserves the invoker/search-path/service-only contract and rejects cross-account lease tokens',async()=>{
    const token=await claim(ids[0]);await claim(ids[1]);
    const result=(await sqlRole("select commit_ssx_rule_violation_window_v3($1,$2,0,10,10,'[]',clock_timestamp()) value",[ids[1],token])).rows[0].value;
    expect(result).toEqual({committed:false,upserted:0});
    expect((await rows('ssx_rule_violation_cursors')).map(row=>row.last_position_id)).toEqual([0,0]);
    const catalog=(await state.db!.query<Row>("select prosecdef,proconfig,proacl::text from pg_proc where proname='commit_ssx_rule_violation_window_v3'")).rows[0];
    expect(catalog.prosecdef).toBe(false);expect(catalog.proconfig).toEqual(['search_path=""']);
    expect(catalog.proacl).toContain('service_role=X/');expect(catalog.proacl).not.toMatch(/anon=|authenticated=|\{=/);
  });
  it.each(['too_many','too_large'])('rejects %s before any durable effect',async mode=>{
    const token=await claim();const before=await rows('ssx_sync_checkpoints');
    const items=mode==='too_many'?Array.from({length:8001},(_,i)=>({provider_violation_id:i+1,payload:{}})):[{provider_violation_id:1,payload:{text:'x'.repeat(8388608)}}];
    await expect(sqlRole('select commit_ssx_rule_violation_window_v3($1,$2,0,10,10,$3::jsonb,clock_timestamp())',[ids[0],token,JSON.stringify(items)])).rejects.toMatchObject({code:'22023'});
    expect(await rows('ssx_sync_checkpoints')).toEqual(before);expect(await rows('ssx_rule_violations')).toHaveLength(0);
  });
});
