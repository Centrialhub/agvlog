// @vitest-environment node
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createReplanningDatabase,replanningCandidateSql,replanningIds as i,seedReplanning,replanningPayload,replan} from './helpers/replanningDatabase';
const recovery=readFileSync('docs/qa/REPLANNING-RECOVERY-2026-08-30.sql','utf8').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
const contracts=JSON.parse(readFileSync('docs/qa/REPLANNING-LOCAL-CONTRACTS-2026-08-30.json','utf8')) as {
  candidate:{signature:string;hash:string;anon:boolean;authenticated:boolean;service_role:boolean}[];
  predecessor:{signature:string;hash:string}[];
};
let db:PGlite;
beforeAll(async()=>{db=await createReplanningDatabase();},30000);
beforeEach(async()=>{await seedReplanning(db);await db.exec('begin');});
afterEach(async()=>{await db.exec('rollback');});
afterAll(async()=>{await db?.close();});
const hash=async(signature:string)=>(await db.query<{hash:string}>("select md5(replace(pg_get_functiondef($1::regprocedure),E'\\r\\n',E'\\n')) hash",['public.'+signature])).rows[0].hash;
const business=async()=>JSON.stringify((await db.query(`select jsonb_build_object(${[
  'loads','load_items','fiscal_documents','dispatch_trips','dispatch_trip_loads','dispatch_stops','dispatch_stop_documents',
  'operational_events','proof_of_delivery','entity_audit_log','driver_settlements','driver_settlement_payments',
].map(t=>`'${t}',(select jsonb_agg(to_jsonb(t) order by id) from public.${t} t)`).join(',')})`)).rows);

describe('replanning guarded local recovery',()=>{
  it('matches the recorded candidate body and ACL contracts',async()=>{
    for(const f of contracts.candidate){
      expect(await hash(f.signature)).toBe(f.hash);
      expect((await db.query("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') service_role",['public.'+f.signature])).rows[0])
        .toEqual({anon:f.anon,authenticated:f.authenticated,service_role:f.service_role});
    }
  });
  it('restores the predecessor before first use and reapplies without changing cargo or evidence',async()=>{
    const before=await business();await db.exec(recovery);
    for(const f of contracts.predecessor)expect(await hash(f.signature)).toBe(f.hash);
    expect((await db.query("select to_regprocedure('public.replan_load_items(jsonb)') api")).rows[0]).toEqual({api:null});
    expect((await db.query("select count(*)::int n from information_schema.columns where table_schema='public' and table_name='idempotency_keys' and column_name='response_body'")).rows[0]).toEqual({n:0});
    expect(await business()).toBe(before);await db.exec(replanningCandidateSql);expect(await business()).toBe(before);
    for(const f of contracts.candidate)expect(await hash(f.signature)).toBe(f.hash);
  });
  it.each([
    ['body',"alter function public.replan_load_items(jsonb) set search_path=public"],
    ['grant',"grant execute on function public.replan_load_items(jsonb) to anon"],
    ['RLS',"alter table public.idempotency_keys disable row level security"],
    ['write policy',"create policy qa_cache_write on public.idempotency_keys for insert to authenticated with check(true)"],
    ['column',"alter table public.idempotency_keys alter column response_body set default '{}'"],
  ])('refuses changed %s before restoring any functions',async(_name,drift)=>{
    await db.exec(drift);await expect(db.exec(recovery)).rejects.toThrow(/Replanning recovery refused/);
  });
  it('refuses after a real successful replanning',async()=>{
    await replan(db,await replanningPayload(db));await expect(db.exec(recovery)).rejects.toThrow(/business usage exists/);
  });
  it('still refuses when an audit exists without its response cache',async()=>{
    await replan(db,await replanningPayload(db));
    // Disposable fixture only: simulate independent cache retention/cleanup.
    await db.exec("delete from public.idempotency_keys where operation='replan_load_items'");
    await expect(db.exec(recovery)).rejects.toThrow(/business usage exists/);
  });
  it('does not remove response_body if another operation has started using it',async()=>{
    await db.query("insert into public.idempotency_keys(tenant_id,key_value,operation,response_body) values($1,'qa-other','other','{}')",[i.tenant]);
    await expect(db.exec(recovery)).rejects.toThrow(/business usage exists/);
  });
  it.each([
    ['RLS disabled',"alter table public.idempotency_keys disable row level security"],
    ['write policy',"create policy qa_cache_write on public.idempotency_keys for insert to authenticated with check(true)"],
    ['missing scoped read',"drop policy agvlog_select_authenticated on public.idempotency_keys"],
  ])('migration refuses %s before installing its response cache',async(_name,drift)=>{
    await db.exec(recovery);await db.exec(drift);
    await expect(db.exec(replanningCandidateSql)).rejects.toThrow(/requires scoped request cache/);
  });
});
