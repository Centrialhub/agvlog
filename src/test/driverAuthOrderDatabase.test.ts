// @vitest-environment node
// Modeled GoTrue transaction order on isolated PostgreSQL; native Auth acceptance remains required.
import { PGlite } from '@electric-sql/pglite';
import { afterEach,describe,expect,it } from 'vitest';
import { assertNativeBodyPins,beforeRepair,counts,fixedAppMeta,gotrueTransaction,graph,id,nonce,
  prepare,providers,roleQuery,setupFullGraph,sibling } from './helpers/driverAuthOrderFixture';
let db:PGlite;
afterEach(async()=>{await db?.close();});
const empty={auth:0,profiles:0,tenants:0,workspaces:0,drivers:0};
async function setup(multiple=false){db=await setupFullGraph(multiple);await assertNativeBodyPins(db);}
async function ledger(){return (await db.query('select email,driver_id from private.auth_invite_authorizations')).rows;}
describe('M5 native Auth INSERT order, actual SAFE triggers and guarded BEFORE repair',()=>{
  it('reproduces the provider-only INSERT failure before repair and leaves zero Auth/profile/membership orphan',async()=>{
    await setup();await prepare(db);
    await expect(gotrueTransaction(db)).rejects.toThrow('driver_accounts_require_username_creation');
    expect(await counts(db)).toEqual(empty);expect(await ledger()).toHaveLength(1);
  },30_000);
  it.each([false,true])('derives before INSERT with same-workspace second company=%s, preserves graph and nonce',async multiple=>{
    await setup(multiple);const before=await graph(db);await db.exec(beforeRepair);
    expect(await graph(db)).toEqual(before);await assertNativeBodyPins(db);
    await prepare(db);const inserted=await gotrueTransaction(db);
    expect(inserted).toMatchObject({raw_app_meta_data:{...providers,...fixedAppMeta},
      raw_user_meta_data:{full_name:'Synthetic Driver'}});
    expect(await counts(db)).toMatchObject({auth:1,profiles:1,tenants:1,drivers:1});
    expect((await db.query('select tenant_id,role,active from tenant_memberships where user_id=$1',[id.newUser])).rows)
      .toEqual([{tenant_id:id.tenant,role:'driver',active:true}]);
    if(multiple) expect((await db.query('select count(*)::int n from tenant_memberships where tenant_id=$1 and user_id=$2',
      [sibling,id.newUser])).rows).toEqual([{n:0}]);
    expect(await ledger()).toEqual([]);await db.exec(beforeRepair);expect(await graph(db)).toEqual(before);
  },30_000);
  it('rejects direct foreign company/workspace and demonstrates guarded top-level sync fanout without weakening it',async()=>{
    await setup(true);await db.exec(beforeRepair);await prepare(db);await gotrueTransaction(db);
    await expect(roleQuery(db,'service_role',`insert into tenant_memberships(tenant_id,user_id,role,active)
      values($1,$2,'driver',true)`,[sibling,id.newUser])).rejects.toThrow('managed_driver_invalid_membership');
    await expect(roleQuery(db,'service_role',`insert into workspace_memberships(workspace_id,user_id,role,active)
      values($1,$2,'driver',true)`,[id.otherWorkspace,id.newUser])).rejects.toThrow('managed_driver_invalid_workspace');
    // Historical sync at top-level fans out across every company in a workspace.
    // Guard must reject it atomically; this does NOT authorize changing sync/depth.
    await expect(roleQuery(db,'service_role',`insert into workspace_memberships(workspace_id,user_id,role,active)
      values($1,$2,'driver',true)`,[id.workspace,id.newUser])).rejects.toThrow('managed_driver_invalid_membership');
    expect((await db.query('select count(*)::int n from workspace_memberships where user_id=$1',[id.newUser])).rows)
      .toEqual([{n:0}]);
  },30_000);
  it.each([
    {driver_username_managed:false},
    {driver_username_managed:true,driver_access_tenant_id:id.otherTenant},
  ])('rejects contradictory initial app metadata %j before overwriting',async claimed=>{
    await setup();await db.exec(beforeRepair);await prepare(db);
    await expect(gotrueTransaction(db,{initial:{...providers,...claimed}})).rejects.toThrow('invalid_driver_account');
    expect(await counts(db)).toEqual(empty);expect(await ledger()).toHaveLength(1);
  },30_000);
  it('does not authorize a driver by self-declared user/app metadata without a trusted driver reservation',async()=>{
    await setup();await db.exec(beforeRepair);
    await expect(gotrueTransaction(db,{initial:{...providers,...fixedAppMeta}})).rejects.toMatchObject({code:'28000'});
    expect(await counts(db)).toEqual(empty);
  },30_000);
  it.each(['nonce','ttl','admin','driver','tenant'])('rejects %s drift before Auth persists and retains reservation',async kind=>{
    await setup();await db.exec(beforeRepair);await prepare(db);
    if(kind==='ttl') await db.exec(`update private.auth_invite_authorizations
      set created_at=now()-interval '20 minutes',expires_at=now()-interval '1 minute'`);
    if(kind==='admin') await db.query('update tenant_memberships set active=false where user_id=$1',[id.admin]);
    if(kind==='driver') await db.query('update drivers set active=false where id=$1',[id.freeDriver]);
    if(kind==='tenant') await db.query('update private.auth_invite_authorizations set tenant_id=$1',[id.otherTenant]);
    await expect(gotrueTransaction(db,{reservation:kind==='nonce'?'wrong-but-long-synthetic-nonce-000000':nonce})).rejects.toThrow();
    expect(await counts(db)).toEqual(empty);expect(await ledger()).toHaveLength(1);
  },30_000);
  it('rolls back INSERT+profiles+link+consumption when the later transaction fails, then retries and denies replay',async()=>{
    await setup();await db.exec(beforeRepair);await prepare(db);
    await expect(gotrueTransaction(db,{failAfterUpdate:true})).rejects.toMatchObject({code:'22012'});
    expect(await counts(db)).toEqual(empty);expect(await ledger()).toHaveLength(1);
    await gotrueTransaction(db);expect(await ledger()).toEqual([]);
    await expect(gotrueTransaction(db,{user:id.replayUser})).rejects.toMatchObject({code:'28000'});
    expect(await counts(db,id.replayUser)).toEqual(empty);
  },30_000);
  it.each(['operator','client'])('preserves provider-only %s invitations without deriving driver authority',async role=>{
    await setup();await db.exec(beforeRepair);
    const login=`qa.${role}@example.test`;
    await roleQuery(db,'service_role',`select public.prepare_auth_invite_v2($1,$2,$3,$4,$5::app_role,$6,$7)`,
      [login,id.tenant,id.admin,nonce,role,role==='client'?id.client:null,role==='client'?'full':null]);
    const initial=await gotrueTransaction(db,{login,serverAppMeta:null});
    expect(initial.raw_app_meta_data).toEqual(providers);
    if(role==='operator') expect((await db.query('select role from tenant_memberships where user_id=$1',[id.newUser])).rows)
      .toEqual([{role:'operator'}]);
    else expect((await db.query('select client_id from client_portal_access where user_id=$1',[id.newUser])).rows)
      .toEqual([{client_id:id.client}]);
    expect((await db.query('select count(*)::int n from drivers where user_id=$1',[id.newUser])).rows).toEqual([{n:0}]);
  },30_000);
  it('rejects BEFORE ACL/trigger drift without altering the driver graph',async()=>{
    await setup();const before=await graph(db);
    await db.exec('grant execute on function private.enforce_invite_only_auth_user() to service_role');
    await expect(db.exec(beforeRepair)).rejects.toThrow('metadata_or_acl_changed');
    await db.exec('revoke execute on function private.enforce_invite_only_auth_user() from service_role');
    expect(await graph(db)).toEqual(before);
    await db.exec('alter table auth.users disable trigger enforce_invite_only_before_auth_user_created');
    await expect(db.exec(beforeRepair)).rejects.toThrow('trigger_changed');
  },30_000);
  it('rejects a changed BEFORE predecessor instead of accepting an unapproved body',async()=>{
    await setup();
    await db.exec(`create or replace function private.enforce_invite_only_auth_user()
      returns trigger language plpgsql security definer set search_path='' as $$begin return new;end$$`);
    const before=await graph(db);
    await expect(db.exec(beforeRepair)).rejects.toThrow('body_changed');
    expect(await graph(db)).toEqual(before);
  },30_000);
});
