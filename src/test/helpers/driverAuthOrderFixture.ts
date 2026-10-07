import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { applyDriverForward,email,id,nonce,setupDriverGraph } from './driverAccessDatabaseFixture';
export { email,id,nonce,prepare,roleQuery } from './driverAccessDatabaseFixture';
const nativeRows=JSON.parse(readFileSync(new URL('./native-safe-trigger-functions.json',import.meta.url),'utf8')) as Array<{
  signature:string;definition:string;owner:string;acl:string[];bodyMd5:string;
}>;
export const sibling='21000000-0000-4000-8000-000000000003';
export const fixedAppMeta={driver_username_managed:true,driver_access_tenant_id:id.tenant};
export const providers={provider:'email',providers:['email']};
export const beforeRepair=readFileSync('supabase/migrations/20261005233405_derive_driver_metadata_before_auth_insert.sql','utf8');

export async function setupFullGraph(multipleCompanies=false) {
  const db=await setupDriverGraph();
  await db.exec(`
    create role supabase_admin;
    alter table tenant_memberships add column updated_at timestamptz not null default now();
    alter table workspace_memberships add column updated_at timestamptz not null default now();
    create table public.profiles(id uuid primary key references auth.users on delete cascade,full_name text);
    create table public.entity_audit_log(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      entity_type text,entity_id uuid,action text,old_data jsonb,new_data jsonb,actor_user_id uuid,source text);
    grant insert on public.entity_audit_log to supabase_admin;
    grant usage on schema public,auth to supabase_admin;
  `);
  if(multipleCompanies) await db.query('insert into tenants(id,workspace_id) values($1,$2)',[sibling,id.workspace]);
  // Complete native SAFE definitions, unchanged. No pg_trigger_depth edits.
  for(const row of nativeRows) {
    if(!['postgres','supabase_admin'].includes(row.owner)) throw new Error('Unexpected fixture owner');
    await db.exec(`${row.definition.trimEnd()};`);
    await db.exec(`alter function ${row.signature} owner to ${row.owner};
      revoke all on function ${row.signature} from public,anon,authenticated,service_role;`);
    if(row.acl.some(acl=>acl.startsWith('service_role=')))
      await db.exec(`grant execute on function ${row.signature} to service_role`);
    if(row.owner==='supabase_admin') await db.exec(`set role supabase_admin;
      grant execute on function ${row.signature} to postgres;reset role;`);
  }
  await db.exec(`
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
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
  await applyDriverForward(db);
  return db;
}

// Models admin.go v2.196.0: initial INSERT providers only, AFTER triggers, then
// server-fixed AppMetaData UPDATE in the SAME transaction. No marked INSERT shortcut.
export async function gotrueTransaction(db:PGlite,options:{
  user?:string;login?:string;reservation?:string;initial?:unknown;serverAppMeta?:unknown;failAfterUpdate?:boolean;
}={}) {
  const {user=id.newUser,login=email,reservation=nonce,initial=providers,serverAppMeta=fixedAppMeta,
    failAfterUpdate=false}=options;
  await db.exec("begin;set local role supabase_auth_admin;set local request.jwt.claim.sub=''");
  try {
    await db.query(`insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
      values($1,$2,jsonb_build_object('agvlog_invite_nonce',$3::text,'full_name','Synthetic Driver'),$4::jsonb)`,
      [user,login,reservation,initial]);
    const inserted=(await db.query<{raw_app_meta_data:Record<string,unknown>;raw_user_meta_data:Record<string,unknown>}>('select raw_app_meta_data,raw_user_meta_data from auth.users where id=$1',[user])).rows[0];
    if(serverAppMeta!==null) await db.query(`update auth.users set raw_app_meta_data=$1::jsonb where id=$2`,
      [{...providers,...(serverAppMeta as Record<string,unknown>)},user]);
    if(failAfterUpdate) await db.query('select 1/0');
    await db.exec('commit');
    return inserted;
  } catch(error) {await db.exec('rollback');throw error;}
}

export async function counts(db:PGlite,user=id.newUser) {
  return (await db.query(`select
    (select count(*)::int from auth.users where id=$1) auth,
    (select count(*)::int from profiles where id=$1) profiles,
    (select count(*)::int from tenant_memberships where user_id=$1) tenants,
    (select count(*)::int from workspace_memberships where user_id=$1) workspaces,
    (select count(*)::int from drivers where user_id=$1) drivers`,[user])).rows[0];
}
export async function graph(db:PGlite) {
  return (await db.query(`select jsonb_build_object(
    'trigger',(select jsonb_agg(to_jsonb(t) order by oid) from pg_trigger t where not tgisinternal),
    'other',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p where p.oid in(
      select tgfoid from pg_trigger where not tgisinternal)
      and p.oid<>'private.enforce_invite_only_auth_user()'::regprocedure),
    'target',(select to_jsonb(p)-'prosrc' from pg_proc p where p.oid='private.enforce_invite_only_auth_user()'::regprocedure)
  ) value`)).rows[0];
}
export async function assertNativeBodyPins(db:PGlite) {
  const actual=(await db.query<{signature:string;hash:string}>(`select p.oid::regprocedure::text signature,md5(prosrc) hash
    from pg_proc p where p.oid=any($1::regprocedure[])`,[nativeRows.map(row=>row.signature)])).rows;
  for(const row of nativeRows) {
    const normalized=row.signature.startsWith('private.')?row.signature:row.signature.replace(/^public\./,'');
    if(actual.find(item=>item.signature===normalized)?.hash!==row.bodyMd5)
      throw new Error(`Native SAFE body drift: ${row.signature}`);
  }
}
