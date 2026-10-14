// @vitest-environment node
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
type Row=Record<string,unknown>;
type Handler=(request:Request)=>Promise<Response>;
const ids=['40000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002'];
const state=vi.hoisted(()=>({db:null as PGlite|null,handler:null as Handler|null,cron:true,
  authenticated:true,role:'owner',workspace:false,contextDenied:false,capabilityDenied:false,
  readError:false,reads:[] as string[],rpcCalls:0,fetches:0}));
vi.mock('../../supabase/functions/_shared/cron-auth.ts',()=>({isCronRequest:async()=>state.cron}));
vi.mock('../../supabase/functions/_shared/capabilities.ts',()=>({
  requireIntegrationCapability:async()=>state.capabilityDenied?Response.json({error:'Forbidden'},{status:403}):null,
}));
vi.mock('../../supabase/functions/_shared/ssx-utils.ts',async importOriginal=>({
  ...await importOriginal<Record<string,unknown>>(),
  requireWorkspaceAccountContext:async()=>state.contextDenied?Response.json({error:'Wrong workspace context'},{status:403}):null,
  getTenantRole:async()=>state.role,getWorkspaceRoleForAccount:async()=>state.role,
}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({
  auth:{getUser:async()=>({data:{user:state.authenticated?{id:'synthetic-caller'}:null},error:null})},
  rpc:async()=>{state.rpcCalls++;throw Error('Return artifact must never mutate SQL');},
  from:(table:string)=>{
    if(!['integration_accounts','ssx_sync_checkpoints','ssx_rule_violation_cursors'].includes(table))throw Error('Unexpected table '+table);
    const filters:Record<string,string>={};
    const query={select:()=>query,eq:(key:string,value:string)=>{filters[key]=value;return query;},
      single:async()=>({data:ids.includes(filters.id)?{id:filters.id,tenant_id:filters.id,workspace_id:state.workspace?'synthetic-workspace':null}:null,error:null}),
      maybeSingle:async()=>{
        state.reads.push(table);
        if(state.readError)return {data:null,error:{message:'synthetic-read-failure'}};
        const checkpoint=table==='ssx_sync_checkpoints';
        const sql=checkpoint?'select status,lease_until,retry_at from ssx_sync_checkpoints where integration_account_id=$1 and resource=$2 and scope_key=$3'
          :'select last_error_code,updated_at from ssx_rule_violation_cursors where integration_account_id=$1';
        const args=checkpoint?[filters.integration_account_id,filters.resource,filters.scope_key]:[filters.integration_account_id];
        return {data:JSON.parse(JSON.stringify((await state.db!.query<Row>(sql,args)).rows[0]??null)),error:null};
      },
    };return query;
  },
})}));
beforeAll(async()=>{
  state.db=new PGlite();
  await state.db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema ssx_private;grant usage on schema public,ssx_private to service_role;create table integration_accounts(id uuid primary key,provider text not null);create table positions_raw(id bigint generated always as identity primary key,integration_account_id uuid references integration_accounts(id),telemetry jsonb);grant select on integration_accounts,positions_raw to service_role");
  for(const migration of ['20260910163922_add_ssx_governance_and_violations.sql','20260924143248_add_ssx_sync_checkpoints.sql','20261007122904_fence_ssx_rule_violation_finalization.sql','20261007131504_add_bounded_ssx_violation_commit_v3.sql']) {
    await state.db.exec(readFileSync('supabase/migrations/'+migration,'utf8'));
  }
  for(const account of ids)await state.db.query("insert into integration_accounts values($1,'SSX')",[account]);
  vi.stubGlobal('Deno',{env:{get:()=> 'SYNTHETIC_ONLY'},serve:(handler:Handler)=>state.handler=handler});
  const path='../../supabase/functions/ssx-sync-rule-violations/return-gate-aware.ts';await import(path);
},30000);
afterAll(async()=>{await state.db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
  await state.db!.exec('truncate ssx_sync_checkpoints,ssx_rule_violation_cursors,ssx_rule_violations');
  Object.assign(state,{cron:true,authenticated:true,role:'owner',workspace:false,contextDenied:false,
    capabilityDenied:false,readError:false,reads:[],rpcCalls:0,fetches:0});
  vi.stubGlobal('fetch',vi.fn(async()=>{state.fetches++;throw Error('No real or synthetic provider I/O on return');}));
});
afterEach(async()=>{
  vi.restoreAllMocks();await state.db!.exec('drop trigger if exists qa_ack_failure on ssx_rule_violation_cursors;drop function if exists qa_ack_failure()');
});
async function roleQuery(sql:string,args:unknown[]=[]) {
  return state.db!.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query<Row>(sql,args);});
}
async function claimed(account=ids[0]) {
  await roleQuery('select * from get_ssx_rule_violation_window_v1($1,500,1000)',[account]);
  return (await roleQuery("select claim_ssx_sync_checkpoint_v1($1,'rule_violations_gate','',0) value",[account])).rows[0].value as Row;
}
async function invoke(account=ids[0],authorization?:string) {
  const response=await state.handler!(new Request('https://edge.invalid',{method:'POST',
    body:JSON.stringify({integration_account_id:account}),headers:authorization?{Authorization:authorization}:{}}));
  return {status:response.status,body:await response.json() as Row};
}
async function snapshot() {
  const result:Row={};
  for(const table of ['ssx_sync_checkpoints','ssx_rule_violation_cursors','ssx_rule_violations']) {
    result[table]=(await state.db!.query<Row>('select * from '+table+' order by integration_account_id')).rows;
  }return result;
}
async function assertReadOnly(expected:Row,account=ids[0]) {
  const before=await snapshot();const reply=await invoke(account);
  expect(reply).toMatchObject({status:200,body:{status:'deferred',paused:true,requests:0,upserted:0,...expected}});
  expect(await snapshot()).toEqual(before);expect(state.rpcCalls).toBe(0);expect(state.fetches).toBe(0);
  return reply.body;
}
describe('sealed gate-aware paused return entrypoint with real SQL state',()=>{
  it('honors checkpoint-only 7200s after the failure ACK rolled back and fallback finish succeeded',async()=>{
    const gate=await claimed();
    await state.db!.exec("create function qa_ack_failure() returns trigger language plpgsql as $$begin if new.last_error_code is not null then raise exception 'qa_ack_failure';end if;return new;end$$;create trigger qa_ack_failure before update on ssx_rule_violation_cursors for each row execute function qa_ack_failure()");
    await expect(roleQuery("select fail_ssx_rule_violation_window_v2($1,$2,0,10,'rate_limited:7200',7200)",[ids[0],gate.lease_token])).rejects.toThrow('qa_ack_failure');
    expect((await roleQuery("select finish_ssx_sync_checkpoint_v1($1,'rule_violations_gate','',$2,'{}','rate_limited',7200) value",[ids[0],gate.lease_token])).rows[0].value).toBe(true);
    expect((await state.db!.query<Row>('select last_error_code from ssx_rule_violation_cursors')).rows[0].last_error_code).toBeNull();
    const reply=await assertReadOnly({reason:'rate_limited_backoff'});
    expect(Number(reply.retry_after_seconds)).toBeGreaterThanOrEqual(7198);expect(Number(reply.retry_after_seconds)).toBeLessThanOrEqual(7200);
  });
  it('honors cursor-only 7200s',async()=>{
    await claimed();await state.db!.exec("delete from ssx_sync_checkpoints;update ssx_rule_violation_cursors set last_error_code='rate_limited:7200',updated_at=clock_timestamp()");
    const reply=await assertReadOnly({reason:'rate_limited_backoff'});expect(Number(reply.retry_after_seconds)).toBeGreaterThanOrEqual(7198);
  });
  it('uses the later checkpoint/cursor cooldown',async()=>{
    const gate=await claimed();await roleQuery("select finish_ssx_sync_checkpoint_v1($1,'rule_violations_gate','',$2,'{}','rate_limited',7200)",[ids[0],gate.lease_token]);
    await state.db!.exec("update ssx_rule_violation_cursors set last_error_code='rate_limited:14400',updated_at=clock_timestamp()");
    const reply=await assertReadOnly({reason:'rate_limited_backoff'});expect(Number(reply.retry_after_seconds)).toBeGreaterThanOrEqual(14398);
  });
  it('retains the active lease without claiming or releasing it',async()=>{
    await claimed();const reply=await assertReadOnly({reason:'sync_in_progress'});
    expect(Number(reply.retry_after_seconds)).toBeGreaterThanOrEqual(88);expect(Number(reply.retry_after_seconds)).toBeLessThanOrEqual(90);
  });
  it('remains paused after all deadlines expire and preserves continuation metadata',async()=>{
    await claimed();await state.db!.exec("update ssx_sync_checkpoints set lease_until=clock_timestamp()-interval '1 second',retry_at=clock_timestamp()-interval '1 second',result='{\"version\":3,\"cursor_position_id\":\"16\",\"resume_position_id\":\"17\",\"window_end_position_id\":\"32\"}';update ssx_rule_violation_cursors set last_error_code='rate_limited:7200',updated_at=clock_timestamp()-interval '3 hours'");
    await assertReadOnly({reason:'rollback_paused',retry_after_seconds:0});await assertReadOnly({reason:'rollback_paused'});
  });
  it('keeps accounts separate when only the other account has an active lease',async()=>{
    await claimed(ids[1]);await assertReadOnly({reason:'rollback_paused'},ids[0]);await assertReadOnly({reason:'sync_in_progress'},ids[1]);
  });
  it('fails closed on state-read failure without mutations or provider calls',async()=>{
    await claimed();state.readError=true;const before=await snapshot();
    expect(await invoke()).toMatchObject({status:502,body:{code:'rollback_state_unavailable'}});
    expect(await snapshot()).toEqual(before);expect(state.rpcCalls).toBe(0);expect(state.fetches).toBe(0);
  });
  it.each(['missing','invalid'])('rejects %s manual authentication before privileged state reads',async mode=>{
    state.cron=false;state.authenticated=false;
    expect((await invoke(ids[0],mode==='invalid'?'Bearer synthetic-invalid':undefined)).status).toBe(401);
    expect(state.reads).toEqual([]);expect(state.rpcCalls).toBe(0);
  });
  it.each(['operator','wrong_tenant','wrong_workspace','capability'])('rejects %s before privileged state reads',async reason=>{
    state.cron=false;
    if(reason==='operator')state.role='operator';
    if(reason==='wrong_tenant')state.role='';
    if(reason==='wrong_workspace'){state.workspace=true;state.contextDenied=true;}
    if(reason==='capability')state.capabilityDenied=true;
    expect((await invoke(ids[0],'Bearer synthetic-valid')).status).toBe(403);
    expect(state.reads).toEqual([]);expect(state.rpcCalls).toBe(0);expect(state.fetches).toBe(0);
  });
  it('allows an authorized workspace admin only to observe the paused gate',async()=>{
    state.cron=false;state.workspace=true;state.role='admin';
    const before=await snapshot();expect((await invoke(ids[0],'Bearer synthetic-valid')).body).toMatchObject({status:'deferred',paused:true});
    expect(await snapshot()).toEqual(before);expect(state.rpcCalls).toBe(0);expect(state.fetches).toBe(0);
  });
});
