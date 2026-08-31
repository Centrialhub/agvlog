// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDeliveryDocument, createDeliveryDatabase, deliveryDetails, deliveryIds as i, recordDelivery, seedDelivery } from './helpers/deliveryDatabase';

let db: PGlite;
beforeAll(async () => { db = await createDeliveryDatabase(); }, 30000);
beforeEach(async () => { await seedDelivery(db); });
afterAll(async () => { await db?.close(); });
const state = async () => (await db.query(`select
  (select status from public.dispatch_stops where id='${i.stop}') stop,
  (select status from public.dispatch_trips where id='${i.trip}') trip,
  (select status from public.loads where id='${i.load}') load,
  (select status from public.fiscal_documents where id='${i.doc}') document,
  (select count(*)::int from public.dispatch_events) events,
  (select count(*)::int from public.operational_events) occurrences,
  (select count(*)::int from public.proof_of_delivery) proofs,
  (select count(*)::int from public.entity_audit_log) audits`)).rows[0];
const partial = (items: Record<string, number>) => ({...deliveryDetails,returned_items:items,return_reason:'Embalagem danificada'});

async function secondLoad(sharedStop = true) {
  await db.query(`insert into public.loads(id,tenant_id,trip_id,status) values($1,$2,$3,'in_transit')`,[i.load2,i.tenant,i.trip]);
  await db.query('insert into public.dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)',[i.tenant,i.trip,i.load2]);
  if (!sharedStop) await db.query(`insert into public.dispatch_stops(id,tenant_id,dispatch_trip_id,status,actual_arrival_at)
    values($1,$2,$3,'arrived',now())`,[i.stop2,i.tenant,i.trip]);
  await addDeliveryDocument(db,i.doc2,i.item2,i.load2,sharedStop ? i.stop : i.stop2);
}

describe('atomic driver delivery in PostgreSQL', () => {
  it('writes proofs, internal occurrence, document/stop/load/trip and audit together', async () => {
    await db.exec('set role authenticated');
    const result = (await recordDelivery(db)).rows[0].result;
    expect(result).toMatchObject({trip_completed:true,replayed:false,updated_load_ids:[i.load],updated_document_ids:[i.doc]});
    expect(result.pod_ids).toHaveLength(1);
    await db.exec('reset role');
    expect(await state()).toMatchObject({stop:'delivered',trip:'completed',load:'delivered',document:'delivered',events:2,occurrences:1,proofs:1,audits:3});
    expect((await db.query('select visible_to_client,report_details from public.operational_events')).rows[0]).toMatchObject({
      visible_to_client:false,report_details:{receiver_name:deliveryDetails.receiver_name,photo_paths:deliveryDetails.photo_paths}});
  });

  it('replays the committed result after trip closure without rechecking removed storage', async () => {
    const first = (await recordDelivery(db)).rows[0].result;
    await db.exec('delete from storage.objects');
    const replay = (await recordDelivery(db)).rows[0].result;
    expect(replay).toEqual({...first,replayed:true});
    expect(await state()).toMatchObject({events:2,proofs:1,occurrences:1});
  });
  it('supports content-based replay for the legacy finalize signature', async () => {
    const run = () => db.query('select public.driver_finalize_delivery($1,$2,$3,$4::text[]) result',
      [i.stop,deliveryDetails.receiver_name,deliveryDetails.signature_path,deliveryDetails.photo_paths]);
    const first = await run(); const second = await run();
    expect(second.rows[0]).toMatchObject({result:{...(first.rows[0] as {result:object}).result,replayed:true}});
  });
  it('rejects an idempotency key reused with different content', async () => {
    await recordDelivery(db);
    await expect(recordDelivery(db,'delivered',{...deliveryDetails,notes:'Changed'})).rejects.toMatchObject({code:'23505'});
  });
  it('ignores an informational payload pretending to be a completed delivery', async () => {
    await db.query(`insert into public.dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,payload,created_by)
      values($1,$2,$3,'info_entregue',$4::jsonb,$5)`,[i.tenant,i.trip,i.stop,JSON.stringify({client_event_id:i.request,delivery_result:{replayed:true}}),i.user]);
    expect((await recordDelivery(db)).rows[0].result).toMatchObject({replayed:false,trip_completed:true});
  });
  it.each(['anon','authenticated','service_role'])('denies %s execution of private derivation', async role => {
    await db.exec(`set role ${role}`);
    await expect(db.query('select public._derive_driver_delivery_result($1,$2)',[i.tenant,i.trip])).rejects.toMatchObject({code:'42501'});
  });
  it.each(['','10000000-0000-4000-8000-000000000099'])('denies missing or unrelated auth identity %s', async user => {
    await db.query('select set_config($1,$2,false)',['request.jwt.claim.sub',user]);
    await expect(recordDelivery(db)).rejects.toMatchObject({code:'42501'});
    expect(await state()).toMatchObject({events:0,proofs:0,stop:'arrived'});
  });
  it('denies anonymous execution of the public API', async () => {
    await db.exec('set role anon');
    await expect(recordDelivery(db)).rejects.toMatchObject({code:'42501'});
  });
  it('denies inactive drivers', async () => {
    await db.exec('update public.drivers set active=false');
    await expect(recordDelivery(db)).rejects.toMatchObject({code:'42501'});
  });
  it.each(['planned','cancelled',null])('never invents a start for %s trips', async status => {
    await db.query('update public.dispatch_trips set status=$1,actual_start_at=null',[status]);
    await expect(recordDelivery(db)).rejects.toHaveProperty('code');
    expect((await db.query('select actual_start_at from public.dispatch_trips')).rows[0]).toEqual({actual_start_at:null});
  });
  it('requires actual start even if the trip label is in_transit', async () => {
    await db.exec('update public.dispatch_trips set actual_start_at=null');
    await expect(recordDelivery(db)).rejects.toMatchObject({code:'23514'});
  });
  it('requires arrival and does not fabricate it while finalizing', async () => {
    await db.exec('update public.dispatch_stops set actual_arrival_at=null');
    await expect(recordDelivery(db)).rejects.toMatchObject({code:'23514'});
    expect(await state()).toMatchObject({events:0,proofs:0});
  });
  it('rejects stale stop state without writes', async () => {
    await expect(recordDelivery(db,'delivered',deliveryDetails,i.request,'planned')).rejects.toMatchObject({code:'40001'});
    expect(await state()).toMatchObject({events:0,proofs:0});
  });
  it.each([
    null, [], {receiver_name:3}, {...deliveryDetails,receiver_name:'A'}, {...deliveryDetails,photo_paths:[]},
    {...deliveryDetails,signature_path:null}, {...deliveryDetails,photo_paths:[4]},
    {...deliveryDetails,photo_paths:Array(6).fill(deliveryDetails.photo_paths[0])},
    {...deliveryDetails,returned_items:{[i.item]:1}}, {...deliveryDetails,notes:'x'.repeat(2001)},
  ])('rejects malformed/incomplete delivery details %#', async details => {
    await expect(recordDelivery(db,'delivered',details)).rejects.toMatchObject({code:'22023'});
    expect(await state()).toMatchObject({events:0,proofs:0,trip:'in_transit'});
  });
  it.each(['outside/photo.jpg',`${i.tenant}/deliveries/../photo.jpg`,`${i.tenant}/deliveries/missing.jpg`])('rejects unbound/missing proof %s', async path => {
    await expect(recordDelivery(db,'delivered',{...deliveryDetails,photo_paths:[path]})).rejects.toMatchObject({code:'42501'});
  });
  it('rolls every write back when a document is already finalized differently', async () => {
    await db.exec("update public.fiscal_documents set status='returned'");
    await expect(recordDelivery(db)).rejects.toMatchObject({code:'23514'});
    expect(await state()).toMatchObject({stop:'arrived',load:'in_transit',document:'returned',events:0,occurrences:0,proofs:0,audits:0});
  });
  it('fills an empty pending POD placeholder and preserves its identity', async () => {
    const existing = await db.query<{id:string}>(`insert into public.proof_of_delivery(tenant_id,fiscal_document_id,status)
      values($1,$2,'pending') returning id`,[i.tenant,i.doc]);
    const result = (await recordDelivery(db)).rows[0].result;
    expect(result.pod_ids).toEqual([existing.rows[0].id]);
  });
  it.each(['uploaded','validated','rejected'])('does not overwrite %s proof', async status => {
    await db.query(`insert into public.proof_of_delivery(tenant_id,fiscal_document_id,status,storage_path)
      values($1,$2,$3,'existing-evidence')`,[i.tenant,i.doc,status]);
    await expect(recordDelivery(db)).rejects.toMatchObject({code:'23514'});
    expect(await state()).toMatchObject({stop:'arrived',events:0,occurrences:0,proofs:1});
  });
  it('does not mark unrelated loads delivered when their stops are still pending', async () => {
    await secondLoad(false); await recordDelivery(db);
    expect((await db.query('select id,status from public.loads order by id')).rows).toEqual([{id:i.load,status:'delivered'},{id:i.load2,status:'in_transit'}]);
    expect(await state()).toMatchObject({trip:'in_transit',load:'delivered'});
    await recordDelivery(db,'refused',{notes:'Cliente recusou'},null,'arrived',i.stop2);
    expect((await db.query('select id,status from public.loads order by id')).rows).toEqual([{id:i.load,status:'delivered'},{id:i.load2,status:'refused'}]);
    expect(await state()).toMatchObject({trip:'completed'});
  });
  it('splits a partial stop into delivered and returned documents/loads', async () => {
    await secondLoad(); const result = (await recordDelivery(db,'partial_delivery',partial({[i.item2]:10}))).rows[0].result;
    expect(result.pod_ids).toHaveLength(1);
    expect((await db.query('select id,status from public.loads order by id')).rows).toEqual([{id:i.load,status:'delivered'},{id:i.load2,status:'returned'}]);
    expect((await db.query('select id,status from public.fiscal_documents order by id')).rows).toEqual([{id:i.doc,status:'delivered'},{id:i.doc2,status:'returned'}]);
    expect(await state()).toMatchObject({trip:'completed',stop:'partial_delivery'});
  });
  it('computes partial document/load when only some items are returned', async () => {
    await recordDelivery(db,'partial_delivery',partial({[i.item]:3}));
    expect(await state()).toMatchObject({trip:'completed',stop:'partial_delivery',document:'partial_delivery',load:'partial_delivery',proofs:1});
  });
  it.each([{}, {[i.item]:0}, {[i.item]:10}, {[i.item]:11}, {[i.item]:-1}, {[i.item2]:2}, {[i.item]:'2'}])('rejects invalid partial quantities %#', async items => {
    await expect(recordDelivery(db,'partial_delivery',{...deliveryDetails,returned_items:items})).rejects.toMatchObject({code:'22023'});
    expect(await state()).toMatchObject({events:0,proofs:0,stop:'arrived'});
  });
  it('requires reliable quantities for every document in a partial stop', async () => {
    await secondLoad(); await db.query('delete from public.load_items where id=$1',[i.item2]);
    await expect(recordDelivery(db,'partial_delivery',partial({[i.item]:3}))).rejects.toMatchObject({code:'23514'});
    expect(await state()).toMatchObject({events:0,proofs:0,stop:'arrived'});
  });
  it('rejects partial selection mislabeled as total return', async () => {
    await expect(recordDelivery(db,'returned',partial({[i.item]:3}))).rejects.toMatchObject({code:'22023'});
  });
  it.each(['returned','refused','failed','skipped','cancelled'])('retains exception %s instead of delivering the load', async outcome => {
    await recordDelivery(db,outcome,{notes:'Motivo de teste'});
    expect(await state()).toMatchObject({trip:'completed',stop:outcome,load:outcome==='skipped'?'failed':outcome,document:outcome==='skipped'?'not_delivered':outcome,proofs:0});
  });
  it('uses the sole canonical load when a document does not carry load_id', async () => {
    await db.exec('update public.dispatch_stop_documents set load_id=null; update public.fiscal_documents set load_id=null');
    expect((await recordDelivery(db)).rows[0].result.updated_load_ids).toEqual([i.load]);
    expect((await db.query('select load_id from public.proof_of_delivery')).rows[0]).toEqual({load_id:i.load});
  });
  it('does not guess a load when a shared-trip document has no mapping', async () => {
    await secondLoad(); await db.query('update public.dispatch_stop_documents set load_id=null where fiscal_document_id=$1',[i.doc]);
    await db.query('update public.fiscal_documents set load_id=null where id=$1',[i.doc]);
    await expect(recordDelivery(db)).rejects.toMatchObject({code:'23514'});
  });
  it('rejects tenant-corrupted document links', async () => {
    await db.exec("update public.dispatch_stop_documents set tenant_id='20000000-0000-4000-8000-000000000099'");
    await expect(recordDelivery(db)).rejects.toMatchObject({code:'23514'});
  });
  it('rejects a document repeated across stops instead of delivering it twice', async () => {
    await db.query(`insert into public.dispatch_stops(id,tenant_id,dispatch_trip_id,status) values($1,$2,$3,'planned')`,[i.stop2,i.tenant,i.trip]);
    await db.query('insert into public.dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id,load_id) values($1,$2,$3,$4)',[i.tenant,i.stop2,i.doc,i.load]);
    await expect(recordDelivery(db)).rejects.toMatchObject({code:'23514'});
  });
  it('closes legacy arrival/delivered bypasses through update_stop_status', async () => {
    for (const status of ['arrived','departed','completed','delivered']) {
      await expect(db.query('select public.driver_update_stop_status($1,$2,$3)',[i.stop,status,'Teste'])).rejects.toMatchObject({code:'22023'});
    }
    expect(await state()).toMatchObject({events:0,proofs:0,stop:'arrived'});
  });

  it.each(['avaria','solicitar_desconto','atualizar_boleto','coleta_realizada','outros'])('persists %s for operations without changing delivery status', async type => {
    await db.exec('set role authenticated');
    const run = () => db.query<{result:{event_id:string;operational_event_id:string;replayed:boolean}}>(
      'select public.driver_record_delivery_note($1,$2,$3::jsonb,$4) result',[i.stop,type,JSON.stringify(deliveryDetails),i.request]);
    const first=(await run()).rows[0].result; const second=(await run()).rows[0].result;
    expect(second).toEqual({...first,replayed:true});
    await db.exec('reset role');
    expect(await state()).toMatchObject({stop:'arrived',trip:'in_transit',load:'in_transit',document:'in_transit',proofs:0,occurrences:1,events:2});
    expect((await db.query('select visible_to_client,payload from public.operational_events')).rows[0]).toMatchObject({visible_to_client:false,payload:{approval_granted:false}});
  });
  it('does not reuse a note key for a delivery result', async () => {
    await db.query('select public.driver_record_delivery_note($1,$2,$3::jsonb,$4)',[i.stop,'outros',JSON.stringify(deliveryDetails),i.request]);
    await expect(recordDelivery(db)).rejects.toMatchObject({code:'23505'});
    expect(await state()).toMatchObject({stop:'arrived',occurrences:1,events:2,proofs:0});
  });
  it.each(['delivered','arrival','trip_started','approval'])('rejects forged note type %s', async type => {
    await expect(db.query('select public.driver_record_delivery_note($1,$2,$3::jsonb,$4)',[i.stop,type,JSON.stringify(deliveryDetails),i.request])).rejects.toMatchObject({code:'22023'});
  });
  it('rejects note photos outside the stop and rolls back the occurrence', async () => {
    await expect(db.query('select public.driver_record_delivery_note($1,$2,$3::jsonb,$4)',[i.stop,'avaria',JSON.stringify({...deliveryDetails,photo_paths:['other/photo.png']}),i.request])).rejects.toMatchObject({code:'42501'});
    expect(await state()).toMatchObject({occurrences:0,events:0});
  });
});
