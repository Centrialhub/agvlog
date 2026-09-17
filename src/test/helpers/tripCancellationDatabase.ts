import {readFileSync} from 'node:fs';
import {createTripLoadDatabase} from './tripLoadDatabase';
export const cancellationSql=readFileSync('supabase/migrations/20260914200012_audited_planned_trip_cancellation.sql','utf8');
export async function createTripCancellationDatabase(){
 const db=await createTripLoadDatabase();
 await db.exec(`create schema private;
 grant usage on schema private to authenticated;
 create table tenants(id uuid primary key);
 create table tenant_memberships(tenant_id uuid,user_id uuid,active boolean,role text);
 create function private.is_request_tenant_member(t uuid) returns boolean language sql stable as $$select t=nullif(current_setting('test.tenant',true),'')::uuid and exists(select 1 from public.tenant_memberships where tenant_id=t and user_id=auth.uid() and active)$$;
 create table entity_audit_log(id uuid default gen_random_uuid(),tenant_id uuid,entity_type text,entity_id uuid,action text,old_data jsonb,new_data jsonb,actor_user_id uuid,actor_role text,source text);
 create table dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid references dispatch_trips(id),status text,actual_arrival_at timestamptz,actual_departure_at timestamptz,updated_at timestamptz);
 create table fiscal_documents(id uuid primary key,tenant_id uuid,load_id uuid,document_type text,status text,cte_emitted_at timestamptz,cte_emitted_outbound_id uuid,nfse_emitted_at timestamptz);
 create table dispatch_stop_documents(id uuid primary key,tenant_id uuid,dispatch_stop_id uuid references dispatch_stops(id),fiscal_document_id uuid,load_id uuid);
 create view current_dispatch_stop_documents as select * from dispatch_stop_documents;
 create table load_items(id uuid primary key,tenant_id uuid,load_id uuid,fiscal_document_id uuid);
 create view current_load_items as select * from load_items;
 alter table fiscal_documents add column deleted_at timestamptz;
 create view delivery_allocation_documents as select d.id allocation_id,f.* from dispatch_stop_documents d join fiscal_documents f on f.id=d.fiscal_document_id;
 create table physical_journeys(id uuid primary key,status text,actual_start_at timestamptz,actual_end_at timestamptz,updated_at timestamptz);
 create table physical_journey_trips(physical_journey_id uuid references physical_journeys(id),dispatch_trip_id uuid references dispatch_trips(id));
 alter table dispatch_trip_loads add primary key(id);
 `);
 // Dependency-only relations: tests verify existence blocking, not these domains' writers.
 const relations=[...cancellationSql.matchAll(/\('([a-z_]+)','(dispatch_trip_id|trip_id)'\)/g)];
 for(const [,table,column] of relations){
  const exists=(await db.query<{present:boolean}>('select to_regclass($1) is not null present',['public.'+table])).rows[0].present;
  if(!exists)await db.exec(`create table public.${table}(id uuid primary key default gen_random_uuid(),tenant_id uuid,${column} uuid references dispatch_trips(id));`);
 }
 const captured=JSON.parse(readFileSync('docs/qa/trip-cancellation-predecessors-2026-09-14.json','utf8').replace(/^\uFEFF/,'')) as Array<{signature:string,definition:string}>;
 await db.exec('drop function public.is_tenant_operator_or_admin(uuid)');
 for(const f of captured){await db.exec(f.definition);await db.exec('revoke all on function public.'+f.signature+' from public,anon,authenticated,service_role');}
 await db.exec('grant execute on function public.is_tenant_operator_or_admin(uuid) to authenticated,service_role;grant execute on function public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) to service_role');
 await db.exec(cancellationSql);
 return db;
}

export const tripCancellationIds={tenant:'20000000-0000-4000-8000-000000000001',actor:'10000000-0000-4000-8000-000000000001'};
export async function seedPlannedCancellationTrip(db:Awaited<ReturnType<typeof createTripCancellationDatabase>>){
 const {tenant,actor}=tripCancellationIds;const trip=crypto.randomUUID(),load=crypto.randomUUID(),stop=crypto.randomUUID();
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('test.tenant',$2,false)",[actor,tenant]);
 await db.query('insert into tenants values($1) on conflict do nothing',[tenant]);
 if(!(await db.query('select 1 from tenant_memberships where tenant_id=$1 and user_id=$2',[tenant,actor])).rows.length)await db.query("insert into tenant_memberships values($1,$2,true,'admin')",[tenant,actor]);
 await db.query("insert into dispatch_trips(id,tenant_id,status) values($1,$2,'planned')",[trip,tenant]);
 await db.query("insert into loads(id,tenant_id,status) values($1,$2,'ready')",[load,tenant]);
 await db.query('insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)',[tenant,trip,load]);
 await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status) values($1,$2,$3,'pending')",[stop,tenant,trip]);
 await db.query("insert into physical_journeys(id,status) values($1,'planned')",[trip]);await db.query('insert into physical_journey_trips values($1,$1)',[trip]);
 return {tenant,actor,trip,load,stop};
}
