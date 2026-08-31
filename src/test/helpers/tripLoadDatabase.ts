import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const tripLoadMigration='20260830002627_enforce_trip_load_transit_invariant.sql';
export const tripLoadCandidateSql=readFileSync(`supabase/migrations/${tripLoadMigration}`,'utf8');
export interface TripLoadContract {signature:string;definition:string;hash:string;anon:boolean;authenticated:boolean;service_role:boolean;comment:string|null}
export const tripLoadRolloutContracts=JSON.parse(readFileSync('docs/qa/TRIP-LOAD-ROLLOUT-CONTRACTS-2026-08-30.json','utf8')) as {
  functions:TripLoadContract[];mirror_trigger:string;
};
export const legacyTripLoadSchema=tripLoadRolloutContracts.functions.map(f=>[
  f.definition+';',`revoke all on function public.${f.signature} from public,anon,authenticated,service_role;`,
  ...(['anon','authenticated','service_role'] as const).filter(role=>f[role]).map(role=>`grant execute on function public.${f.signature} to ${role};`),
  `comment on function public.${f.signature} is ${f.comment?"'"+f.comment.replace(/'/g,"''")+"'":'null'};`,
].join('\n')).join('\n');

// Minimal PostgreSQL schema plus captured production contracts. Native tests
// add real foreign keys and financial triggers; neither fixture is full Supabase.
export async function createTripLoadDatabase({candidate=true}:{candidate?:boolean}={}){
  const db=new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean);
    create table public.dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid,vehicle_id uuid,
      load_id uuid,status text,actual_start_at timestamptz,actual_end_at timestamptz,updated_at timestamptz);
    create table public.loads(id uuid primary key,tenant_id uuid,trip_id uuid,status text,
      driver_id uuid,vehicle_id uuid,on_hold boolean default false,updated_at timestamptz);
    create table public.dispatch_trip_loads(id uuid default gen_random_uuid(),tenant_id uuid,
      dispatch_trip_id uuid,load_id uuid);
    create table public.dispatch_events(id uuid default gen_random_uuid(),tenant_id uuid,
      dispatch_trip_id uuid,event_type text,payload jsonb,created_by uuid);
    create table public.load_status_history(tenant_id uuid,load_id uuid,field_name text,old_value text,
      new_value text,reason text,created_by uuid);
    create function public.current_driver_id(p_tenant uuid) returns uuid language sql stable as
      $$select id from public.drivers where tenant_id=p_tenant and user_id=auth.uid() and active$$;
    create function public.is_tenant_operator_or_admin(p_tenant uuid) returns boolean language sql stable as
      $$select p_tenant='20000000-0000-4000-8000-000000000001'::uuid and current_setting('test.operator',true)='true'$$;
    create function public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) returns void
      language plpgsql as $$begin return;end;$$;
  `);
  await db.exec(legacyTripLoadSchema);await db.exec(tripLoadRolloutContracts.mirror_trigger+';');
  if(candidate)await db.exec(tripLoadCandidateSql);
  return db;
}
