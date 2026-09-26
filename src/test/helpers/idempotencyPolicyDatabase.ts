import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

export const idempotencyPolicyMigration='20260830061800_restrict_idempotency_key_read_scope.sql';
export const idempotencyPolicySql=readFileSync(`supabase/migrations/${idempotencyPolicyMigration}`,'utf8');
export const idempotencyPolicyContract=JSON.parse(readFileSync('docs/qa/IDEMPOTENCY-RLS-PREDEPLOYMENT-2026-08-30.json','utf8')) as {
  helper:string;helper_hash:string;policy:{using:string;hash:string};
};
export const originalIdempotencyPolicy=`create policy agvlog_select_authenticated on public.idempotency_keys
  for select to authenticated using (${idempotencyPolicyContract.policy.using});`;
export const idempotencyIds={tenant:'20000000-0000-4000-8000-000000000001',otherTenant:'20000000-0000-4000-8000-000000000002',
  user:'10000000-0000-4000-8000-000000000003',otherUser:'10000000-0000-4000-8000-000000000004',
  driver:'60000000-0000-4000-8000-000000000001',vehicle:'50000000-0000-4000-8000-000000000001',
  load:'70000000-0000-4000-8000-000000000001'};

// Executes the actual production SELECT policy, role predicate and planner body.
// This is an RLS/SQL fixture, not a full Supabase Auth or browser environment.
export async function createIdempotencyPolicyDatabase(){
  const db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,service_role;
    create table public.profiles(id uuid primary key);
    alter table public.profiles enable row level security;
    create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());
    grant select on public.profiles to authenticated;
    create table public.tenant_memberships(user_id uuid,tenant_id uuid,active boolean,role text);
    create table public.tenants(id uuid primary key);
    create table public.idempotency_keys(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,
      key_value text not null,created_at timestamptz default now(),operation text,idempotency_key text,
      payload_hash text,result_id uuid,unique(tenant_id,key_value));
    alter table public.idempotency_keys enable row level security;
    grant select,insert,update,delete on public.idempotency_keys to authenticated;
    grant all on public.idempotency_keys to service_role;
    create table public.loads(id uuid primary key,tenant_id uuid,status text,trip_id uuid,updated_at timestamptz);
    create table public.vehicles(id uuid primary key,tenant_id uuid);
    create table public.drivers(id uuid primary key,tenant_id uuid);
    create table public.clients(id uuid primary key,tenant_id uuid);
    create table public.dispatch_trips(id uuid primary key default gen_random_uuid(),tenant_id uuid,driver_id uuid,
      vehicle_id uuid,notes text,status text,planned_start_at timestamptz,created_by uuid);
    create table public.dispatch_trip_loads(tenant_id uuid,dispatch_trip_id uuid,load_id uuid,unique(dispatch_trip_id,load_id));
    create table public.dispatch_events(id uuid primary key,tenant_id uuid);
    create table public.dispatch_stops(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      dispatch_trip_id uuid,destination text,client_id uuid,stop_order integer,status text);
    create table public.fiscal_documents(id uuid primary key,tenant_id uuid);
    create table public.dispatch_stop_documents(tenant_id uuid,dispatch_stop_id uuid,fiscal_document_id uuid);
    create table public.entity_state_audit_log(tenant_id uuid,entity_type text,entity_id uuid,to_status text,
      actor_id uuid,idempotency_key text,metadata jsonb);
  `);
  await db.exec(idempotencyPolicyContract.helper+';'+originalIdempotencyPolicy);
  await db.exec(readFileSync('docs/qa/IDEMPOTENCY-CONSUMERS-2026-08-30.sql','utf8'));
  return db;
}

export async function seedIdempotencyPolicy(db:PGlite){
  const i=idempotencyIds;
  await db.exec(`rollback;reset role;alter table public.idempotency_keys enable row level security;
    drop policy if exists agvlog_select_authenticated on public.idempotency_keys;
    drop policy if exists qa_unexpected_policy on public.idempotency_keys;
    truncate public.profiles,public.tenants,public.tenant_memberships,public.idempotency_keys,public.loads,public.vehicles,
      public.drivers,public.dispatch_trips,public.dispatch_trip_loads,public.dispatch_stops,public.dispatch_stop_documents,
      public.entity_state_audit_log;`+idempotencyPolicyContract.helper+';'+originalIdempotencyPolicy);
  await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',i.user]);
  await db.query('insert into profiles values($1),($2)',[i.user,i.otherUser]);
  await db.query('insert into tenants values($1),($2)',[i.tenant,i.otherTenant]);
  await db.query("insert into tenant_memberships values($1,$2,true,'operator'),($3,$4,true,'operator')",[i.user,i.tenant,i.otherUser,i.otherTenant]);
  await db.query("insert into idempotency_keys(tenant_id,key_value) values($1,'own'),($2,'foreign')",[i.tenant,i.otherTenant]);
  await db.query('insert into vehicles values($1,$2)',[i.vehicle,i.tenant]);
  await db.query('insert into drivers values($1,$2)',[i.driver,i.tenant]);
  await db.query("insert into loads(id,tenant_id,status) values($1,$2,'planned')",[i.load,i.tenant]);
}
