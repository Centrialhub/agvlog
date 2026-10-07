// @vitest-environment node
// Supplemental WORKSPACE DRAFT; no prior closed draft is overwritten.
import { PGlite } from '@electric-sql/pglite';
import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { applyDriverForward,id,roleQuery,scope,setupDriverGraph } from './helpers/driverAccessDatabaseFixture';
let db:PGlite;
beforeEach(async()=>{db=await setupDriverGraph();},30_000);
afterEach(async()=>{await db?.close();});
const apply=async()=>{await applyDriverForward(db);};
describe('M5 supplement: inactive discovery marker without inactive scope bypass',()=>{
  it('retains an inactive orphan membership for legacy-list discovery/retry and allows its own workspace marker',async()=>{
    await apply();
    expect((await db.query("select md5(prosrc) hash from pg_proc where oid='private.guard_driver_account_scope_v1()'::regprocedure")).rows).toEqual([{hash:'ffb3e58ae5f4915a997cf1b26fe587ad'}]);
    await scope(db,id.orphan,true);
    expect((await db.query('select tenant_id,user_id,role,active from tenant_memberships where user_id=$1',[id.orphan])).rows)
      .toEqual([{tenant_id:id.tenant,user_id:id.orphan,role:'driver',active:false}]);
    expect((await roleQuery<{user_id:string}>(db,'service_role',
      "select user_id from tenant_memberships where tenant_id=$1 and role='driver' order by user_id",[id.tenant])).rows)
      .toContainEqual({user_id:id.orphan});
    expect((await scope(db,id.orphan,true)).rows[0].value).toMatchObject({retired:true,deleted:false,active:false});
    await roleQuery(db,'service_role',`insert into workspace_memberships(workspace_id,user_id,role,active)
      values($1,$2,'driver',false)`,[id.workspace,id.orphan]);
    expect((await db.query('select role,active from workspace_memberships where user_id=$1',[id.orphan])).rows)
      .toEqual([{role:'driver',active:false}]);
    expect((await db.query('select user_id from drivers where id=$1',[id.orphanDriver])).rows).toEqual([{user_id:null}]);
  });
  it.each([{}, {driver_access_tenant_id:id.otherTenant}])('rejects malformed provenance %j without inventing membership',async marker=>{
    await db.query('update auth.users set raw_app_meta_data=$1::jsonb where id=$2',
      [{driver_access_retired:true,...marker},id.orphan]);
    await db.query('update drivers set user_id=null where id=$1',[id.orphanDriver]);
    await apply();
    await expect(scope(db,id.orphan,true)).rejects.toThrow('shared_or_other_role');
    expect((await db.query('select count(*)::int n from tenant_memberships where user_id=$1',[id.orphan])).rows)
      .toEqual([{n:0}]);
  });
  it.each([
    ["update tenant_memberships set role='admin' where user_id=$1",[id.orphan]],
    ["insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'driver',false)",[id.otherTenant,id.orphan]],
    ["insert into workspace_memberships(workspace_id,user_id,role,active) values($1,$2,'driver',false)",[id.otherWorkspace,id.orphan]],
    ["insert into client_portal_access(tenant_id,user_id,client_id,access_type,active) values($1,$2,$3,'full',false)",
      [id.tenant,id.orphan,id.client]],
  ] as const)('denies retired inactive promotion/sharing/portal: %s',async(query,params)=>{
    await apply();await scope(db,id.orphan,true);
    await expect(roleQuery(db,'service_role',query,[...params])).rejects.toThrow('driver_account_retired');
    expect((await scope(db,id.orphan)).rows[0].value).toMatchObject({retired:true,active:false});
  });
  it('preserves inactive updates for an unrelated deleted operator with no managed/retired marks',async()=>{
    await db.query('update tenant_memberships set active=false where user_id=$1',[id.operator]);
    await db.query('update auth.users set deleted_at=now() where id=$1',[id.operator]);
    await apply();
    await roleQuery(db,'service_role',"update tenant_memberships set role='admin' where user_id=$1",[id.operator]);
    expect((await db.query('select role,active from tenant_memberships where user_id=$1',[id.operator])).rows)
      .toEqual([{role:'admin',active:false}]);
  });
});
