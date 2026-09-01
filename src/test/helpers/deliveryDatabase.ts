import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

export const deliveryIds = {
  tenant: '20000000-0000-4000-8000-000000000001',
  user: '10000000-0000-4000-8000-000000000003',
  driver: '60000000-0000-4000-8000-000000000001',
  trip: '80000000-0000-4000-8000-000000000001',
  stop: '82000000-0000-4000-8000-000000000001',
  stop2: '82000000-0000-4000-8000-000000000002',
  load: '70000000-0000-4000-8000-000000000001',
  load2: '70000000-0000-4000-8000-000000000002',
  doc: '90000000-0000-4000-8000-000000000001',
  doc2: '90000000-0000-4000-8000-000000000002',
  item: '91000000-0000-4000-8000-000000000001',
  item2: '91000000-0000-4000-8000-000000000002',
  request: 'a0000000-0000-4000-8000-000000000001',
};
export const deliveryMigration = '20260830050226_enforce_delivery_outcome_atomicity.sql';
export const deliveryCutoverMigration = '20260901002245_cutover_legacy_driver_delivery_writers.sql';
export interface LegacyDeliveryContract {
  signature:string;definition:string;definition_hash:string;authenticated:boolean;service_role:boolean;anon:boolean;
}
export const legacyDeliveryContracts=(JSON.parse(readFileSync(
  join(process.cwd(),'docs/qa/DELIVERY-ROLLOUT-PREDEPLOYMENT-2026-08-30.json'),'utf8',
)) as {functions:LegacyDeliveryContract[]}).functions;
export const legacyDeliverySchema=legacyDeliveryContracts.map(contract=>[
  contract.definition+';',
  `revoke all on function public.${contract.signature} from public,anon,authenticated,service_role;`,
  ...(['anon','authenticated','service_role'] as const).filter(role=>contract[role])
    .map(role=>`grant execute on function public.${contract.signature} to ${role};`),
].join('\n')).join('\n');
export const proofPrefix = `${deliveryIds.tenant}/deliveries/${deliveryIds.trip}/${deliveryIds.stop}/`;
export const deliveryDetails = {
  receiver_name: 'Recebedor QA', notes: 'Teste local',
  photo_paths: [`${proofPrefix}photo.jpg`], signature_path: `${proofPrefix}signatures/sign.png`,
};

// Shared by PGlite and the native, multi-session PostgreSQL test harness.
// This minimal fixture does not replace a full Supabase/RLS integration test.
export const deliverySchema = `
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create table public.drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean);
    create table public.loads(id uuid primary key,tenant_id uuid,trip_id uuid,status text,updated_at timestamptz);
    create table public.dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid,load_id uuid,vehicle_id uuid,
      status text,actual_start_at timestamptz,actual_end_at timestamptz,updated_at timestamptz);
    create table public.dispatch_trip_loads(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      dispatch_trip_id uuid references public.dispatch_trips(id),load_id uuid references public.loads(id),
      created_at timestamptz default now(),unique(dispatch_trip_id,load_id));
    create table public.dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid references public.dispatch_trips(id),
      client_id uuid,status text,destination text,notes text,actual_arrival_at timestamptz,actual_departure_at timestamptz,updated_at timestamptz);
    create table public.fiscal_documents(id uuid primary key,tenant_id uuid,load_id uuid,client_id uuid,status text,
      document_type text default 'inbound',updated_at timestamptz);
    create table public.dispatch_stop_documents(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      dispatch_stop_id uuid references public.dispatch_stops(id),fiscal_document_id uuid references public.fiscal_documents(id),load_id uuid);
    create table public.load_items(id uuid primary key,tenant_id uuid,load_id uuid,fiscal_document_id uuid,quantity numeric);
    create table public.dispatch_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,dispatch_trip_id uuid,
      dispatch_stop_id uuid,event_type text not null,payload jsonb default '{}',notes text,created_by uuid default auth.uid(),
      event_at timestamptz not null default clock_timestamp(),created_at timestamptz default now());
    create table public.operational_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,client_id uuid,load_id uuid,
      vehicle_id uuid,driver_id uuid,dispatch_trip_id uuid,dispatch_stop_id uuid,fiscal_document_id uuid,event_type text,severity text,
      description text,visible_to_client boolean,client_action_required boolean,public_status text,payload jsonb,created_by uuid,report_details jsonb);
    create table public.proof_of_delivery(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,
      fiscal_document_id uuid not null unique,load_id uuid,dispatch_trip_id uuid,dispatch_stop_id uuid,proof_type text,
      status text check(status in('pending','uploaded','validated','rejected','missing')),storage_bucket text,storage_path text,
      receiver_name text,receiver_document text,receiver_role text,received_at timestamptz,metadata jsonb not null default '{}',created_by uuid,
      updated_at timestamptz,photo_url text,signature_url text);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
    create table public.entity_audit_log(id uuid default gen_random_uuid(),tenant_id uuid,entity_type text,entity_id uuid,
      action text,old_value jsonb,new_value jsonb,source text);
    create function public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) returns void language sql as $$
      insert into public.entity_audit_log(tenant_id,entity_type,entity_id,action,old_value,new_value,source) values($1,$2,$3,$4,$5,$6,$7)$$;
    create function public.stop_terminal_statuses() returns text[] language sql immutable as $$
      select array['completed','delivered','cancelled','skipped','refused','returned','partial_delivery','failed']::text[]$$;
  `;

export const deliveryMigrations = ['20260830024309_enforce_driver_journey_state_machine.sql',
  '20260830013356_harden_driver_occurrence_scope.sql', deliveryMigration];

export async function createDeliveryDatabase({cutover=true}:{cutover?:boolean}={}) {
  const db = new PGlite();
  await db.exec(deliverySchema);
  await db.exec(legacyDeliverySchema);
  for (const file of deliveryMigrations) {
    await db.exec(readFileSync(join(process.cwd(), 'supabase/migrations', file), 'utf8'));
  }
  if(cutover)await db.exec(readFileSync(join(process.cwd(),'supabase/migrations',deliveryCutoverMigration),'utf8'));
  return db;
}

export async function seedDelivery(db: PGlite) {
  const i = deliveryIds;
  await db.exec(`reset role; truncate public.proof_of_delivery,public.operational_events,public.dispatch_events,
    public.load_items,public.dispatch_stop_documents,public.fiscal_documents,public.dispatch_stops,
    public.dispatch_trip_loads,public.dispatch_trips,public.loads,public.drivers,storage.objects,public.entity_audit_log;`);
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', i.user]);
  await db.query('insert into public.drivers values($1,$2,$3,true)', [i.driver,i.tenant,i.user]);
  await db.query(`insert into public.dispatch_trips(id,tenant_id,driver_id,load_id,status,actual_start_at)
    values($1,$2,$3,$4,'in_transit',now()-interval '1 hour')`, [i.trip,i.tenant,i.driver,i.load]);
  await db.query(`insert into public.loads(id,tenant_id,trip_id,status) values($1,$2,$3,'ready')`, [i.load,i.tenant,i.trip]);
  await db.query('insert into public.dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)', [i.tenant,i.trip,i.load]);
  await db.query(`update public.loads set status='in_transit' where id=$1`,[i.load]);
  await db.query(`insert into public.dispatch_stops(id,tenant_id,dispatch_trip_id,status,destination,actual_arrival_at)
    values($1,$2,$3,'arrived','Cliente QA',now())`, [i.stop,i.tenant,i.trip]);
  await addDeliveryDocument(db, i.doc,i.item,i.load,i.stop);
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2),($1,$3)',
    ['receipts',deliveryDetails.photo_paths[0],deliveryDetails.signature_path]);
}

export async function addDeliveryDocument(db: PGlite, doc: string, item: string, load: string, stop: string) {
  await db.query(`insert into public.fiscal_documents(id,tenant_id,load_id,status) values($1,$2,$3,'in_transit')`, [doc,deliveryIds.tenant,load]);
  await db.query('insert into public.dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id,load_id) values($1,$2,$3,$4)',
    [deliveryIds.tenant,stop,doc,load]);
  await db.query('insert into public.load_items values($1,$2,$3,$4,10)', [item,deliveryIds.tenant,load,doc]);
}

export function recordDelivery(db: PGlite, outcome = 'delivered', details: unknown = deliveryDetails,
  request: string | null = deliveryIds.request, expected: string | null = 'arrived', stop = deliveryIds.stop) {
  return db.query<{ result: { event_id: string; operational_event_id: string; pod_ids: string[];
    updated_load_ids: string[]; updated_document_ids: string[]; trip_completed: boolean; replayed: boolean } }>(
    'select public.driver_record_delivery_outcome($1,$2,$3::jsonb,$4,$5) result', [stop,outcome,JSON.stringify(details),request,expected]);
}
