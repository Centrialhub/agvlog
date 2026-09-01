import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

export const storageEvidenceMigration='20260901210627_protect_linked_storage_evidence.sql';
export const storageEvidenceSql=()=>readFileSync('supabase/migrations/'+storageEvidenceMigration,'utf8');
export const evidenceIds={
 tenant:'ee000000-0000-4000-8000-000000000001',otherTenant:'ee000000-0000-4000-8000-000000000002',
 operator:'ee000000-0000-4000-8000-000000000003',driverUser:'ee000000-0000-4000-8000-000000000004',
 driver:'ee000000-0000-4000-8000-000000000005',trip:'ee000000-0000-4000-8000-000000000006',
 stop:'ee000000-0000-4000-8000-000000000007',doc:'ee000000-0000-4000-8000-000000000008',
};

const schema=`
create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;
create function auth.uid() returns uuid language sql stable set search_path=''
 as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant execute on function auth.uid() to authenticated;
create table tenant_memberships(tenant_id uuid,user_id uuid,role text,active boolean,unique(tenant_id,user_id));
create table drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean);
create table dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid);
create table dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid);
create table proof_of_delivery(id uuid primary key default gen_random_uuid(),tenant_id uuid,fiscal_document_id uuid,
 storage_bucket text,storage_path text,photo_url text,signature_url text,metadata jsonb default '{}',is_active boolean default true);
create table dispatch_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,payload jsonb);
create table operational_events(id uuid primary key default gen_random_uuid(),tenant_id uuid,payload jsonb,report_details jsonb);
create table driver_expenses(id uuid primary key default gen_random_uuid(),tenant_id uuid,receipt_url text);
create table driver_settlement_payments(id uuid primary key default gen_random_uuid(),tenant_id uuid,receipt_url text);
create table payables(id uuid primary key default gen_random_uuid(),tenant_id uuid,receipt_url text);
create table occurrence_return_sheets(id uuid primary key default gen_random_uuid(),tenant_id uuid,signed_proof_url text);
create table pallet_return_protocols(id uuid primary key default gen_random_uuid(),tenant_id uuid,signed_proof_url text);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema public,storage to authenticated,service_role;
grant select on all tables in schema public to authenticated;
grant select,delete on storage.objects to authenticated,service_role;
create policy receipts_tenant_delete on storage.objects for delete to authenticated using(bucket_id='receipts');
`;

export async function createStorageEvidenceDatabase(){
 const db=new PGlite();await db.exec(schema);const i=evidenceIds;
 await db.query("insert into tenant_memberships values($1,$2,'operator',true),($1,$3,'driver',true)",[i.tenant,i.operator,i.driverUser]);
 await db.query('insert into drivers values($1,$2,$3,true)',[i.driver,i.tenant,i.driverUser]);
 await db.query('insert into dispatch_trips values($1,$2,$3)',[i.trip,i.tenant,i.driver]);
 await db.query('insert into dispatch_stops values($1,$2,$3)',[i.stop,i.tenant,i.trip]);
 await db.exec(storageEvidenceSql());return db;
}

export async function asRole<T=Record<string,unknown>>(db:PGlite,role:'authenticated'|'service_role',actor:string|null,sql:string,params:unknown[]=[]){
 await db.exec('begin');
 try{
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[actor??'']);await db.exec('set role '+role);
  const result=await db.query<T>(sql,params);await db.exec('reset role;commit');return result;
 }catch(error){await db.exec('rollback');throw error;}
}

export const receiptPath=(name:string)=>evidenceIds.tenant+'/deliveries/'+evidenceIds.trip+'/'+evidenceIds.stop+'/'+name;
