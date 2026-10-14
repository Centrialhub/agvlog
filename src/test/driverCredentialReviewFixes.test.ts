// @vitest-environment node
// Combined pinned 49 + 9a + correction, real SQL/Team CAS, synthetic Auth only.
import type {SupabaseClient} from '@supabase/supabase-js';
import {afterAll,afterEach,describe,expect,it,vi} from 'vitest';
vi.hoisted(()=>vi.stubGlobal('Deno',{env:{get:()=>undefined}}));
const frontend=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:frontend.invoke}}}));
import {driverCredentialStatusRequest} from '@/lib/auth/driverAccess';
import {handleWorkspaceCredentialCommand} from '../../supabase/functions/manage-driver-access/workspace-credentials';
import * as f from './helpers/driverCredentialCombinedFixture';
import {id,roleQuery} from './helpers/driverAccessDatabaseFixture';

afterEach(()=>{vi.restoreAllMocks();frontend.invoke.mockReset();});
afterAll(()=>vi.unstubAllGlobals());
const req2='91000000-0000-4000-8000-000000000042';
const prepare=()=>roleQuery(f.db,'service_role',
  'select public.prepare_driver_workspace_credentials_v1($1,$2,$3,$4,$5,$6,$7,$8)',
  [id.tenant,id.admin,id.shared,f.request,'convert',f.login,f.nonce,id.sharedDriver]);
async function convert(){await prepare();await f.authUpdate();}
const status=(request=f.request,user=id.shared,actor=id.admin,tenant=id.tenant)=>roleQuery<{value:{state:string}}>(f.db,'service_role',
  'select public.driver_workspace_credential_status_v1($1,$2,$3,$4,true) value',[tenant,actor,user,request]);
const cancellations=async()=> (await f.db.query('select * from private.driver_credential_cancellations_v1 order by request_id')).rows;
const links=async()=> (await f.db.query(`select
  (select jsonb_agg(jsonb_build_object('id',id,'tenant',tenant_id,'user',user_id,'role',role) order by id) from tenant_memberships) tenant,
  (select jsonb_agg(jsonb_build_object('id',id,'workspace',workspace_id,'user',user_id,'role',role) order by id) from workspace_memberships) workspace,
  (select jsonb_agg(to_jsonb(d) order by id) from drivers d) drivers,
  (select jsonb_agg(to_jsonb(h) order by driver_id) from driver_history_fixture h) history`)).rows;
async function activate(user=id.shared){const row=await f.member(user);return roleQuery(f.db,'authenticated',
  'select public.update_tenant_membership_v1($1,$2,null,true)',[row.id,row.updated_at]);}

describe('independent review counterproofs and complete driver lifecycle',()=>{
  afterEach(async()=>{await f.db?.close();});
  it('reproduces the converted Team reactivation failure, then preserves IDs/roles through rename and suspend/reactivate',async()=>{
    await f.setupCombinedDriverCredentials(false,false);await convert();await f.rename();
    const graph=await links(),identity=(await f.accessGraph())[0].identities;
    await f.suspend();const suspended=await f.member();
    await expect(activate()).rejects.toThrow('workspace_driver_link_change_forbidden');
    await f.applyCorrection();await activate();
    expect(await links()).toEqual(graph);expect((await f.accessGraph())[0].identities).toEqual(identity);
    expect((await f.db.query('select role,active from tenant_memberships where user_id=$1 order by tenant_id',[id.shared])).rows)
      .toEqual([{role:'driver',active:true},{role:'driver',active:true}]);
    await expect(roleQuery(f.db,'authenticated','select public.update_tenant_membership_v1($1,$2,null,false)',[suspended.id,suspended.updated_at]))
      .rejects.toMatchObject({code:'40001'});
  });
  it('reproduces outsider status bookkeeping, then denies a fresh request without any cancellation or Auth mutation',async()=>{
    await f.setupCombinedDriverCredentials(false,false);
    expect((await status(f.request,id.otherAdmin)).rows[0].value.state).toBe('cancelled');
    await f.applyCorrection();const before=await cancellations(),accounts=(await f.accessGraph())[0].identities;
    const update=vi.fn(async()=>{throw new Error('Unexpected Auth');});
    const response=await f.endpoint({action:'credential_status',user_id:id.otherAdmin,request_id:req2},f.endpointClient(update));
    expect(response.status).toBe(503);expect(await response.json()).toMatchObject({state:'unconfirmed'});
    expect(await cancellations()).toEqual(before);expect((await f.accessGraph())[0].identities).toEqual(accounts);
    expect(update).not.toHaveBeenCalled();
  });
  it('reproduces nullable unlink and then protects the old converted identity from unlink, replacement and deletion',async()=>{
    await f.setupCombinedDriverCredentials(false,false);await convert();
    await f.db.exec('begin;set local role service_role');
    await f.db.query('update drivers set user_id=null where id=$1',[id.sharedDriver]);
    expect((await f.db.query('select user_id from drivers where id=$1',[id.sharedDriver])).rows).toEqual([{user_id:null}]);
    await f.db.exec('rollback');await f.applyCorrection();const before=await links();
    for(const value of [null,id.legacy])await expect(roleQuery(f.db,'service_role','update drivers set user_id=$1 where id=$2',[value,id.sharedDriver]))
      .rejects.toMatchObject({code:'42501',message:'workspace_driver_link_change_forbidden'});
    await expect(roleQuery(f.db,'service_role','delete from drivers where id=$1',[id.sharedDriver]))
      .rejects.toMatchObject({code:'42501',message:'workspace_driver_link_change_forbidden'});
    expect(await links()).toEqual(before);
    await f.rename(id.freeDriver,'Still accountless');
    expect((await f.db.query('select user_id from drivers where name=$1',['Still accountless'])).rows).toEqual([{user_id:null},{user_id:null}]);
  });
  it('creates through the existing reserved Auth INSERT and completes edit/suspend/reactivate without granting sibling access',async()=>{
    await f.setupCombinedDriverCredentials();await f.managed();await f.rename(id.freeDriver,'Created then edited');
    const before=await links(),identity=(await f.accessGraph())[0].identities;
    await f.suspend(id.newUser);await activate(id.newUser);
    expect(await links()).toEqual(before);expect((await f.accessGraph())[0].identities).toEqual(identity);
    expect((await f.db.query('select tenant_id,role,active from tenant_memberships where user_id=$1',[id.newUser])).rows)
      .toEqual([{tenant_id:id.tenant,role:'driver',active:true}]);
    expect((await f.db.query('select id from workspace_memberships where user_id=$1',[id.newUser])).rows).toEqual([]);
  });
  it('updates existing members from the workspace path and never fills an absent third company membership',async()=>{
    await f.setupCombinedDriverCredentials();await convert();
    const third='21000000-0000-4000-8000-000000000003';
    await f.db.query('insert into tenants values($1,$2)',[third,id.workspace]);await f.rename();const before=await links();
    for(const active of [false,true])await roleQuery(f.db,'service_role','update workspace_memberships set active=$1 where user_id=$2',[active,id.shared]);
    expect(await links()).toEqual(before);
    expect((await f.db.query('select id from tenant_memberships where tenant_id=$1',[third])).rows).toEqual([]);
    expect((await f.db.query('select active from tenant_memberships where user_id=$1',[id.shared])).rows).toEqual([{active:true},{active:true}]);
  });
  it.each(['foreign_workspace','auth_privilege'])('fails closed on %s drift before reactivation and keeps the operation suspended',async drift=>{
    await f.setupCombinedDriverCredentials();await convert();await f.suspend();
    if(drift==='foreign_workspace')await f.db.query('update tenants set workspace_id=$1 where id=$2',[id.otherWorkspace,id.otherTenant]);
    else await f.db.query('update auth.users set is_super_admin=true where id=$1',[id.shared]);
    const before=await f.accessGraph();await expect(activate()).rejects.toMatchObject({code:'42501'});expect(await f.accessGraph()).toEqual(before);
    expect((await f.db.query('select active from tenant_memberships where user_id=$1',[id.shared])).rows).toEqual([{active:false},{active:false}]);
  });
  it('does not change mixed roles to reactivate, and preserves another operation when suspending legacy access',async()=>{
    await f.setupCombinedDriverCredentials(true);
    const foreign=(await f.db.query('select * from tenant_memberships where tenant_id=$1 and user_id=$2',[id.otherTenant,id.shared])).rows;
    await f.suspend();expect((await f.db.query('select * from tenant_memberships where tenant_id=$1 and user_id=$2',[id.otherTenant,id.shared])).rows).toEqual(foreign);
    await expect(activate()).rejects.toThrow('driver_accounts_require_username_creation');
    await f.db.close();await f.setupCombinedDriverCredentials();await convert();await f.suspend();const before=await links();
    await expect(roleQuery(f.db,'service_role',"update tenant_memberships set role='operator',active=true where user_id=$1",[id.shared]))
      .rejects.toThrow('workspace_driver_link_change_forbidden');expect(await links()).toEqual(before);
  });
  it.each(['foreign','foreign_inactive','other_role','no_registry','outsider'])('does no new status bookkeeping for %s',async kind=>{
    await f.setupCombinedDriverCredentials(kind.startsWith('foreign'));
    if(kind==='foreign_inactive')await f.suspend();
    if(kind==='other_role')await f.db.query("update user_roles set role='admin' where user_id=$1",[id.shared]);
    if(kind==='no_registry')await f.db.query('update drivers set active=false where user_id=$1',[id.shared]);
    const before=await f.accessGraph();await expect(status(f.request,kind==='outsider'?id.otherAdmin:id.shared)).rejects.toMatchObject({code:'42501'});
    expect(await cancellations()).toEqual([]);expect(await f.accessGraph()).toEqual(before);
  });
  it('reconciles a known command and cancellation after suspension, rejects other ownership and fences late Auth/prepare',async()=>{
    await f.setupCombinedDriverCredentials();await prepare();await f.suspend();
    expect((await status()).rows[0].value.state).toBe('cancelled');
    await expect(f.authUpdate()).rejects.toMatchObject({code:'42501'});
    await expect(status(f.request,id.shared,id.otherAdmin,id.otherTenant)).rejects.toMatchObject({code:'42501'});
    await f.db.close();await f.setupCombinedDriverCredentials();
    expect((await status()).rows[0].value.state).toBe('cancelled');await f.suspend();
    expect((await status()).rows[0].value.state).toBe('cancelled');
    await expect(prepare()).rejects.toMatchObject({code:'42501'});
    expect((await f.db.query('select * from private.driver_credential_commands_v1')).rows).toEqual([]);
  });
  it('preserves metadata/ACL and refuses absent or already changed predecessors atomically',async()=>{
    await f.setupCombinedDriverCredentials(false,false);
    const names=['private.sync_employee_from_tenant_membership_v1()','private.sync_employee_from_workspace_membership_v1()',
      'private.guard_driver_account_scope_v1()','public.driver_workspace_credential_status_v1(uuid,uuid,uuid,uuid,boolean)'];
    const metadata=()=>f.db.query('select to_jsonb(p)-\'prosrc\' value from pg_proc p where oid=any($1::regprocedure[]) order by oid',[names]);
    const before=(await metadata()).rows;await f.applyCorrection();expect((await metadata()).rows).toEqual(before);
    await expect(f.applyCorrection()).rejects.toThrow('driver_credential_review_predecessor_changed');
    for(const role of ['anon','authenticated','service_role'] as const)
      await expect(roleQuery(f.db,role,'select private.require_driver_reactivation_scope_v1($1,$2)',[id.workspace,id.shared])).rejects.toMatchObject({code:'42501'});
  });
});

describe('absence is not a credential receipt',()=>{
  it('keeps the Edge uncertain when a drifting backend replies not_found',async()=>{
    const admin={rpc:async()=>({data:{state:'not_found',request_id:f.request},error:null})} as unknown as SupabaseClient;
    const result=await handleWorkspaceCredentialCommand(admin,{tenantId:id.tenant,actorId:id.admin,userId:id.shared,requestId:f.request,action:'credential_status'});
    expect(result.status).toBe(503);expect(result.body).toMatchObject({state:'unconfirmed'});
  });
  it.each([false,true])('keeps the frontend blocked for not_found, HTTP error=%s',async httpError=>{
    const body={state:'not_found',request_id:f.request};
    frontend.invoke.mockResolvedValue(httpError?{data:null,error:{context:new Response(JSON.stringify(body))}}:{data:body,error:null});
    await expect(driverCredentialStatusRequest({request_id:f.request})).rejects.toThrow('ainda não foi confirmado');
  });
});
