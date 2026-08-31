// @vitest-environment node
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { createTripLoadDatabase,tripLoadCandidateSql,tripLoadRolloutContracts } from './helpers/tripLoadDatabase';

const recovery=readFileSync('docs/qa/TRIP-LOAD-RECOVERY-2026-08-30.sql','utf8');
const helpers=['guard_trip_load_link_graph','enforce_load_transit_requires_started_trip',
  '_assert_load_transit_graph','enforce_trip_load_graph_consistency'];
const tenant='20000000-0000-4000-8000-000000000001';
const user='10000000-0000-4000-8000-000000000003';
const driver='60000000-0000-4000-8000-000000000001';
const trip='80000000-0000-4000-8000-000000000001';
const load='81000000-0000-4000-8000-000000000001';
let db:PGlite;
beforeEach(async()=>{db=await createTripLoadDatabase({candidate:false});},30000);
afterEach(async()=>{await db?.exec('rollback');await db?.close();});

async function contracts(){
  return (await db.query(`select p.oid::regprocedure::text signature,
    md5(replace(pg_get_functiondef(p.oid),E'\\r\\n',E'\\n')) hash,
    obj_description(p.oid,'pg_proc') comment,
    has_function_privilege('anon',p.oid,'EXECUTE') anon,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_role
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname=any($1::text[]) order by signature`,[
    [...helpers,...tripLoadRolloutContracts.functions.map(f=>f.signature.split('(')[0])],
  ])).rows;
}
async function mirror(){return (await db.query(`select pg_get_triggerdef(oid) definition from pg_trigger
  where tgrelid='public.dispatch_trip_loads'::regclass and tgname='trg_sync_trip_load_mirrors'`)).rows;}
async function businessState(){return (await db.query(`select jsonb_build_object(
  'loads',(select jsonb_agg(to_jsonb(l) order by id) from loads l),
  'trips',(select jsonb_agg(to_jsonb(t) order by id) from dispatch_trips t),
  'links',(select jsonb_agg(to_jsonb(t) order by id) from dispatch_trip_loads t),
  'events',(select jsonb_agg(to_jsonb(t) order by id) from dispatch_events t),
  'history',(select jsonb_agg(to_jsonb(t)) from load_status_history t)) state`)).rows;}
async function expectOriginal(){
  expect(await contracts()).toEqual(tripLoadRolloutContracts.functions.map(({signature,hash,comment,anon,authenticated,service_role})=>
    ({signature,hash,comment,anon,authenticated,service_role})).sort((a,b)=>a.signature.localeCompare(b.signature)));
  expect(await mirror()).toEqual([{definition:tripLoadRolloutContracts.mirror_trigger}]);
}
async function failedRecovery(pattern:RegExp){
  const before=await contracts();const trigger=await mirror();const state=await businessState();
  await expect(db.exec(recovery)).rejects.toThrow(pattern);
  await db.exec('rollback');
  expect(await contracts()).toEqual(before);expect(await mirror()).toEqual(trigger);
  expect(await businessState()).toEqual(state);
}

describe('trip/load guarded rollout and recovery in PostgreSQL',()=>{
  it('starts from the captured definitions, comments, privileges and mirror trigger',expectOriginal);
  it('applies, recovers exactly and reapplies without removing departure/history or changing timestamps',async()=>{
    await db.exec(tripLoadCandidateSql);
    await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',user]);
    await db.exec("set test.operator='true'");
    await db.query('insert into drivers values($1,$2,$3,true)',[driver,tenant,user]);
    await db.query("insert into dispatch_trips(id,tenant_id,driver_id,status) values($1,$2,$3,'planned')",[trip,tenant,driver]);
    await db.query("insert into loads(id,tenant_id,status) values($1,$2,'ready')",[load,tenant]);
    await db.query('insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)',[tenant,trip,load]);
    await db.query("select public.transition_load_status_v1($1,$2,'loading','QA local')",[tenant,load]);
    await db.exec('set role authenticated');await db.query('select public.driver_start_trip($1)',[trip]);await db.exec('reset role');
    const before=await businessState();
    await db.exec(recovery);await expectOriginal();expect(await businessState()).toEqual(before);
    await db.exec(tripLoadCandidateSql);
    const result=await db.query<{result:{changed:boolean}}>('select public.driver_start_trip($1) result',[trip]);
    expect(result.rows[0].result.changed).toBe(false);
    expect(await businessState()).toEqual(before);
    expect((await db.query('select count(*)::int count from dispatch_events')).rows).toEqual([{count:1}]);
    expect((await db.query('select count(*)::int count from load_status_history')).rows).toEqual([{count:1}]);
  });
  it.each([
    ['alter function public.driver_start_trip(uuid) set search_path=public','legacy contract changed'],
    ['grant execute on function public.driver_start_trip(uuid) to anon','legacy privileges changed'],
    ['alter table public.dispatch_trip_loads disable trigger trg_sync_trip_load_mirrors','legacy mirror trigger changed'],
    ['create trigger enforce_load_transit_graph_at_commit after update on public.loads for each row execute function public.sync_trip_load_mirrors()','invariant trigger already exists'],
    ['create function public._assert_load_transit_graph(uuid) returns void language sql as $$select$$','invariant helper already exists'],
  ])('refuses candidate preflight after unexpected DDL: %s',async(sql,message)=>{
    await db.exec(sql);const before=await contracts();const trigger=await mirror();
    await expect(db.exec(tripLoadCandidateSql)).rejects.toThrow(message);
    await db.exec('rollback');expect(await contracts()).toEqual(before);expect(await mirror()).toEqual(trigger);
  });
  it.each([
    ['alter function public.driver_start_trip(uuid) set search_path=public',/unknown function/],
    ['grant execute on function public._assert_load_transit_graph(uuid) to anon',/privileges changed/],
    ['alter table public.loads disable trigger enforce_load_transit_graph_at_commit',/trigger changed/],
    ['drop trigger trg_sync_trip_load_mirrors on public.dispatch_trip_loads; create trigger trg_sync_trip_load_mirrors after insert on public.dispatch_trip_loads for each row execute function public.sync_trip_load_mirrors()',/trigger changed/],
  ])('refuses recovery without partial restoration after: %s',async(sql,message)=>{
    await db.exec(tripLoadCandidateSql);await db.exec(sql);await failedRecovery(message);
  });
  it('rolls back the entire recovery if an unexpected dependent trigger prevents helper removal',async()=>{
    await db.exec(tripLoadCandidateSql);
    await db.exec('create trigger qa_unexpected_dependency after update on public.loads for each row execute function public.enforce_trip_load_graph_consistency()');
    await failedRecovery(/depend/);
    expect((await db.query("select count(*)::int count from pg_trigger where tgname='guard_trip_load_link_graph'")).rows).toEqual([{count:1}]);
  });
  it('does not contain business data deletion or cascading removal',()=>{
    // DELETE inside the captured mirror is trigger behavior, not a data cleanup.
    expect(recovery).not.toMatch(/\b(?:truncate|delete\s+from|drop[^;]+cascade)\b/i);
    expect(recovery.trim()).toMatch(/commit;$/);
  });
});
