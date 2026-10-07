import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

export const id = {
  workspace: '71000000-0000-4000-8000-000000000001',
  otherWorkspace: '71000000-0000-4000-8000-000000000002',
  tenant: '21000000-0000-4000-8000-000000000001',
  otherTenant: '21000000-0000-4000-8000-000000000002',
  admin: '11000000-0000-4000-8000-000000000001',
  otherAdmin: '11000000-0000-4000-8000-000000000002',
  legacy: '11000000-0000-4000-8000-000000000003',
  orphan: '11000000-0000-4000-8000-000000000004',
  shared: '11000000-0000-4000-8000-000000000005',
  operator: '11000000-0000-4000-8000-000000000006',
  newUser: '11000000-0000-4000-8000-000000000007',
  replayUser: '11000000-0000-4000-8000-000000000008',
  loser: '11000000-0000-4000-8000-000000000009',
  legacyDriver: '31000000-0000-4000-8000-000000000001',
  orphanDriver: '31000000-0000-4000-8000-000000000002',
  freeDriver: '31000000-0000-4000-8000-000000000003',
  secondDriver: '31000000-0000-4000-8000-000000000004',
  sharedDriver: '31000000-0000-4000-8000-000000000005',
  foreignDriver: '31000000-0000-4000-8000-000000000006',
  client: '41000000-0000-4000-8000-000000000001',
};
export const nonce = 'driver-access-synthetic-nonce-at-least-32-characters-0001';
export const nextNonce = 'driver-access-synthetic-nonce-at-least-32-characters-0002';
export const email = 'qa.driver@usuario.com';
export const predecessorFiles = [
  '20260828185133_enforce_invite_only_auth_users.sql',
  '20260828185757_harden_auth_invite_authorizations.sql',
  '20260917090000_atomic_auth_invite_access.sql',
];
const sqlFile = (path: string) => readFileSync(path,'utf8').replace(/\r\n/g,'\n');

export async function setupDriverGraph(): Promise<PGlite> {
  const db = new PGlite({extensions:{pgcrypto}});
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create role supabase_auth_admin;
    create schema auth; create schema private; create schema extensions;
    create extension pgcrypto with schema extensions;
    grant usage on schema auth to anon,authenticated,service_role,supabase_auth_admin;
    grant usage on schema private,extensions to service_role;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    create type public.app_role as enum('owner','admin','operator','client','driver');
    create table auth.users(
      id uuid primary key,email text not null unique,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      raw_app_meta_data jsonb not null default '{}'::jsonb,deleted_at timestamptz
    );
    grant select,insert,update,delete on auth.users to supabase_auth_admin;
    revoke all on auth.users from public,anon,authenticated,service_role;
    create table public.workspaces(id uuid primary key);
    create table public.tenants(id uuid primary key,workspace_id uuid references public.workspaces);
    create table public.clients(id uuid primary key,tenant_id uuid not null references public.tenants,active boolean not null);
    create table public.tenant_memberships(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants,
      user_id uuid not null references auth.users,role public.app_role not null,active boolean not null,
      unique(tenant_id,user_id)
    );
    create table public.workspace_memberships(
      id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces,
      user_id uuid not null references auth.users,role public.app_role not null,active boolean not null,
      unique(workspace_id,user_id)
    );
    create table public.drivers(
      id uuid primary key,tenant_id uuid not null references public.tenants,name text not null,
      active boolean not null,user_id uuid references auth.users on delete set null
    );
    create unique index uq_drivers_tenant_user on public.drivers(tenant_id,user_id) where user_id is not null;
    create table public.user_roles(
      id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users,
      role public.app_role not null,unique(user_id,role)
    );
    create table public.client_portal_access(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants,
      user_id uuid not null references auth.users,client_id uuid not null references public.clients,
      access_type text not null,active boolean not null,
      can_view_financial boolean not null default false,can_download_documents boolean not null default false,
      can_open_occurrences boolean not null default false,can_request_pickup boolean not null default false,
      can_view_vehicle_live boolean not null default false,can_view_driver_contact boolean not null default false,
      created_by uuid references auth.users,unique(tenant_id,user_id,client_id)
    );
    create table public.driver_history_fixture(
      driver_id uuid primary key references public.drivers on delete restrict,
      created_by uuid not null references auth.users on delete restrict,evidence text not null
    );
    insert into public.workspaces values('${id.workspace}'),('${id.otherWorkspace}');
    insert into public.tenants values('${id.tenant}','${id.workspace}'),('${id.otherTenant}','${id.otherWorkspace}');
    insert into auth.users(id,email) values
      ('${id.admin}','admin@example.test'),('${id.otherAdmin}','other-admin@example.test'),
      ('${id.legacy}','legacy@example.test'),('${id.orphan}','orphan@example.test'),
      ('${id.shared}','shared@example.test'),('${id.operator}','operator@example.test');
    insert into public.tenant_memberships(tenant_id,user_id,role,active) values
      ('${id.tenant}','${id.admin}','admin',true),('${id.otherTenant}','${id.otherAdmin}','owner',true),
      ('${id.tenant}','${id.legacy}','driver',true),('${id.tenant}','${id.shared}','driver',false),
      ('${id.otherTenant}','${id.shared}','operator',false),('${id.tenant}','${id.operator}','operator',true);
    insert into public.workspace_memberships(workspace_id,user_id,role,active)
      values('${id.workspace}','${id.legacy}','driver',true);
    insert into public.user_roles(user_id,role) values('${id.legacy}','driver');
    insert into public.clients values('${id.client}','${id.tenant}',true);
    insert into public.drivers values
      ('${id.legacyDriver}','${id.tenant}','Legacy',true,'${id.legacy}'),
      ('${id.orphanDriver}','${id.tenant}','Orphan legacy',true,'${id.orphan}'),
      ('${id.freeDriver}','${id.tenant}','Free',true,null),
      ('${id.secondDriver}','${id.tenant}','Second',true,null),
      ('${id.sharedDriver}','${id.tenant}','Shared',true,'${id.shared}'),
      ('${id.foreignDriver}','${id.otherTenant}','Foreign',true,null);
    insert into public.driver_history_fixture values
      ('${id.legacyDriver}','${id.legacy}','Immutable legacy evidence'),
      ('${id.orphanDriver}','${id.orphan}','Immutable orphan evidence');
    grant select,insert,update,delete on public.tenants,public.clients,public.drivers,
      public.tenant_memberships,public.workspace_memberships,public.user_roles,public.client_portal_access
      to service_role;
    select set_config('request.jwt.claim.sub','${id.admin}',false);
  `);
  // Admin/legacy seeds precede real BEFORE/AFTER guards. No permissive trigger substitutes.
  for (const filename of predecessorFiles) {
    await db.exec(sqlFile(`supabase/migrations/${filename}`));
  }
  return db;
}

export async function applyDriverForward(db: PGlite) {
  const path = process.env.AGVLOG_DRIVER_ACCESS_SQL
    ?? 'supabase/migrations/20261005204938_driver_username_access.sql';
  // Run the entire final forward atomically; never slice out its preflight/guards.
  await db.exec('begin');
  try { await db.exec(sqlFile(path)); await db.exec('commit'); }
  catch (error) { await db.exec('rollback'); throw error; }
}

export async function roleQuery<T>(db: PGlite,role: 'service_role'|'authenticated'|'anon'|'supabase_auth_admin',
  query: string,params: unknown[] = []) {
  await db.exec(`begin;set local role ${role}`);
  try { const result=await db.query<T>(query,params);await db.exec('commit');return result; }
  catch (error) { await db.exec('rollback');throw error; }
}
export const prepare = (db: PGlite,driver=id.freeDriver,login=email,reservation=nonce,actor=id.admin,tenant=id.tenant) =>
  roleQuery(db,'service_role','select public.prepare_driver_access_v1($1,$2,$3,$4,$5)',
    [tenant,actor,driver,login,reservation]);
export const createAuth = (db: PGlite,user=id.newUser,login=email,reservation=nonce,
  metadata: unknown={driver_username_managed:true,driver_access_tenant_id:id.tenant}) =>
  roleQuery(db,'supabase_auth_admin',`insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data)
    values($1,$2,jsonb_build_object('agvlog_invite_nonce',$3::text),$4::jsonb) returning id`,
    [user,login,reservation,metadata]);
export const scope = (db: PGlite,user=id.legacy,retire=false,actor=id.admin,tenant=id.tenant) =>
  roleQuery<{value:Record<string,unknown>}>(db,'service_role',
    'select public.driver_access_scope_v1($1,$2,$3,$4) value',[tenant,actor,user,retire]);
export async function graphCounts(db: PGlite,user=id.newUser) {
  return (await db.query(`select
    (select count(*)::int from auth.users where id=$1) auth,
    (select count(*)::int from tenant_memberships where user_id=$1) memberships,
    (select count(*)::int from drivers where user_id=$1) links`,[user])).rows[0];
}
