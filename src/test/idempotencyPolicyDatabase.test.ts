// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createIdempotencyPolicyDatabase,idempotencyPolicySql,idempotencyPolicyContract,
  idempotencyIds as i,seedIdempotencyPolicy} from './helpers/idempotencyPolicyDatabase';

let db:PGlite;
const recovery=readFileSync('docs/qa/IDEMPOTENCY-RLS-RECOVERY-2026-08-30.sql','utf8');
const liveProbe=readFileSync('docs/qa/IDEMPOTENCY-RLS-POSTDEPLOY-PROBE-2026-08-30.sql','utf8');
beforeAll(async()=>{db=await createIdempotencyPolicyDatabase();},30000);
beforeEach(async()=>{await seedIdempotencyPolicy(db);});
afterAll(async()=>{await db?.close();});
const keys=async()=>(await db.query<{key_value:string}>('select key_value from public.idempotency_keys order by key_value')).rows;
const policyHash=async()=>(await db.query<{hash:string}>(`select md5(replace(pg_get_expr(polqual,polrelid),E'\\r\\n',E'\\n')) hash
  from pg_policy where polrelid='public.idempotency_keys'::regclass and polname='agvlog_select_authenticated'`)).rows[0].hash;
const clients=async()=>(await db.query(`select p.oid::regprocedure::text signature,md5(pg_get_functiondef(p.oid)) hash,p.proacl::text acl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in('create_load_v1','plan_dispatch_trip_v2','plan_dispatch_trip_v3') order by signature`)).rows;
async function authenticated(){await db.exec('set role authenticated');}
async function apply(){await db.exec(idempotencyPolicySql);}

describe('idempotency result SELECT RLS',()=>{
  it('reproduces the legacy cross-tenant read despite an own-profile-only SELECT policy',async()=>{
    expect(await policyHash()).toBe(idempotencyPolicyContract.policy.hash);
    await authenticated();expect(await keys()).toEqual([{key_value:'foreign'},{key_value:'own'}]);
  });
  it.each(['owner','admin','operator'])('allows only the active %s tenant, never the foreign tenant',async role=>{
    await db.query('update tenant_memberships set role=$1 where user_id=$2',[role,i.user]);
    await apply();await authenticated();expect(await keys()).toEqual([{key_value:'own'}]);
  });
  it.each(['driver','viewer','accountant'])('does not expose internal keys to a %s membership',async role=>{
    await db.query('update tenant_memberships set role=$1 where user_id=$2',[role,i.user]);
    await apply();await authenticated();expect(await keys()).toEqual([]);
  });
  it('denies inactive membership even when the user still has a profile and token subject',async()=>{
    await db.query('update tenant_memberships set active=false where user_id=$1',[i.user]);
    await apply();await authenticated();expect(await keys()).toEqual([]);
  });
  it('rechecks membership changes without waiting for JWT renewal',async()=>{
    await apply();await authenticated();expect(await keys()).toEqual([{key_value:'own'}]);
    await db.exec('reset role');await db.query('update tenant_memberships set tenant_id=$1 where user_id=$2',[i.otherTenant,i.user]);
    await authenticated();expect(await keys()).toEqual([{key_value:'foreign'}]);
  });
  it('does not derive authorization from a profile or user-supplied tenant setting',async()=>{
    await db.query('delete from tenant_memberships where user_id=$1',[i.user]);
    await db.query('select set_config($1,$2,false)',['request.jwt.claim.tenant_id',i.otherTenant]);
    await apply();await authenticated();expect(await keys()).toEqual([]);
  });
  it('allows multiple active operator memberships but no other tenant',async()=>{
    await db.query("insert into tenant_memberships values($1,$2,true,'admin')",[i.user,i.otherTenant]);
    await apply();await authenticated();expect(await keys()).toEqual([{key_value:'foreign'},{key_value:'own'}]);
  });
  it('requires a subject and preserves anonymous table denial',async()=>{
    await apply();await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub','']);
    await authenticated();expect(await keys()).toEqual([]);
    await db.exec('reset role;set role anon');await expect(keys()).rejects.toMatchObject({code:'42501'});
  });
  it('preserves backend service access and changes neither consumer bodies nor ACLs',async()=>{
    const before=await clients();await apply();expect(await clients()).toEqual(before);
    await db.exec('set role service_role');expect(await keys()).toEqual([{key_value:'foreign'},{key_value:'own'}]);
  });
  it('does not add browser write permissions through a SELECT policy',async()=>{
    await apply();await authenticated();
    await expect(db.query("insert into idempotency_keys(tenant_id,key_value) values($1,'forged')",[i.tenant])).rejects.toMatchObject({code:'42501'});
    await db.exec("update idempotency_keys set key_value='changed';delete from idempotency_keys;");
    expect(await keys()).toEqual([{key_value:'own'}]);
  });
  it('keeps the actual operator planner and its idempotent replay functional',async()=>{
    await apply();await authenticated();
    const call=()=>db.query<{trip:string}>(`select public.plan_dispatch_trip_v3($1,'qa-replay',$2,$3,'QA',$4::uuid[],$5::jsonb) trip`,
      [i.tenant,i.driver,i.vehicle,[i.load],JSON.stringify([{destination:'QA',stop_order:1,fiscal_document_ids:[]}])]);
    const first=await call();expect((await call()).rows).toEqual(first.rows);
    expect((await keys()).some(k=>k.key_value==='plan_dispatch_trip:qa-replay')).toBe(true);
    await db.exec('reset role');
    expect((await db.query('select count(*)::int n from dispatch_trips')).rows).toEqual([{n:1}]);
    expect((await db.query('select count(*)::int n from entity_state_audit_log')).rows).toEqual([{n:1}]);
  });
  it.each([
    ['alter policy agvlog_select_authenticated on public.idempotency_keys using(true)','legacy policy changed'],
    ['create policy qa_unexpected_policy on public.idempotency_keys for select to authenticated using(true)','legacy policy changed'],
    ['alter table public.idempotency_keys disable row level security','RLS contract changed'],
    ['alter function public.is_tenant_operator_or_admin(uuid) set search_path=public','membership helper changed'],
  ])('refuses rollout when the destination drifts: %s',async(sql,error)=>{
    await db.exec(sql);const before=await policyHash();
    await expect(apply()).rejects.toThrow(error);await db.exec('rollback');expect(await policyHash()).toBe(before);
  });
  it('recovers and reapplies the policy without changing keys or consumer functions',async()=>{
    const before=await clients();const rows=await keys();await apply();
    await db.exec(recovery);expect(await policyHash()).toBe(idempotencyPolicyContract.policy.hash);
    expect(await keys()).toEqual(rows);expect(await clients()).toEqual(before);
    await authenticated();expect(await keys()).toEqual([{key_value:'foreign'},{key_value:'own'}]);
    await db.exec('reset role');await apply();await authenticated();expect(await keys()).toEqual([{key_value:'own'}]);
  });
  it('refuses to recover a newer or unexpected policy',async()=>{
    await apply();await db.exec('alter policy agvlog_select_authenticated on public.idempotency_keys using(false)');
    await expect(db.exec(recovery)).rejects.toThrow('recovery refused');await db.exec('rollback');
    await authenticated();expect(await keys()).toEqual([]);
  });
  it('rehearses the exact live probe and rolls back its synthetic rows',async()=>{
    await apply();await authenticated();
    await db.query(`select public.plan_dispatch_trip_v3($1,'qa-existing-trip',$2,$3,'QA',$4::uuid[],'[]')`,[i.tenant,i.driver,i.vehicle,[i.load]]);
    await db.exec('reset role');const before=await keys();
    await db.exec(liveProbe);expect(await keys()).toEqual(before);
    expect((await db.query('select count(*)::int n from dispatch_trips')).rows).toEqual([{n:1}]);
  });
});
