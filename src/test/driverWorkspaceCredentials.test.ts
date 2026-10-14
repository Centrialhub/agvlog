// @vitest-environment node
// Real SQL commands/deferred guard; synthetic multi-UPDATE Auth transaction, not GoTrue acceptance.
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,describe,expect,it,vi} from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {id,roleQuery} from './helpers/driverAccessDatabaseFixture';
import {setupCombinedDriverCredentials} from './helpers/driverCredentialCombinedFixture';
import {handleWorkspaceCredentialCommand} from '../../supabase/functions/manage-driver-access/workspace-credentials';
vi.hoisted(()=>vi.stubGlobal('Deno',{env:{get:()=>undefined}}));
import {handleDriverAccess} from '../../supabase/functions/manage-driver-access/handler';
afterAll(()=>vi.unstubAllGlobals());

let db:PGlite;
const request='91000000-0000-4000-8000-000000000041';
const request2='91000000-0000-4000-8000-000000000042';
const nonce='synthetic-server-nonce-never-returned-to-browser-123456789';
const login='synthetic.driver@usuario.com';
const password='SyntheticPassword123';
afterEach(async()=>{await db?.close();vi.restoreAllMocks();});
async function setup(foreign=false) { db=await setupCombinedDriverCredentials(foreign); }

const prepare=(requestId=request,action='convert',email:string|null=login)=>roleQuery<{value:{dispatch:boolean;state:string}}>(db,'service_role',
  'select public.prepare_driver_workspace_credentials_v1($1,$2,$3,$4,$5,$6,$7,$8) value',
  [id.tenant,id.admin,id.shared,requestId,action,email,nonce,id.sharedDriver]);
const inspect=()=>roleQuery(db,'service_role','select public.inspect_driver_workspace_credentials_v1($1,$2,$3)',[id.tenant,id.admin,id.shared]);
const status=(cancel=false,requestId=request)=>roleQuery<{value:{state:string}}>(db,'service_role',
  'select public.driver_workspace_credential_status_v1($1,$2,$3,$4,$5) value',[id.tenant,id.admin,id.shared,requestId,cancel]);
async function authUpdate(requestId=request,serverNonce=nonce,email:string|null=login,hash='synthetic-new-hash',beforeCommit?:()=>Promise<void>) {
  await db.exec('begin;set local role supabase_auth_admin');
  try {
    await db.query('update auth.users set encrypted_password=$1 where id=$2',[hash,id.shared]);
    if(email!==null){
      await db.query("update auth.identities set identity_data=jsonb_build_object('email',$1::text) where user_id=$2 and provider='email'",[email,id.shared]);
      await db.query('update auth.users set email=$1 where id=$2',[email,id.shared]);
    }
    await db.query("update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('driver_credential_request_id',$1::text,'driver_credential_nonce',$2::text) where id=$3",
      [requestId,serverNonce,id.shared]);
    if(beforeCommit)await beforeCommit();
    await db.exec('commit');
  }catch(error){await db.exec('rollback');throw error;}
}
const accounts=()=>db.query('select id,email,encrypted_password,raw_app_meta_data from auth.users order by id');
const relations=()=>db.query(`select
  (select jsonb_agg(to_jsonb(m) order by id) from tenant_memberships m) memberships,
  (select jsonb_agg(to_jsonb(w) order by id) from workspace_memberships w) workspaces,
  (select jsonb_agg(to_jsonb(d) order by id) from drivers d) drivers,
  (select jsonb_agg(to_jsonb(r) order by id) from user_roles r) roles,
  (select jsonb_agg(to_jsonb(h) order by driver_id) from driver_history_fixture h) history`);

describe('workspace-only credential authority committed with Auth',()=>{
  it('converts across sibling CNPJs with one identity, then resets from either existing active company',async()=>{
    await setup();const before=(await relations()).rows;
    await expect(roleQuery(db,'service_role','select public.driver_access_scope_v1($1,$2,$3,false)',[id.tenant,id.admin,id.shared]))
      .rejects.toThrow('driver_account_shared_or_other_role');
    expect((await prepare()).rows[0].value.dispatch).toBe(true);await authUpdate();
    expect((await status()).rows[0].value.state).toBe('succeeded');expect((await relations()).rows).toEqual(before);
    const current=(await db.query<{email:string;raw_app_meta_data:Record<string,unknown>}>('select email,raw_app_meta_data from auth.users where id=$1',[id.shared])).rows[0];
    expect(current.email).toBe(login);expect(current.raw_app_meta_data).toMatchObject({driver_username_managed:true,driver_workspace_managed:true,driver_access_workspace_id:id.workspace});
    expect(JSON.stringify(current)).not.toContain(nonce);expect(current.raw_app_meta_data).not.toHaveProperty('driver_credential_request_id');
    // Existing owner of the sibling legal company has the same approved operational authority.
    await roleQuery(db,'service_role','select public.prepare_driver_workspace_credentials_v1($1,$2,$3,$4,$5,null,$6,$7)',
      [id.otherTenant,id.otherAdmin,id.shared,request2,'password',nonce,id.foreignDriver]);
    await authUpdate(request2,nonce,null,'synthetic-reset-hash');
    expect((await relations()).rows).toEqual(before);
    expect((await db.query('select email,encrypted_password from auth.users where id=$1',[id.shared])).rows)
      .toEqual([{email:login,encrypted_password:'synthetic-reset-hash'}]);
  });
  it.each(['foreign_active','foreign_inactive','other_role','portal','global_privilege','workspace_privilege','oauth','auth_privilege'])('rejects %s including inactive evidence',async scenario=>{
    await setup(scenario.startsWith('foreign'));
    if(scenario==='foreign_inactive')await db.query('update tenant_memberships set active=false where user_id=$1 and tenant_id=$2',[id.shared,id.otherTenant]);
    if(scenario==='other_role')await db.query("update tenant_memberships set role='operator' where user_id=$1 and tenant_id=$2",[id.shared,id.otherTenant]);
    if(scenario==='portal')await db.query("insert into client_portal_access(tenant_id,user_id,client_id,access_type,active) values($1,$2,$3,'client',false)",[id.tenant,id.shared,id.client]);
    if(scenario==='global_privilege')await db.query("update user_roles set role='admin' where user_id=$1",[id.shared]);
    if(scenario==='workspace_privilege')await db.query("update workspace_memberships set role='operator' where user_id=$1",[id.shared]);
    if(scenario==='oauth')await db.query("insert into auth.identities(user_id,provider) values($1,'google')",[id.shared]);
    if(scenario==='auth_privilege')await db.query('update auth.users set is_super_admin=true where id=$1',[id.shared]);
    const before=(await accounts()).rows;
    await expect(prepare()).rejects.toMatchObject({code:'42501'});expect((await accounts()).rows).toEqual(before);
    expect((await db.query('select request_id from private.driver_credential_commands_v1')).rows).toEqual([]);
  });
  it.each(['actor','role','foreign','registry'])('revalidates %s drift after eligibility and rolls back all Auth UPDATEs',async scenario=>{
    await setup();await prepare();
    if(scenario==='actor')await db.query('update tenant_memberships set active=false where user_id=$1',[id.admin]);
    if(scenario==='role')await db.query("update tenant_memberships set role='operator' where user_id=$1 and tenant_id=$2",[id.shared,id.otherTenant]);
    if(scenario==='foreign')await db.query('update tenants set workspace_id=$1 where id=$2',[id.otherWorkspace,id.otherTenant]);
    if(scenario==='registry')await db.query('update drivers set active=false where id=$1',[id.sharedDriver]);
    const before=(await accounts()).rows,identities=(await db.query('select * from auth.identities order by id')).rows;
    await expect(authUpdate()).rejects.toMatchObject({code:'42501'});expect((await accounts()).rows).toEqual(before);
    expect((await db.query('select * from auth.identities order by id')).rows).toEqual(identities);
    expect((await db.query('select state from private.driver_credential_commands_v1')).rows).toEqual([{state:'pending'}]);
  });
  it('rejects a stale Auth metadata overwrite before it can hide newly privileged authority',async()=>{
    await setup();await prepare();
    await db.query("update auth.users set raw_app_meta_data=raw_app_meta_data||'{\"roles\":[\"admin\"]}'::jsonb where id=$1",[id.shared]);
    const before=(await accounts()).rows;
    await expect(roleQuery(db,'supabase_auth_admin',
      "update auth.users set raw_app_meta_data=jsonb_build_object('driver_credential_request_id',$1::text,'driver_credential_nonce',$2::text),encrypted_password='synthetic-overwrite',email=$3 where id=$4",
      [request,nonce,login,id.shared])).rejects.toThrow('driver_credential_scope_restricted');
    expect((await accounts()).rows).toEqual(before);
  });
  it('fences a request that reaches prepare only after its caller timed out and checked status',async()=>{
    await setup();const before=(await accounts()).rows;
    expect((await status(true)).rows[0].value.state).toBe('cancelled');
    expect((await prepare()).rows[0].value).toMatchObject({dispatch:false,state:'cancelled'});
    expect((await db.query('select request_id from private.driver_credential_commands_v1')).rows).toEqual([]);
    expect((await accounts()).rows).toEqual(before);
    expect((await prepare(request2)).rows[0].value.dispatch).toBe(true);await authUpdate(request2);
  });
  it('cancellation fences a delayed Auth call and permits only a fresh identified request',async()=>{
    await setup();await prepare();const before=(await accounts()).rows;
    expect((await status(true)).rows[0].value.state).toBe('cancelled');
    await expect(authUpdate()).rejects.toThrow('driver_credential_command_invalid');expect((await accounts()).rows).toEqual(before);
    expect((await prepare()).rows[0].value).toMatchObject({dispatch:false,state:'cancelled'});
    expect((await prepare(request2)).rows[0].value.dispatch).toBe(true);await authUpdate(request2);
  });
  it('rejects wrong nonce, wrong result and expiry, then accepts only the exact pending request',async()=>{
    await setup();await prepare();const before=(await accounts()).rows;
    await expect(authUpdate(request,'wrong-nonce')).rejects.toThrow('driver_credential_command_invalid');
    await expect(authUpdate(request,nonce,'different@usuario.com')).rejects.toThrow('driver_credential_result_mismatch');
    await expect(authUpdate(request,nonce,login,'synthetic-old-hash')).rejects.toThrow('driver_credential_result_mismatch');
    expect((await accounts()).rows).toEqual(before);
    await db.query("update private.driver_credential_commands_v1 set expires_at=clock_timestamp()-interval '1 second' where request_id=$1",[request]);
    await expect(authUpdate()).rejects.toThrow('driver_credential_command_invalid');await inspect();
    expect((await status()).rows[0].value.state).toBe('cancelled');
  });
  it('keeps converted links existing-only and guards direct global credential changes',async()=>{
    await setup();await prepare();await authUpdate();const before=(await relations()).rows;
    await expect(roleQuery(db,'service_role',"insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'driver',true)",[id.tenant,id.shared]))
      .rejects.toThrow('workspace_driver_link_change_forbidden');
    await expect(db.query("update tenant_memberships set role='operator' where user_id=$1",[id.shared])).rejects.toThrow('workspace_driver_link_change_forbidden');
    await expect(roleQuery(db,'supabase_auth_admin','update auth.users set encrypted_password=$1 where id=$2',['uncommanded',id.shared])).rejects.toThrow('driver_credential_command_required');
    expect((await relations()).rows).toEqual(before);
  });
  it('does not grant browser access to commands, tickets or global RPCs',async()=>{
    await setup();for(const role of ['anon','authenticated'] as const){
      await expect(roleQuery(db,role,'select * from private.driver_credential_commands_v1')).rejects.toMatchObject({code:'42501'});
      await expect(roleQuery(db,role,'select public.inspect_driver_workspace_credentials_v1($1,$2,$3)',[id.tenant,id.admin,id.shared])).rejects.toMatchObject({code:'42501'});
    }
  });
});

describe('Edge dispatch and uncertain result',()=>{
  it.each(['ok','lost_response','cancel_before_auth'])('dispatches at most once and reconciles %s without exposing secrets',async mode=>{
    await setup();let authCalls=0;
    const admin={rpc:async(name:string,args:Record<string,unknown>)=>{
      try{
        const values=[args._tenant_id,args._actor_id,args._user_id,args._request_id];
        const sql=name==='prepare_driver_workspace_credentials_v1'
          ? 'select public.prepare_driver_workspace_credentials_v1($1,$2,$3,$4,$5,$6,$7,$8) value'
          : 'select public.driver_workspace_credential_status_v1($1,$2,$3,$4,$5) value';
        const result=await roleQuery<{value:unknown}>(db,'service_role',sql,name.startsWith('prepare_')
          ? [...values,args._action,args._email,args._nonce,args._driver_id]:[...values,args._cancel]);
        return {data:result.rows[0].value,error:null};
      }catch(error){return {data:null,error:{message:error instanceof Error?error.message:'rejected'}};}
    },auth:{admin:{updateUserById:async(user:string,attributes:{app_metadata:{driver_credential_nonce:string};email?:string})=>{
      expect(user).toBe(id.shared);authCalls++;
      if(mode==='cancel_before_auth')throw new Error('synthetic transport failure before dispatch');
      await authUpdate(request,attributes.app_metadata.driver_credential_nonce,attributes.email??null);
      if(mode==='lost_response')throw new Error('synthetic response lost after commit');
      return {data:{user:{id:user}},error:null};
    }}}} as unknown as SupabaseClient;
    const input={tenantId:id.tenant,actorId:id.admin,userId:id.shared,driverId:id.sharedDriver,requestId:request,
      action:'convert' as const,username:'synthetic.driver',password};
    const result=await handleWorkspaceCredentialCommand(admin,input);
    expect(result.status).toBe(mode==='cancel_before_auth'?409:200);
    const again=await handleWorkspaceCredentialCommand(admin,{...input,action:'credential_status'});
    expect(again.status).toBe(result.status);expect(authCalls).toBe(1);
    expect(JSON.stringify(result)).not.toContain(password);expect(JSON.stringify(result)).not.toContain('driver_credential_nonce');
  });
});

const forbiddenAuth=vi.fn(()=>{throw new Error('Unexpected synthetic Auth action');});
function endpointClient(update: (user:string,attributes:{app_metadata:{driver_credential_nonce:string;driver_credential_request_id:string};email?:string})=>Promise<unknown>) {
  return {
    auth: { admin: { createUser: forbiddenAuth, updateUserById: update, deleteUser: forbiddenAuth } },
    from(table: string) {
      if (!['tenant_memberships','drivers'].includes(table)) throw new Error('Unexpected table');
      const filters: Array<[string,unknown]> = [];
      let allowedRoles: string[] | null = null;
      const chain = {
        select: () => chain,
        eq: (column: string,value: unknown) => { filters.push([column,value]); return chain; },
        in: (column: string,values: string[]) => { if(column!=='role') throw new Error('Unexpected filter'); allowedRoles=values; return chain; },
        maybeSingle: async () => {
          const values = filters.map(([,value]) => value);
          const clauses = filters.map(([column],index) => {
            if(!['tenant_id','user_id','active','id'].includes(column)) throw new Error('Unexpected column');
            return `${column}=$${index+1}`;
          });
          if(allowedRoles) { values.push(allowedRoles); clauses.push(`role::text=any($${values.length}::text[])`); }
          const { rows } = await roleQuery(db,'service_role',`select * from ${table} where ${clauses.join(' and ')}`,values);
          if(rows.length>1) throw new Error('Adapter refuses ambiguous rows');
          return {data: rows[0] ?? null,error:null};
        },
      };
      return chain;
    },
    rpc: async (name: string,args: Record<string,unknown>) => {
      const parameters:Record<string,unknown[]>={
        inspect_driver_workspace_credentials_v1:[args._tenant_id,args._actor_id,args._user_id],
        prepare_driver_workspace_credentials_v1:[args._tenant_id,args._actor_id,args._user_id,args._request_id,args._action,args._email,args._nonce,args._driver_id],
        driver_workspace_credential_status_v1:[args._tenant_id,args._actor_id,args._user_id,args._request_id,args._cancel],
      };
      if(!parameters[name]) throw new Error('Unexpected RPC');
      try {
        const result=await roleQuery<{value:unknown}>(db,'service_role',
          `select public.${name}(${parameters[name].map((_,i)=>'$'+(i+1)).join(',')}) value`,parameters[name]);
        return {data:result.rows[0].value,error:null};
      } catch(error) { return {data:null,error:{message:(error as Error).message}}; }
    },
  } as unknown as SupabaseClient;
}
async function endpoint(body:Record<string,unknown>,admin:SupabaseClient) {
  const caller={auth:{getUser:async()=>({data:{user:{id:id.admin}},error:null})}} as unknown as SupabaseClient;
  const token=`fixture.${btoa(JSON.stringify({sub:id.admin,active_tenant_id:id.tenant}))}.fixture`;
  return handleDriverAccess(new Request('https://fixture.invalid',{method:'POST',headers:{authorization:`Bearer ${token}`,
    'x-agvlog-tenant-id':id.tenant},body:JSON.stringify({tenant_id:id.tenant,...body})}),caller,admin,{});
}
describe('full handler with SQL authorization adapter',()=>{
  it('inspects both entry points and converts the exact selected local registry',async()=>{
    await setup();const update=vi.fn(async(user:string,attributes:{app_metadata:{driver_credential_nonce:string;driver_credential_request_id:string};email?:string})=>{
      expect(user).toBe(id.shared);await authUpdate(attributes.app_metadata.driver_credential_request_id,
        attributes.app_metadata.driver_credential_nonce,attributes.email??null);
      return {data:{user:{id:user}},error:null};
    });const admin=endpointClient(update);
    for(const target of [{driver_id:id.sharedDriver},{user_id:id.shared}]){
      const inspected=await endpoint({action:'inspect',version:3,...target},admin);
      expect(inspected.status).toBe(200);expect(await inspected.json()).toMatchObject({version:3,kind:'legacy',capabilities:{change_identity:true,change_password:false}});
    }
    const mismatch=await endpoint({action:'convert',driver_id:id.sharedDriver,user_id:id.legacy,request_id:request,username:'synthetic.driver',password},admin);
    expect(mismatch.status).toBe(409);expect(update).not.toHaveBeenCalled();
    const converted=await endpoint({action:'convert',driver_id:id.sharedDriver,request_id:request,username:'synthetic.driver',password},admin);
    expect(converted.status).toBe(200);expect(await converted.json()).toMatchObject({state:'succeeded',request_id:request});expect(update).toHaveBeenCalledOnce();
  });
  it('keeps a foreign-workspace identity read-only and does not reveal its username or mutate Auth',async()=>{
    await setup(true);const update=vi.fn(async()=>{throw new Error('Unexpected Auth');}),admin=endpointClient(update);
    const inspected=await endpoint({action:'inspect',version:3,driver_id:id.sharedDriver},admin);
    expect(await inspected.json()).toMatchObject({kind:'linked',username:null,capabilities:{change_identity:false,change_password:false}});
    const before=(await accounts()).rows;
    const result=await endpoint({action:'convert',driver_id:id.sharedDriver,request_id:request,username:'synthetic.driver',password},admin);
    expect(result.status).toBe(503);expect(update).not.toHaveBeenCalled();expect((await accounts()).rows).toEqual(before);
    expect((await db.query('select * from private.driver_credential_cancellations_v1')).rows).toEqual([]);
  });
});
