import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
export const id = {
  tenant: '20000000-0000-4000-8000-000000000001', driverUser: '10000000-0000-4000-8000-000000000001',
  operator: '10000000-0000-4000-8000-000000000002', owner: '10000000-0000-4000-8000-000000000003',
  driver: '60000000-0000-4000-8000-000000000001', vehicle: '70000000-0000-4000-8000-000000000001',
  trip: '80000000-0000-4000-8000-000000000001', load: '81000000-0000-4000-8000-000000000001',
  stop: '82000000-0000-4000-8000-000000000001', nfe: '83000000-0000-4000-8000-000000000001',
  nfse: '84000000-0000-4000-8000-000000000001', receipt: '85000000-0000-4000-8000-000000000001',
};

export const weightMigration="supabase/migrations/20261006131127_enforce_driver_trip_cargo_weight_precision.sql";
export const weightRollback="docs/qa/driver-cargo-weight-server-rollback-2026-10-06.sql";
export const sqlFile=(p:string)=>readFileSync(p,'utf8');
// Actual cargo predecessor SQL; Auth/tenant settings and dependent schema are synthetic.
export async function setupWeightDatabase(apply=true){
 const db=new PGlite();
 await db.exec(`    create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;create schema private;create schema storage;grant usage on schema private to authenticated,service_role;
    create table storage.objects(bucket_id text,name text,primary key(bucket_id,name));
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function private.request_tenant_id() returns uuid language sql stable as $$select nullif(current_setting('test.active_tenant',true),'')::uuid$$;
    grant execute on function private.request_tenant_id() to authenticated,service_role;
    create table tenants(id uuid primary key);
    create table tenant_memberships(tenant_id uuid,user_id uuid,active boolean,role text);
    create table drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean);
    create table vehicles(id uuid primary key,tenant_id uuid,plate text);
    create table dispatch_trips(id uuid primary key,tenant_id uuid,load_id uuid,driver_id uuid,vehicle_id uuid,status text,actual_start_at timestamptz,updated_at timestamptz default now());
    create table loads(id uuid primary key,tenant_id uuid,total_volume_m3 numeric,total_pallet_count integer,total_weight_kg numeric,
      supplier_manifest text,distribution_manifest text,shipment_manifest text,origin_manifest text,os_number text,external_load_number text,control_load_number text);
    create table dispatch_trip_loads(id uuid default gen_random_uuid(),tenant_id uuid,dispatch_trip_id uuid,load_id uuid);
    create table fiscal_documents(id uuid primary key,tenant_id uuid,load_id uuid,invoice_number text,reference_number text,deleted_at timestamptz,volume_count numeric);
    create table cte_documents(id uuid primary key,tenant_id uuid,load_ids uuid[],fiscal_document_ids uuid[],cte_number text,reference_number text,status text,cancelled_at timestamptz,is_voided boolean);
    create table nfse_documents(id uuid primary key,tenant_id uuid,load_id uuid,trip_id uuid,fiscal_document_ids uuid[],related_cte_ids uuid[],nfse_number text,invoice_number text,rps_number text,status text,cancelled boolean,is_preview boolean);
    create table dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,status text);
    create table dispatch_events(id uuid default gen_random_uuid(),tenant_id uuid,dispatch_trip_id uuid,event_type text,payload jsonb,created_by uuid,event_at timestamptz default clock_timestamp());
    create table delivery_receipts(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,dispatch_stop_id uuid,is_active boolean,physical_status text);
    create table audit_log(id uuid default gen_random_uuid(),tenant_id uuid,entity_type text,entity_id uuid,action text,new_data jsonb);
    create function _log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) returns void language sql as
      $$insert into public.audit_log(tenant_id,entity_type,entity_id,action,new_data) values($1,$2,$3,$4,$6)$$;
    insert into auth.users values('${id.driverUser}'),('${id.operator}'),('${id.owner}');
    insert into tenants values('${id.tenant}');
    insert into tenant_memberships values('${id.tenant}','${id.driverUser}',true,'driver'),('${id.tenant}','${id.operator}',true,'operator'),('${id.tenant}','${id.owner}',true,'owner');
    insert into drivers values('${id.driver}','${id.tenant}','${id.driverUser}',true);
    insert into vehicles values('${id.vehicle}','${id.tenant}','AAA1A11');
`);
 for(const file of ['20260910142606_driver_trip_cargo_custody_cycle.sql','20260910191008_harden_trip_cargo_custody_integrity.sql','20260910194438_complete_trip_cargo_seal_lifecycle.sql'])
  await db.exec(sqlFile('supabase/migrations/'+file));
 if(apply)await db.exec(sqlFile(weightMigration));
 return db;
}
export async function setActor(db:PGlite,user=id.driverUser,tenant=id.tenant){
 await db.query("select set_config('test.active_tenant',$1,false),set_config('request.jwt.claim.sub',$2,false)",[tenant,user]);
}
export async function seedWeightDatabase(db:PGlite,expected='100'){
 await db.exec(`reset role;truncate trip_cargo_commands,trip_cargo_divergences,trip_cargo_evidence,trip_cargo_seals,
    trip_cargo_document_checks,trip_cargo_load_checks,trip_cargo_controls,delivery_receipts,dispatch_events,dispatch_stops,
    nfse_documents,cte_documents,fiscal_documents,dispatch_trip_loads,loads,dispatch_trips,audit_log,storage.objects;
    insert into dispatch_trips values('${id.trip}','${id.tenant}','${id.load}','${id.driver}','${id.vehicle}','planned',null,now());
    insert into loads values('${id.load}','${id.tenant}',10,2,100,'SUP-1',null,null,null,null,null,null);
    insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values('${id.tenant}','${id.trip}','${id.load}');
    insert into fiscal_documents values('${id.nfe}','${id.tenant}','${id.load}','NF-101',null,null,10);
    insert into nfse_documents values('${id.nfse}','${id.tenant}','${id.load}','${id.trip}',array['${id.nfe}']::uuid[],array[]::uuid[],'NFS-7',null,null,'issued',false,false);
    insert into dispatch_stops values('${id.stop}','${id.tenant}','${id.trip}','delivered');
    insert into storage.objects values('receipts','${id.tenant}/trip-cargo/${id.trip}/load.jpg'),
      ('receipts','${id.tenant}/trip-cargo/${id.trip}/tie.jpg'),
      ('receipts','${id.tenant}/trip-cargo/${id.trip}/seal-install.jpg'),
      ('receipts','${id.tenant}/trip-cargo/${id.trip}/seal-install-2.jpg'),
      ('receipts','${id.tenant}/trip-cargo/${id.trip}/seal-return.jpg'),
      ('receipts','${id.tenant}/trip-cargo/${id.trip}/seal-return-2.jpg'),
      ('receipts','${id.tenant}/trip-cargo/${id.trip}/seal-broken.jpg');
`);
 await db.query('update loads set total_weight_kg=$1::numeric where id=$2',[expected,id.load]);
 await setActor(db);
}
export async function command(db:PGlite,request:string,action:string,payload:unknown={},tenant=id.tenant,trip=id.trip){
 await db.exec('set role authenticated');
 try{return (await db.query<{result:Record<string,unknown>}>(
  'select public.driver_update_trip_cargo_v1($1,$2,$3,$4,$5::jsonb) result',
  [tenant,trip,request,action,JSON.stringify(payload)])).rows[0].result;}
 finally{await db.exec('reset role');}
}
export async function accept(db:PGlite){return command(db,'90000000-0000-4000-8000-000000000090','accept',{vehicle_id:id.vehicle});}
export async function confirmation(db:PGlite,weight:unknown){
 const docs=(await db.query<{id:string}>('select id from trip_cargo_document_checks')).rows.map(row=>row.id);
 return {vehicle_checked:true,tie_down_confirmed:true,seal_not_applicable_reason:'Veículo sem ponto de lacre',documents:docs,
  loads:[{load_id:id.load,volume_count:10,pallet_count:2,weight_kg:weight}],evidence:[
   {kind:'loading',path:id.tenant+'/trip-cargo/'+id.trip+'/load.jpg'},
   {kind:'tie_down',path:id.tenant+'/trip-cargo/'+id.trip+'/tie.jpg'}]};
}
export async function catalog(db:PGlite){return (await db.query<{oid:number;schema:string;proname:string;prosrc:string;proowner:number;proacl:string|null;proconfig:string[]|null}>(
 "select oid,pronamespace::regnamespace::text schema,proname,prosrc,proowner,proacl::text,proconfig from pg_proc where pronamespace in('private'::regnamespace,'public'::regnamespace) order by oid")).rows;}
export async function effects(db:PGlite){return (await db.query(
 "select (select jsonb_agg(to_jsonb(t) order by id) from trip_cargo_load_checks t) checks,(select jsonb_agg(to_jsonb(t) order by id) from trip_cargo_document_checks t) docs,(select count(*) from trip_cargo_commands) commands,(select count(*) from audit_log) audits,(select count(*) from trip_cargo_divergences) divergences")).rows[0];}
