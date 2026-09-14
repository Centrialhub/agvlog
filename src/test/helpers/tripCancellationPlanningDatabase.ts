import {readFileSync} from 'node:fs';
import {createPlanningDatabase,seedPlanning} from './planningDatabase';
import {cancellationSql} from './tripCancellationDatabase';
export async function createTripCancellationPlanningDatabase(){
 const db=await createPlanningDatabase({candidate:true});await seedPlanning(db);
 await db.exec(`create schema private;grant usage on schema auth to authenticated;grant select,update on dispatch_stops to authenticated;create table tenants(id uuid primary key);
 create function private.is_request_tenant_member(t uuid) returns boolean language sql stable as $$select t=nullif(current_setting('test.tenant',true),'')::uuid and exists(select 1 from public.tenant_memberships where tenant_id=t and user_id=auth.uid() and active)$$;
 alter table entity_audit_log add column old_data jsonb,add column new_data jsonb,add column actor_user_id uuid,add column actor_role text;
 alter table fiscal_documents add column if not exists deleted_at timestamptz;
 create view current_load_items as select * from load_items;
 create view current_dispatch_stop_documents as select * from dispatch_stop_documents;
 create view delivery_allocation_documents as select d.id allocation_id,f.* from dispatch_stop_documents d join fiscal_documents f on f.id=d.fiscal_document_id;
 create table physical_journeys(id uuid primary key,status text,actual_start_at timestamptz,actual_end_at timestamptz,updated_at timestamptz);
 create table physical_journey_trips(physical_journey_id uuid references physical_journeys(id),dispatch_trip_id uuid references dispatch_trips(id));`);
 for(const [,table,column] of cancellationSql.matchAll(/\('([a-z_]+)','(dispatch_trip_id|trip_id)'\)/g)){
  const exists=(await db.query<{present:boolean}>('select to_regclass($1) is not null present',['public.'+table])).rows[0].present;
  if(!exists)await db.exec(`create table public.${table}(id uuid primary key default gen_random_uuid(),tenant_id uuid,${column} uuid references dispatch_trips(id));`);
 }
 const captured=JSON.parse(readFileSync('docs/qa/trip-cancellation-predecessors-2026-09-14.json','utf8').replace(/^\uFEFF/,'')) as Array<{signature:string,definition:string}>;
 for(const f of captured){await db.exec(f.definition);await db.exec('revoke all on function public.'+f.signature+' from public,anon,authenticated,service_role');}
 await db.exec('grant execute on function public.is_tenant_operator_or_admin(uuid) to authenticated,service_role;grant execute on function public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) to service_role');
 await db.exec(`alter table dispatch_stops add column location_source text,add column location_address text,add column location_provider text,
 add column location_accuracy_m double precision,add column location_confidence double precision,add column location_resolved_at timestamptz,
 add column location_resolved_by uuid,add column location_audit jsonb,add column geofence_radius_m double precision,
 add column location_exception_reason text,add column location_exception_at timestamptz,add column location_exception_by uuid;`);
 const dispatch=JSON.parse(readFileSync('docs/qa/trip-cancellation-dispatch-trace-2026-09-14.json','utf8').replace(/^\uFEFF/,'')) as Array<{signature:string,definition:string}>;
 for(const f of dispatch){await db.exec(f.definition);await db.exec('revoke all on function public.'+f.signature+' from public,anon,service_role;grant execute on function public.'+f.signature+' to authenticated');}
 await db.exec(cancellationSql);return db;
}
