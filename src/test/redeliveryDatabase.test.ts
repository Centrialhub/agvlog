// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createRedeliveryDatabase,redeliveryContext,redeliveryPayload,requestRedelivery} from './helpers/redeliveryDatabase';
import {seedUndelivered,driverPartial,ownerStatement} from './helpers/deliveryAttemptDatabase';
import {operationIds as i,operationRpc,recordOperation,operationPayload} from './helpers/operationOutcomeDatabase';
import {changeDocuments,documentChangePayload} from './helpers/documentChangesDatabase';
import {planningPayload} from './helpers/planningDatabase';
let db:PGlite;let trip:string;let stop:string;
beforeAll(async()=>{({db,trip,stop}=await createRedeliveryDatabase());},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
describe('audited delivery reallocation',()=>{
 it.each(['cte_emitted_at','nfse_emitted_at'])('does not strand issued documents after release: %s requires fiscal review first',async field=>{
  await seedUndelivered(db,stop);const payload=await redeliveryPayload(db);
  await db.query(`update fiscal_documents set ${field}=clock_timestamp() where id=$1`,[i.doc]);
  const c=await redeliveryContext(db);expect(c).toMatchObject({can_request:false,blocking_reason:'redelivery_requires_fiscal_review',remainder:null});
  await expect(requestRedelivery(db,{...payload,revision:c.revision})).rejects.toThrow('redelivery_requires_fiscal_review');
  expect((await db.query('select load_id,status from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({load_id:i.load,status:'returned'});
 });
 it.each(['redelivery','redelivery_reason','redelivery_at','delivery_attempt_id'])('protects audited metadata from a stale legacy save: %s',async key=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));await db.exec('set constraints all immediate');
  await expect(ownerStatement(db,'update fiscal_documents set delivery_meta=delivery_meta-$2::text where id=$1',[i.doc,key])).rejects.toThrow('Delivery attempt metadata requires its audited identity');
 });
 it('rejects another tenant and a driver requesting an operator-only release',async()=>{
  await seedUndelivered(db,stop);const payload=await redeliveryPayload(db);
  await expect(requestRedelivery(db,{...payload,tenant_id:i.otherTenant})).rejects.toThrow('not_authorized');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  await expect(requestRedelivery(db,payload)).rejects.toThrow('not_authorized');
  expect((await db.query('select count(*)::int n from delivery_attempts')).rows[0]).toEqual({n:0});
 });
 it('rejects another tenant load read and disallows operators impersonating the trip driver',async()=>{
  await expect(operationRpc(db,'select get_load_operational_documents($1,$2)',[i.otherTenant,i.load])).rejects.toThrow('not_authorized');
  await expect(operationRpc(db,'select get_driver_delivery_items($1)',[stop])).rejects.toThrow();
 });
 it('allows the driver to finish the original stop while preserving the released document and its old result',async()=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  const result=(await operationRpc(db,"select driver_record_delivery_outcome($1,'returned',$2::jsonb,$3,'arrived') result",[stop,
   JSON.stringify({notes:'Retorno do saldo remanescente QA',returned_items:{[i.item2]:10}}),i.request2])).rows[0].result;
  await db.exec('set constraints all immediate');expect(result).toMatchObject({trip_completed:true,applied_document_ids:[i.doc2]});
  expect((await db.query('select status,load_id from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({status:'confirmed',load_id:null});
  expect((await db.query('select count(*)::int n from delivery_document_outcomes where fiscal_document_id=$1',[i.doc])).rows[0]).toEqual({n:1});
 });
 it('releases only the current document, retaining the original items and stop allocation',async()=>{
  const first=await seedUndelivered(db,stop);const before=(await db.query('select to_jsonb(i) item from load_items i order by id')).rows;
  const result=await requestRedelivery(db,await redeliveryPayload(db));
  expect(result).toMatchObject({status:'confirmed',load_id:null,source_load_id:i.load,previous_outcome_id:first.history_id,historical_allocation_preserved:true});
  expect((await db.query('select to_jsonb(i) item from load_items i order by id')).rows).toEqual(before);
  expect((await db.query('select count(*)::int n from dispatch_stop_documents where fiscal_document_id=$1',[i.doc])).rows[0]).toEqual({n:1});
  expect((await db.query('select count(*)::int n from current_load_items where fiscal_document_id=$1',[i.doc])).rows[0]).toEqual({n:0});
 });
 it('replays a lost acknowledgement without a second attempt or event',async()=>{
  await seedUndelivered(db,stop);const payload=await redeliveryPayload(db);const result=await requestRedelivery(db,payload);
  expect(await requestRedelivery(db,payload)).toEqual(result);
  expect((await db.query('select count(*)::int n from delivery_attempts')).rows[0]).toEqual({n:1});
  await expect(requestRedelivery(db,{...payload,reason:'Outro motivo QA'})).rejects.toThrow('redelivery_key_mismatch');
 });
 it('requires a new recorded outcome before requesting another attempt',async()=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));
  expect(await redeliveryContext(db)).toMatchObject({can_request:false,blocking_reason:'redelivery_requires_recorded_outcome'});
 });
 it('preserves the old result in operation/driver readers while the document awaits a new load',async()=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));
  const operation=(await operationRpc(db,'select get_load_operational_documents($1,$2) result',[i.tenant,i.load])).rows[0].result as {documents:unknown[]};
  expect(operation.documents).toEqual(expect.arrayContaining([expect.objectContaining({id:i.doc,status:'returned',load_id:i.load,is_historical:true})]));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  const driver=(await operationRpc(db,'select get_driver_delivery_items($1) result',[stop])).rows[0].result as {items:unknown[]};
  expect(driver.items).toEqual(expect.arrayContaining([expect.objectContaining({id:i.item,document_status:'returned',is_historical:true})]));
 });
 it('allows the old trip to complete after release without using the reset status',async()=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));
  const p=await operationPayload(db,stop,i.doc2);p.request_id=i.request2;await recordOperation(db,p);await db.exec('set constraints all immediate');
  expect((await db.query('select status from dispatch_trips where id=$1',[trip])).rows[0]).toEqual({status:'completed'});
  expect((await db.query('select status from loads where id=$1',[i.load])).rows[0]).toEqual({status:'partial_delivery'});
  expect((await db.query<{docs:unknown}>("select snapshot_json->'documents' docs from driver_settlements where dispatch_trip_id=$1",[trip])).rows[0].docs)
   .toEqual(expect.arrayContaining([expect.objectContaining({id:i.doc,status:'returned',load_id:i.load})]));
 });
 it('attaches reserved new item IDs/quantities without moving historical items',async()=>{
  await seedUndelivered(db,stop);const result=await requestRedelivery(db,await redeliveryPayload(db));
  await changeDocuments(db,await documentChangePayload(db,'attach',i.load2,[i.doc]));await db.exec('set constraints all immediate');
  const items=(await db.query('select id,load_id,quantity::float8 quantity,delivery_attempt_id,source_delivery_item_id from load_items where fiscal_document_id=$1 order by load_id',[i.doc])).rows;
  expect(items).toHaveLength(2);expect(items).toEqual(expect.arrayContaining([
   expect.objectContaining({id:i.item,load_id:i.load,delivery_attempt_id:null,quantity:10}),
   expect.objectContaining({load_id:i.load2,delivery_attempt_id:result.attempt_id,source_delivery_item_id:i.item,quantity:10})]));
 });
 it('plans and delivers the second leg while retaining the first leg and preventing automatic freight reuse',async()=>{
  await db.query('update fiscal_documents set freight_value=125 where id=$1',[i.doc]);
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));
  const p=await operationPayload(db,stop,i.doc2);p.request_id=i.request2;await recordOperation(db,p);
  await changeDocuments(db,await documentChangePayload(db,'attach',i.load2,[i.doc]));
  const planned=planningPayload();planned.load_ids=[i.load2];planned.idempotency_key='b1000000-0000-4000-8000-000000000002';
  planned.stops[0].load_ids=[i.load2];planned.stops[0].fiscal_document_ids=[i.doc];
  const newTrip=(await operationRpc(db,'select dispatch_planned_route($1::jsonb) result',[JSON.stringify(planned)])).rows[0].result as string;
  const newStop=(await db.query<{id:string}>('select id from dispatch_stops where dispatch_trip_id=$1',[newTrip])).rows[0].id;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);await operationRpc(db,'select driver_start_trip($1)',[newTrip]);
  await db.query("update dispatch_stops set status='arrived',actual_arrival_at=clock_timestamp() where id=$1",[newStop]);
  const prefix=`${i.tenant}/deliveries/${newTrip}/${newStop}/`;
  await db.query("insert into storage.objects(bucket_id,name) values('receipts',$1),('receipts',$2)",[prefix+'photo.jpg',prefix+'signature.png']);
  const result=(await operationRpc(db,"select driver_record_delivery_outcome($1,'delivered',$2::jsonb,$3,'arrived') result",[newStop,JSON.stringify({receiver_name:'Recebedor QA',photo_paths:[prefix+'photo.jpg'],signature_path:prefix+'signature.png'}),'b1000000-0000-4000-8000-000000000003'])).rows[0].result;
  await db.exec('set constraints all immediate');expect(result).toMatchObject({trip_completed:true,applied_document_ids:[i.doc]});
  const settlements=(await db.query('select dispatch_trip_id,total_freight_revenue::float8 freight,needs_recalculation,recalculation_reason from driver_settlements order by dispatch_trip_id')).rows;
  expect(settlements).toEqual(expect.arrayContaining([expect.objectContaining({dispatch_trip_id:trip,freight:125}),
   expect.objectContaining({dispatch_trip_id:newTrip,freight:0,needs_recalculation:true,recalculation_reason:'redelivery_pricing_review'})]));
  expect((await db.query('select count(*)::int n from driver_settlement_payments')).rows[0]).toEqual({n:0});
 });
 it('releases only the remainder of a partial delivery and retires, without overwriting, its proof',async()=>{
  await driverPartial(db,trip,stop,{[i.item]:2});
  const proof=(await db.query<{id:string}>('select id from proof_of_delivery where fiscal_document_id=$1',[i.doc])).rows[0].id;
  const result=await requestRedelivery(db,await redeliveryPayload(db));
  expect((await db.query("select (items->0->>'quantity')::numeric::float8 quantity from delivery_attempts where id=$1",[result.attempt_id])).rows[0]).toEqual({quantity:2});
  expect((await db.query('select is_active from proof_of_delivery where id=$1',[proof])).rows[0]).toEqual({is_active:false});
 });
});
