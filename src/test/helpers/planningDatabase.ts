import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createDeliveryDatabase,deliveryIds} from './deliveryDatabase.ts';
import {installDeliveryFinancialFixture} from './deliveryFinancialDatabase.ts';
import {legacyTripLoadSchema,tripLoadCandidateSql} from './tripLoadDatabase.ts';

export const planningMigration='20260830062933_harden_dispatch_planned_route.sql';
export const planningCandidateSql=readFileSync(`supabase/migrations/${planningMigration}`,'utf8');
export const planningContract=JSON.parse(readFileSync('docs/qa/PLANNING-PREDEPLOYMENT-2026-08-30.json','utf8')) as {
  functions:{signature:string;definition:string;hash:string;anon:boolean;authenticated:boolean;service_role:boolean}[];
};
export const planningIds={...deliveryIds,operator:'10000000-0000-4000-8000-000000000011',
  otherTenant:'20000000-0000-4000-8000-000000000002',vehicle:'50000000-0000-4000-8000-000000000001',
  otherVehicle:'50000000-0000-4000-8000-000000000002',otherDriver:'60000000-0000-4000-8000-000000000002',
  client:'30000000-0000-4000-8000-000000000001',otherClient:'30000000-0000-4000-8000-000000000002',
  draft:'40000000-0000-4000-8000-000000000001'};

// Extends the shared delivery/financial fixture, so planning feeds the same
// canonical graph as real start/delivery SQL. Not a full Supabase environment.
export async function installPlanningFixture(db:PGlite){
  await db.exec(`
    create type public.app_role as enum('owner','admin','operator','driver','client');
    create table public.tenant_memberships(user_id uuid,tenant_id uuid,role public.app_role,active boolean);
    create table public.vehicles(id uuid primary key,tenant_id uuid,active boolean);
    create table public.clients(id uuid primary key,tenant_id uuid,active boolean);
    create table public.route_planning_drafts(id uuid primary key,tenant_id uuid,status text,converted_load_id uuid,updated_at timestamptz);
    create table public.idempotency_keys(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,
      key_value text not null,operation text,idempotency_key text,payload_hash text,result_id uuid,created_at timestamptz default now(),
      unique(tenant_id,key_value));
    alter table public.idempotency_keys enable row level security;
    grant select,insert,update,delete on public.idempotency_keys to authenticated;
    grant all on public.idempotency_keys to service_role;
    alter table public.dispatch_trips alter column id set default gen_random_uuid(),add column planned_start_at timestamptz,
      add column created_by uuid,add column created_at timestamptz default now();
    alter table public.dispatch_stops alter column id set default gen_random_uuid(),add column planned_arrival_at timestamptz,
      add column estimated_departure_at timestamptz,add column service_time_minutes integer,
      add column delivery_window_start time,add column delivery_window_end time,
      add column if not exists latitude numeric,add column if not exists longitude numeric,add column risk_level text,add column risk_reason text;
    alter table public.loads add column if not exists on_hold boolean default false;
    alter table public.dispatch_stop_documents add unique(dispatch_stop_id,fiscal_document_id);
    create table if not exists public.load_status_history(tenant_id uuid,load_id uuid,field_name text,
      old_value text,new_value text,reason text,created_by uuid);
    create or replace function public.is_tenant_admin(uuid) returns boolean language sql stable security definer set search_path='' as
      $$select exists(select 1 from public.tenant_memberships where tenant_id=$1 and user_id=auth.uid() and active and role::text in('owner','admin'))$$;
    create or replace function public.has_tenant_role(uuid,public.app_role) returns boolean language sql stable security definer set search_path='' as
      $$select exists(select 1 from public.tenant_memberships where tenant_id=$1 and user_id=auth.uid() and active and role=$2)$$;
    create or replace function public.current_driver_id(uuid) returns uuid language sql stable as
      $$select id from public.drivers where tenant_id=$1 and user_id=auth.uid() and active$$;
  `);
  for(const f of planningContract.functions.filter(f=>!f.signature.startsWith('plan_dispatch_trip_v3'))){
    await db.exec(f.definition+';');
    await db.exec(`revoke all on function public.${f.signature} from public,anon,authenticated,service_role;`+
      (f.authenticated?`grant execute on function public.${f.signature} to authenticated;`:'')+
      (f.service_role?`grant execute on function public.${f.signature} to service_role;`:''));
  }
  await db.exec(`create policy agvlog_select_authenticated on public.idempotency_keys for select to authenticated
    using((select auth.uid()) is not null and public.is_tenant_operator_or_admin(tenant_id));`);
}

export async function createPlanningDatabase({candidate=false,graph=true}:{candidate?:boolean;graph?:boolean}={}){
  const db=await createDeliveryDatabase();await installDeliveryFinancialFixture(db);await installPlanningFixture(db);
  await db.exec(readFileSync('docs/qa/TRIP-LOAD-TRIGGERS-2026-08-30.sql','utf8')+legacyTripLoadSchema+`
    create trigger trg_sync_trip_load_mirrors after insert or delete on public.dispatch_trip_loads for each row execute function public.sync_trip_load_mirrors();
    create trigger trg_check_load_dispatch_duplicity before insert on public.dispatch_trip_loads for each row execute function public.check_load_dispatch_duplicity();
    create trigger trg_dispatch_trip_loads_outdate after insert or update or delete on public.dispatch_trip_loads for each row execute function public._tg_mark_outdated_trip_loads();`);
  if(graph)await db.exec(tripLoadCandidateSql);
  if(candidate)await db.exec(planningCandidateSql);
  return db;
}

export function planningPayload(){const i=planningIds;return {tenant_id:i.tenant,vehicle_id:i.vehicle,driver_id:i.driver,
  planned_start_at:'2030-01-01T10:00:00Z',route_name:'QA route',load_ids:[i.load],idempotency_key:i.request,
  stops:[{destination:'Cliente QA',client_id:i.client,load_ids:[i.load],fiscal_document_ids:[i.doc,i.doc2],
    latitude:-23.5,longitude:-46.6,service_time_minutes:20,risk_level:'normal'}]};}

export async function seedPlanning(db:PGlite){
  const i=planningIds;
  await db.exec(`rollback;reset role;truncate public.driver_settlement_items,public.driver_settlement_events,public.driver_settlement_payments,
    public.driver_settlements,public.driver_expenses,public.trip_routes,public.qa_delivery_side_effects,public.proof_of_delivery,
    public.operational_events,public.dispatch_events,public.load_items,public.dispatch_stop_documents,public.fiscal_documents,
    public.dispatch_stops,public.dispatch_trip_loads,public.dispatch_trips,public.loads,public.drivers,public.vehicles,public.clients,
    public.tenant_memberships,public.idempotency_keys,public.route_planning_drafts,public.load_status_history,public.entity_audit_log;`);
  await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',i.operator]);
  await db.query("insert into tenant_memberships values($1,$2,'operator',true),($3,$2,'driver',true)",[i.operator,i.tenant,i.user]);
  await db.query('insert into drivers values($1,$2,$3,true),($4,$5,null,true)',[i.driver,i.tenant,i.user,i.otherDriver,i.otherTenant]);
  await db.query('insert into vehicles values($1,$2,true),($3,$4,true)',[i.vehicle,i.tenant,i.otherVehicle,i.otherTenant]);
  await db.query('insert into clients values($1,$2,true),($3,$4,true)',[i.client,i.tenant,i.otherClient,i.otherTenant]);
  await db.query("insert into loads(id,tenant_id,status,on_hold,updated_at) values($1,$2,'planned',false,now()),($3,$2,'planned',false,now())",[i.load,i.tenant,i.load2]);
  await db.query("insert into fiscal_documents(id,tenant_id,load_id,client_id,status) values($1,$2,$3,$4,'confirmed'),($5,$2,$3,$4,'confirmed')",[i.doc,i.tenant,i.load,i.client,i.doc2]);
  await db.query('insert into load_items values($1,$2,$3,$4,10),($5,$2,$3,$6,10)',[i.item,i.tenant,i.load,i.doc,i.item2,i.doc2]);
  await db.query("insert into route_planning_drafts values($1,$2,'draft',null,now())",[i.draft,i.tenant]);
}

export async function dispatchPlanning(db:PGlite,payload:unknown=planningPayload()){
  await db.exec('set role authenticated');
  try{return (await db.query<{trip:string}>('select public.dispatch_planned_route($1::jsonb) trip',[JSON.stringify(payload)])).rows[0].trip;}
  finally{await db.exec('reset role');}
}
