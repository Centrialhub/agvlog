// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const migration=readFileSync('supabase/migrations/20260910182124_enforce_driver_delivery_gps_and_refusal_evidence.sql','utf8');
const evidenceMigration=readFileSync('supabase/migrations/20260910190649_enforce_driver_delivery_receipt_evidence.sql','utf8');
const ids={
  tenant:'20000000-0000-4000-8000-000000000001',trip:'80000000-0000-4000-8000-000000000001',
  stop:'82000000-0000-4000-8000-000000000001',event:'83000000-0000-4000-8000-000000000001',
  proof:'93000000-0000-4000-8000-000000000001',
};
let db:PGlite;

const details={
  latitude:-23.55052,longitude:-46.633308,accuracy_m:8,
  photo_paths:[`${ids.tenant}/deliveries/${ids.trip}/${ids.stop}/receipt/processed/scan.jpg`],
  receipt_original_path:`${ids.tenant}/deliveries/${ids.trip}/${ids.stop}/receipt/original/photo.jpg`,
  receipt_processed_path:`${ids.tenant}/deliveries/${ids.trip}/${ids.stop}/receipt/processed/scan.jpg`,
  signature_path:`${ids.tenant}/deliveries/${ids.trip}/${ids.stop}/signatures/signature.png`,
  receipt_original_hash:'a'.repeat(64),receipt_processed_hash:'b'.repeat(64),
  receipt_scan_mode:'document_scan',receipt_scan_quality:{accepted:true,sharpness:10},
  receipt_crop:{left:.02,top:.02,right:.98,bottom:.98},receipt_rotation:0,
  receipt_quality_confirmed:true,captured_at:'2026-09-10T18:00:00.000Z',
};

async function insertEvent(eventType:string,eventDetails:Record<string,unknown>,id=ids.event){
  return db.query(`insert into public.dispatch_events(id,tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,payload)
    values($1,$2,$3,$4,$5,$6::jsonb)`,[id,ids.tenant,ids.trip,ids.stop,eventType,
    JSON.stringify({source:'driver_app',delivery_request:{details:eventDetails}})]);
}

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create schema storage;create table storage.objects(bucket_id text not null,name text not null,primary key(bucket_id,name));
    create table public.dispatch_events(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,dispatch_stop_id uuid,event_type text,payload jsonb);
    create table public.dispatch_stop_documents(tenant_id uuid,dispatch_stop_id uuid,fiscal_document_id uuid);
    create table public.delivery_test_items(id uuid,tenant_id uuid,dispatch_stop_id uuid);
    create function public._delivery_items_for_stop(_stop_id uuid) returns setof public.delivery_test_items language sql stable
      as $$select * from public.delivery_test_items where dispatch_stop_id=_stop_id$$;
    create table public.proof_of_delivery(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,dispatch_stop_id uuid,
      metadata jsonb not null default '{}',latitude numeric(10,8),longitude numeric(11,8),accuracy numeric);
  `);
  await db.exec(migration);
  await db.exec(evidenceMigration);
});
beforeEach(async()=>{
  await db.exec('truncate public.proof_of_delivery,public.dispatch_events,public.dispatch_stop_documents,public.delivery_test_items,storage.objects');
  for(const name of [details.receipt_original_path,details.receipt_processed_path,details.signature_path])
    await db.query("insert into storage.objects values('receipts',$1)",[name]);
});
afterAll(async()=>{await db?.close();});

describe('driver delivery evidence database boundary',()=>{
  it.each(['stop_returned','stop_refused'])('rejects %s without a photographic proof',async eventType=>{
    await expect(insertEvent(eventType,{notes:'Cliente recusou',photo_paths:[]})).rejects.toMatchObject({code:'22023'});
    const photo=`${ids.tenant}/deliveries/${ids.trip}/${ids.stop}/refusal.jpg`;
    await db.query("insert into storage.objects values('receipts',$1)",[photo]);
    await expect(insertEvent(eventType,{notes:'Cliente recusou',photo_paths:[photo]})).resolves.toBeDefined();
  });

  it.each(['delivery_delivered','stop_partial_delivery'])('rejects %s without accurate delivery GPS',async eventType=>{
    const withoutGps={...details};delete (withoutGps as Partial<typeof details>).latitude;
    await expect(insertEvent(eventType,withoutGps)).rejects.toMatchObject({code:'22023'});
    await expect(insertEvent(eventType,{...details,accuracy_m:151})).rejects.toMatchObject({code:'22023'});
  });

  it.each([
    ['missing original',{receipt_original_path:null}],
    ['missing processed',{receipt_processed_path:null}],
    ['missing signature',{signature_path:null}],
    ['invalid original hash',{receipt_original_hash:'invalid'}],
    ['legacy photo',{receipt_scan_mode:'legacy_photo'}],
    ['rejected quality',{receipt_scan_quality:{accepted:false}}],
    ['unconfirmed quality',{receipt_quality_confirmed:false}],
  ])('rejects delivered evidence with %s',async(_label,change)=>{
    await expect(insertEvent('delivery_delivered',{...details,...change})).rejects.toMatchObject({code:'22023'});
  });

  it('requires stored scan objects and accepts the complete document scan',async()=>{
    await db.query("delete from storage.objects where name=$1",[details.receipt_processed_path]);
    await expect(insertEvent('delivery_delivered',details)).rejects.toMatchObject({code:'22023'});
    await db.query("insert into storage.objects values('receipts',$1)",[details.receipt_processed_path]);
    await expect(insertEvent('delivery_delivered',details)).resolves.toBeDefined();
  });

  it.each(['stop_returned','stop_refused'])('requires all affected items for %s and snapshots linked documents',async eventType=>{
    const item='94000000-0000-4000-8000-000000000001',document='95000000-0000-4000-8000-000000000001';
    const photo=`${ids.tenant}/deliveries/${ids.trip}/${ids.stop}/refusal.jpg`;
    await db.query("insert into storage.objects values('receipts',$1)",[photo]);
    await db.query('insert into public.delivery_test_items values($1,$2,$3)',[item,ids.tenant,ids.stop]);
    await db.query('insert into public.dispatch_stop_documents values($1,$2,$3)',[ids.tenant,ids.stop,document]);
    await expect(insertEvent(eventType,{photo_paths:[photo],returned_items:{}})).rejects.toMatchObject({code:'22023'});
    await expect(insertEvent(eventType,{photo_paths:[photo],returned_items:{[item]:1}})).resolves.toBeDefined();
    const payload=(await db.query<{payload:{affected_document_ids:string[]}}>('select payload from public.dispatch_events')).rows[0].payload;
    expect(payload.affected_document_ids).toEqual([document]);
  });

  it('hydrates proof coordinates and the complete immutable scan snapshot before receipt materialization',async()=>{
    await insertEvent('delivery_delivered',details);
    await db.query(`insert into public.proof_of_delivery(id,tenant_id,dispatch_trip_id,dispatch_stop_id,metadata)
      values($1,$2,$3,$4,$5::jsonb)`,[ids.proof,ids.tenant,ids.trip,ids.stop,JSON.stringify({event_id:ids.event,outcome:'delivered'})]);
    const proof=(await db.query('select latitude::float8 latitude,longitude::float8 longitude,accuracy::float8 accuracy,metadata from public.proof_of_delivery')).rows[0] as Record<string,unknown>;
    expect(proof).toMatchObject({latitude:details.latitude,longitude:details.longitude,accuracy:details.accuracy_m,
      metadata:expect.objectContaining({receipt_original_path:details.receipt_original_path,
        receipt_processed_path:details.receipt_processed_path,receipt_original_hash:details.receipt_original_hash,
        receipt_processed_hash:details.receipt_processed_hash,receipt_scan_quality:details.receipt_scan_quality,
        latitude:details.latitude,longitude:details.longitude,accuracy_m:details.accuracy_m})});
  });

  it('does not impose the driver-app contract on unrelated event producers',async()=>{
    await expect(db.query(`insert into public.dispatch_events values($1,$2,$3,$4,'stop_refused',$5::jsonb)`,
      [ids.event,ids.tenant,ids.trip,ids.stop,JSON.stringify({source:'operator'})])).resolves.toBeDefined();
  });
});
