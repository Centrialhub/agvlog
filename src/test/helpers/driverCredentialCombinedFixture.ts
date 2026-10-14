// @vitest-environment node
// Current SQL bodies and candidate migration, synthetic rows, isolated PGlite.
// This partial graph is not a substitute for Native/RLS release validation.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { expect } from 'vitest';
import type {SupabaseClient} from '@supabase/supabase-js';
import {handleDriverAccess} from '../../../supabase/functions/manage-driver-access/handler';
import {createHash} from 'node:crypto';
import { applyDriverForward, createAuth, prepare, id, roleQuery, setupDriverGraph } from './driverAccessDatabaseFixture';

export let db: PGlite;

export const source = (name: string) => readFileSync(`supabase/migrations/${name}`,'utf8').replace(/\r\n/g,'\n');
export const native = JSON.parse(readFileSync('src/test/helpers/native-safe-trigger-functions.json','utf8')) as Array<{
  signature: string; definition: string; owner: string; bodyMd5: string;
}>;

export async function setup(sameWorkspace: boolean, otherActive=true, otherRole='driver') {
  db = await setupDriverGraph();
  await db.exec(`
    create role supabase_admin;
    alter table tenant_memberships add column updated_at timestamptz not null default now();
    alter table workspace_memberships add column updated_at timestamptz not null default now();
    alter table drivers add column phone text;
    create table public.profiles(id uuid primary key references auth.users,full_name text);
    create table public.entity_audit_log(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      entity_type text,entity_id uuid,action text,old_data jsonb,new_data jsonb,actor_user_id uuid,source text);
    grant insert on public.entity_audit_log to supabase_admin;
    grant usage on schema public,auth to supabase_admin;
  `);
  if(sameWorkspace) await db.query('update tenants set workspace_id=$1 where id=$2',[id.workspace,id.otherTenant]);
  // Seed the legacy graph before installing the actual scope/sync guards.
  await db.query("update tenant_memberships set role='driver',active=true where user_id=$1",[id.shared]);
  await db.query('update tenant_memberships set role=$1::public.app_role,active=$2 where user_id=$3 and tenant_id=$4',
    [otherRole,otherActive,id.shared,id.otherTenant]);
  await db.query('update drivers set user_id=$1 where id=$2',[id.shared,id.foreignDriver]);
  await db.query(`insert into workspace_memberships(workspace_id,user_id,role,active)
    select distinct workspace_id,$1::uuid,'driver'::public.app_role,true from tenants`,[id.shared]);
  await db.query("insert into profiles values($1,'Global synthetic name')",[id.shared]);
  for(const row of native) {
    if(!['postgres','supabase_admin'].includes(row.owner)) throw new Error('Unexpected fixture owner');
    await db.exec(`${row.definition.trimEnd()}; alter function ${row.signature} owner to ${row.owner};
      revoke all on function ${row.signature} from public,anon,authenticated,service_role;`);
  }
  await db.exec(`
    create trigger audit_tenant_membership_change_v1 after update on tenant_memberships
      for each row execute function public.audit_tenant_membership_change_v1();
    create trigger tenant_memberships_sync_workspace_employee after insert or delete or update of role,active
      on tenant_memberships for each row execute function private.sync_employee_from_tenant_membership_v1();
    create trigger trg_block_client_membership before insert or update of role on tenant_memberships
      for each row execute function public._block_client_membership();
    create trigger trg_protect_tenant_owners before insert or delete or update on tenant_memberships
      for each row execute function public.protect_tenant_owners();
    create trigger workspace_memberships_set_updated_at before update on workspace_memberships
      for each row execute function public.update_updated_at_column();
    create trigger workspace_memberships_sync_tenants after insert or delete or update of role,active
      on workspace_memberships for each row execute function private.sync_employee_from_workspace_membership_v1();
  `);
  const adminPredicate=source('20260831164442_remove_authenticator_requirement.sql')
    .match(/create or replace function public\.is_tenant_admin\(_tenant_id uuid\)[\s\S]*?\$function\$;/i)?.[0];
  if(!adminPredicate) throw new Error('Canonical admin predicate missing');
  await db.exec(adminPredicate);
  // Forward installs complete real driver guards; restore adds the real CAS RPC.
  await db.query("insert into user_roles(user_id,role) values($1,'driver')",[id.shared]);
  await applyDriverForward(db);
  await db.exec(source('20260926190733_restore_team_access_public_rpcs.sql'));
  for(const name of ['private.sync_employee_from_tenant_membership_v1()','private.sync_employee_from_workspace_membership_v1()']) {
    const expected=native.find(row=>row.signature===name)!;
    expect((await db.query<{hash:string}>('select md5(prosrc) hash from pg_proc where oid=to_regprocedure($1)',[name])).rows[0].hash).toBe(expected.bodyMd5);
  }
}
export async function graph() {
  return (await db.query<Record<string, unknown>>(`select
    (select jsonb_agg(to_jsonb(m) order by tenant_id) from tenant_memberships m where user_id=$1) memberships,
    (select jsonb_agg(to_jsonb(w) order by workspace_id) from workspace_memberships w where user_id=$1) workspaces,
    (select jsonb_agg(to_jsonb(d) order by tenant_id) from drivers d where user_id=$1) drivers,
    (select to_jsonb(p) from profiles p where id=$1) profile,
    (select jsonb_build_object('id',id,'metadata',raw_app_meta_data,'deleted_at',deleted_at) from auth.users where id=$1) identity,
    (select count(*)::int from entity_audit_log) audits`,[id.shared])).rows;
}

export async function installPersonProjection() {
  await db.exec(`
    alter table drivers add column workspace_id uuid;
    alter table drivers add column email text;
    alter table drivers add column cpf text;
    alter table drivers add column current_vehicle_id uuid;
    alter table drivers add column created_at timestamptz not null default now();
    alter table drivers add column updated_at timestamptz not null default now();
    update drivers d set workspace_id=t.workspace_id from tenants t where t.id=d.tenant_id;
    create table employees(id uuid primary key);
  `);
  const foundation=source('20260910132428_shared_master_data_foundation.sql');
  for(const table of ['workspace_people','workspace_person_tenant_links']) {
    const definition=foundation.match(new RegExp(`create table public\\.${table} \\([\\s\\S]*?\\n\\);`,'i'))?.[0];
    if(!definition) throw new Error('Canonical projection table missing');
    await db.exec(definition);
  }
  // Existing canonical links, not an uninitialized master-data graph.
  await db.query(`insert into workspace_people(id,workspace_id,identity_key,name)
    select id,workspace_id,'driver:'||id::text,name from drivers where id=$1
    or (id=$2 and workspace_id<>(select workspace_id from drivers where id=$1))`,[id.sharedDriver,id.foreignDriver]);
  await db.query(`insert into workspace_person_tenant_links(workspace_id,workspace_person_id,tenant_id,driver_id)
    select d.workspace_id,case when d.workspace_id=s.workspace_id then s.id else d.id end,d.tenant_id,d.id
    from drivers d cross join drivers s where s.id=$1 and d.id in($1,$2)`,[id.sharedDriver,id.foreignDriver]);
  const projections=source('20260910142232_synchronize_shared_master_projections.sql');
  for(const name of ['apply_shared_projection_columns','insert_shared_projection','sync_workspace_person_projection']) {
    const definition=projections.match(new RegExp(`create or replace function private\\.${name}\\([\\s\\S]*?\\$function\\$;`,'i'))?.[0];
    if(!definition) throw new Error('Canonical projection function missing');
    await db.exec(definition);
  }
  await db.exec(`create trigger drivers_sync_workspace_projection after insert or update on public.drivers
    for each row execute function private.sync_workspace_person_projection();`);
}

export const peopleGraph = async () => (await db.query('select * from workspace_people order by id')).rows;
export const applyRegistryCorrection=()=>db.exec(source('20261012203921_driver_existing_workspace_projection.sql'));

export const candidate='20261012214500_separate_driver_registry_and_suspend_existing_access.sql';
export const apply=()=>{
  const sql=readFileSync('src/test/helpers/driverRegistry49Pinned.sql','utf8').replace(/\r\n/g,'\n');
  if(createHash('sha256').update(sql).digest('hex')!=='6be1f95e05e944392b3a24466724b96829d08b883bd692dc320b0e6864692ab0')throw new Error('Pinned 49 migration changed');
  return db.exec(sql);
};
export async function fullSetup(same=true,active=true,role='driver') {
  await setup(same,active,role);await installPersonProjection();await applyRegistryCorrection();
}
export async function accessGraph() {
  return (await db.query<Record<string,unknown>>(`select
    (select jsonb_agg(to_jsonb(m) order by id) from tenant_memberships m) memberships,
    (select jsonb_agg(to_jsonb(m) order by id) from workspace_memberships m) workspaces,
    (select jsonb_agg(to_jsonb(u) order by id) from auth.users u) identities,
    (select jsonb_agg(to_jsonb(r) order by id) from user_roles r) roles,
    (select jsonb_agg(to_jsonb(p) order by id) from profiles p) profiles,
    (select jsonb_agg(to_jsonb(p) order by id) from client_portal_access p) portal,
    (select jsonb_agg(to_jsonb(h) order by driver_id) from driver_history_fixture h) history`)).rows;
}
export const rename=(driver=id.sharedDriver,name='Synthetic renamed')=>roleQuery(db,'service_role','update drivers set name=$1 where id=$2',[name,driver]);
export async function member(user=id.shared) {
  return (await db.query<{id:string;updated_at:string}>('select id,updated_at from tenant_memberships where user_id=$1 and tenant_id=$2',[user,id.tenant])).rows[0];
}
export async function suspend(user=id.shared) {
  const row=await member(user);return roleQuery(db,'authenticated','select public.update_tenant_membership_v1($1,$2,null,false)',[row.id,row.updated_at]);
}
export async function managed() {
  // Establish shared registries before trusted account attachment, as in the UI flow.
  await rename(id.freeDriver,'Synthetic managed before account');
  await prepare(db);await createAuth(db);
}
export const driversGraph=()=>db.query('select * from drivers order by id');


export const correction='20261012224659_driver_credentials_review_boundaries.sql';
export async function applyCorrection(){
  await db.exec('begin');try{await db.exec(source(correction));await db.exec('commit');}
  catch(error){await db.exec('rollback');throw error;}
}
export async function setupCombinedDriverCredentials(foreign=false,corrected=true) {
  await fullSetup(!foreign);await apply();
  await db.exec(`alter table auth.users add column encrypted_password text default 'synthetic-old-hash';
    alter table auth.users add column role text default 'authenticated';
    alter table auth.users add column is_super_admin boolean default false;
    alter table auth.users add column is_sso_user boolean default false;
    alter table auth.users add column banned_until timestamptz;
    create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),provider text,identity_data jsonb);
    grant select,insert,update,delete on auth.identities to supabase_auth_admin;`);
  await db.query("insert into auth.identities(user_id,provider,identity_data) values($1,'email','{}')",[id.shared]);
  await db.exec('begin');
  try{await db.exec(source('20261012215337_driver_workspace_credential_commands.sql'));await db.exec('commit');}
  catch(error){await db.exec('rollback');throw error;}
  if(corrected)await applyCorrection();return db;
}

export const request='91000000-0000-4000-8000-000000000041';
export const nonce='synthetic-server-nonce-never-returned-to-browser-123456789';
export const login='synthetic.driver@usuario.com';
export async function authUpdate(requestId=request,serverNonce=nonce,email:string|null=login,hash='synthetic-new-hash',beforeCommit?:()=>Promise<void>) {
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
}const forbiddenAuth=()=>{throw new Error('Unexpected synthetic Auth action');};
export function endpointClient(update: (user:string,attributes:{app_metadata:{driver_credential_nonce:string;driver_credential_request_id:string};email?:string})=>Promise<unknown>) {
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
export async function endpoint(body:Record<string,unknown>,admin:SupabaseClient) {
  const caller={auth:{getUser:async()=>({data:{user:{id:id.admin}},error:null})}} as unknown as SupabaseClient;
  const token=`fixture.${btoa(JSON.stringify({sub:id.admin,active_tenant_id:id.tenant}))}.fixture`;
  return handleDriverAccess(new Request('https://fixture.invalid',{method:'POST',headers:{authorization:`Bearer ${token}`,
    'x-agvlog-tenant-id':id.tenant},body:JSON.stringify({tenant_id:id.tenant,...body})}),caller,admin,{});
}
