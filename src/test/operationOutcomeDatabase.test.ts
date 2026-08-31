// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createOperationDatabase,operationIds as i,operationPayload,recordOperation} from './helpers/operationOutcomeDatabase';
import {operationRpc as compositionRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite;let trip:string;let stop:string;
beforeAll(async()=>{({db,trip,stop}=await createOperationDatabase());},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function rejected(work:()=>Promise<unknown>,pattern:RegExp){await db.exec('savepoint refused');await expect(work()).rejects.toThrow(pattern);await db.exec('rollback to savepoint refused;release savepoint refused');}
const counts=async()=> (await db.query(`select (select count(*)::int from delivery_document_outcomes) histories,
 (select count(*)::int from proof_of_delivery) proofs,(select count(*)::int from driver_settlement_payments) payments`)).rows[0];
async function driverDetails(returnedItems:Record<string,number>={}){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);const prefix=`${i.tenant}/deliveries/${trip}/${stop}/`;
 await db.query("insert into storage.objects(bucket_id,name) values('receipts',$1),('receipts',$2)",[prefix+'photo.jpg',prefix+'signatures/sign.png']);
 return {notes:'Devolução conferida pelo motorista',receiver_name:'Recebedor motorista',photo_paths:[prefix+'photo.jpg'],signature_path:prefix+'signatures/sign.png',returned_items:returnedItems};
}
describe('operation per-document outcome transaction',()=>{
 it('records one note, leaves the other unchanged, retains metadata and marks manual proof pending',async()=>{
  const otherBefore=(await db.query('select * from fiscal_documents where id=$1',[i.doc2])).rows;
  await db.query("update fiscal_documents set delivery_meta='{"+'"payment_method":"pix"'+"}' where id=$1",[i.doc]);
  const result=await recordOperation(db,await operationPayload(db,stop));
  expect(result).toMatchObject({document_id:i.doc,outcome:'delivered',proof_pending:true,stop_status:'arrived',trip_completed:false});
  expect((await db.query('select * from fiscal_documents where id=$1',[i.doc2])).rows).toEqual(otherBefore);
  expect((await db.query('select status,received_at,storage_path,receiver_name from proof_of_delivery')).rows[0]).toEqual({status:'pending',received_at:null,storage_path:null,receiver_name:'Recebedor QA'});
  expect((await db.query("select delivery_meta->>'payment_method' method from fiscal_documents where id=$1",[i.doc])).rows[0]).toEqual({method:'pix'});
  expect(await counts()).toEqual({histories:1,proofs:1,payments:0});
 });
 it('closes mixed results only when all notes are final without inventing physical departure or payment',async()=>{
  await recordOperation(db,await operationPayload(db,stop));
  const next=await operationPayload(db,stop,i.doc2,'returned');next.request_id=i.request2;await recordOperation(db,next);
  expect((await db.query('select status,actual_departure_at from dispatch_stops where id=$1',[stop])).rows[0]).toEqual({status:'partial_delivery',actual_departure_at:null});
  expect((await db.query('select status from loads where id=$1',[i.load])).rows[0]).toEqual({status:'partial_delivery'});
  expect((await db.query('select status from dispatch_trips where id=$1',[trip])).rows[0]).toEqual({status:'completed'});
  expect((await db.query('select status from driver_settlements')).rows[0]).toEqual({status:'pending_review'});expect(await counts()).toEqual({histories:2,proofs:1,payments:0});
 });
 it('replays exactly and rejects key reuse with another body',async()=>{
  const payload=await operationPayload(db,stop);const first=await recordOperation(db,payload);expect(await recordOperation(db,payload)).toEqual(first);
  await rejected(()=>recordOperation(db,{...payload,reason:'Outro motivo diferente'}),/key_mismatch/);expect(await counts()).toEqual({histories:1,proofs:1,payments:0});
 });
 it('keeps a snapshot after later legacy metadata changes and forbids editing/deleting history',async()=>{
  await recordOperation(db,await operationPayload(db,stop));const before=(await db.query('select * from delivery_document_outcomes')).rows;
  await db.query("update fiscal_documents set delivery_meta='{}' where id=$1",[i.doc]);
  expect((await db.query('select * from delivery_document_outcomes')).rows).toEqual(before);
  await rejected(()=>db.exec("update delivery_document_outcomes set outcome='failed'"),/append-only/);
  await rejected(()=>db.exec('delete from delivery_document_outcomes'),/append-only/);
 });
 it('rejects a stale revision with no partial event/proof',async()=>{
  const payload=await operationPayload(db,stop);await db.query("update fiscal_documents set delivery_meta='{"+'"payment_method":"pix"'+"}' where id=$1",[i.doc]);
  await rejected(()=>recordOperation(db,payload),/context_changed/);expect(await counts()).toEqual({histories:0,proofs:0,payments:0});
 });
 it.each([
  ['request_id',null],['outcome','partial_delivery'],['outcome','confirmed'],['reason','x'],['reason',123456],['receiver_name',''],['occurred_at','infinity'],['occurred_at','2999-01-01T00:00:00Z'],['occurred_at','2000-01-01T00:00:00Z'],['occurred_at','2026-08-30T12:00:00'],
 ])('rejects invalid %s input %s',async(field,value)=>{await rejected(async()=>recordOperation(db,{...await operationPayload(db,stop),[field]:value}),/invalid_operation_outcome|invalid_time/);expect(await counts()).toEqual({histories:0,proofs:0,payments:0});});
 it('rejects another tenant, revoked operator and driver impersonation',async()=>{
  const payload=await operationPayload(db,stop);
  await rejected(()=>recordOperation(db,{...payload,tenant_id:i.otherTenant}),/not_authorized/);
  await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);
  await rejected(()=>recordOperation(db,payload),/not_authorized/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  await rejected(()=>recordOperation(db,payload),/not_authorized/);
 });
 it('requires the selected stop, started trip and actual arrival',async()=>{
  const payload=await operationPayload(db,stop);await rejected(()=>recordOperation(db,{...payload,stop_id:i.stop2}),/invalid_stop/);
  await db.query('update dispatch_stops set actual_arrival_at=null where id=$1',[stop]);
  await rejected(async()=>recordOperation(db,await operationPayload(db,stop)),/requires_arrival/);
 });
 it('does not overwrite an existing physical proof',async()=>{
  await db.query("insert into proof_of_delivery(tenant_id,fiscal_document_id,load_id,dispatch_trip_id,dispatch_stop_id,proof_type,status,storage_path) values($1,$2,$3,$4,$5,'signature','uploaded','original')",[i.tenant,i.doc,i.load,trip,stop]);
  await rejected(async()=>recordOperation(db,await operationPayload(db,stop)),/proof_requires_review/);
  expect((await db.query('select storage_path from proof_of_delivery')).rows[0]).toEqual({storage_path:'original'});
 });
 it('captures canonical driver outcomes without changing the driver result',async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);const prefix=`${i.tenant}/deliveries/${trip}/${stop}/`;
  await db.query("insert into storage.objects(bucket_id,name) values('receipts',$1),('receipts',$2)",[prefix+'photo.jpg',prefix+'signatures/sign.png']);
  const details={receiver_name:'Motorista recebedor',photo_paths:[prefix+'photo.jpg'],signature_path:prefix+'signatures/sign.png'};
  await compositionRpc(db,"select driver_record_delivery_outcome($1,'delivered',$2::jsonb,$3,'arrived')",[stop,JSON.stringify(details),i.request]);
  expect(await counts()).toEqual({histories:2,proofs:2,payments:0});
  expect((await db.query("select distinct source,outcome from delivery_document_outcomes")).rows).toEqual([{source:'driver',outcome:'delivered'}]);
  await compositionRpc(db,"select driver_record_delivery_outcome($1,'delivered',$2::jsonb,$3,'arrived')",[stop,JSON.stringify(details),i.request]);expect(await counts()).toEqual({histories:2,proofs:2,payments:0});
 });
 it('keeps private writers denied and history read isolated by tenant',async()=>{
  await recordOperation(db,await operationPayload(db,stop));
  expect((await compositionRpc(db,'select count(*)::int n from delivery_document_outcomes')).rows[0]).toEqual({n:1});
  await db.query('update tenant_memberships set tenant_id=$1 where user_id=$2',[i.otherTenant,i.operator]);
  expect((await compositionRpc(db,'select count(*)::int n from delivery_document_outcomes')).rows[0]).toEqual({n:0});
  await rejected(()=>compositionRpc(db,'delete from delivery_document_outcomes'),/permission denied/);
  expect((await db.query("select has_function_privilege('anon','record_operation_document_outcome(jsonb)','execute') anon,has_function_privilege('authenticated','_snapshot_delivery_document_outcome(uuid,uuid,text,timestamptz)','execute') helper")).rows[0]).toEqual({anon:false,helper:false});
 });
 it.each(['returned','refused','failed','skipped','cancelled','partial_delivery'])('preserves the canonical driver %s branch and captures its evidence',async(outcome)=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);const prefix=`${i.tenant}/deliveries/${trip}/${stop}/`;
  await db.query("insert into storage.objects(bucket_id,name) values('receipts',$1),('receipts',$2)",[prefix+'photo.jpg',prefix+'signatures/sign.png']);
  const details={notes:'Motivo informado pelo motorista',receiver_name:'Recebedor motorista',photo_paths:[prefix+'photo.jpg'],signature_path:prefix+'signatures/sign.png',returned_items:outcome==='partial_delivery'?{[i.item]:1}:{}};
  await compositionRpc(db,'select driver_record_delivery_outcome($1,$2,$3::jsonb,$4,\'arrived\')',[stop,outcome,JSON.stringify(details),i.request]);
  expect((await db.query('select status from dispatch_stops where id=$1',[stop])).rows[0]).toEqual({status:outcome});
  expect((await db.query('select count(*)::int n from delivery_document_outcomes')).rows[0]).toEqual({n:2});
  expect((await db.query('select count(*)::int n from driver_settlement_payments')).rows[0]).toEqual({n:0});
 });
 it('captures a legacy null allocation load using its validated fiscal mirror without rewriting the allocation',async()=>{
  await db.query('update dispatch_stop_documents set load_id=null where fiscal_document_id=$1',[i.doc]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  await compositionRpc(db,"select driver_record_delivery_outcome($1,'returned',$2::jsonb,$3,'arrived')",[stop,JSON.stringify({notes:'Devolução total conferida'}),i.request]);
  expect((await db.query('select load_id from delivery_document_outcomes where fiscal_document_id=$1',[i.doc])).rows[0]).toEqual({load_id:i.load});
  expect((await db.query('select load_id from dispatch_stop_documents where fiscal_document_id=$1',[i.doc])).rows[0]).toEqual({load_id:null});
 });
 it.each(['returned','refused'])('driver %s validates all remaining quantities, excluding the operation note',async(outcome)=>{
  await recordOperation(db,await operationPayload(db,stop));const before=(await db.query('select * from delivery_document_outcomes')).rows;
  const quantity=Number((await db.query<{quantity:number}>('select quantity from load_items where id=$1',[i.item2])).rows[0].quantity);
  const details=await driverDetails({[i.item2]:quantity});
  await compositionRpc(db,"select driver_record_delivery_outcome($1,$2,$3::jsonb,$4,'arrived')",[stop,outcome,JSON.stringify(details),i.request2]);
  expect((await db.query('select status from fiscal_documents where id=$1',[i.doc2])).rows[0]).toEqual({status:outcome});
  expect((await db.query("select * from delivery_document_outcomes where source='operation'")).rows).toEqual(before);
  expect((await db.query('select status from loads where id=$1',[i.load])).rows[0]).toEqual({status:'partial_delivery'});
  expect(await counts()).toEqual({histories:2,proofs:1,payments:0});
 });
 it('rejects a partial outcome that returns all remaining quantities even when another note was delivered',async()=>{
  await recordOperation(db,await operationPayload(db,stop));
  const quantity=Number((await db.query<{quantity:number}>('select quantity from load_items where id=$1',[i.item2])).rows[0].quantity);
  const details=await driverDetails({[i.item2]:quantity});
  await rejected(()=>compositionRpc(db,"select driver_record_delivery_outcome($1,'partial_delivery',$2::jsonb,$3,'arrived')",[stop,JSON.stringify(details),i.request2]),/parcial exige/);
  expect(await counts()).toEqual({histories:1,proofs:1,payments:0});
 });
 it('allows a genuine partial return of remaining cargo without replacing an operation proof',async()=>{
  await recordOperation(db,await operationPayload(db,stop));const proof=(await db.query('select * from proof_of_delivery where fiscal_document_id=$1',[i.doc])).rows;
  const quantity=Number((await db.query<{quantity:number}>('select quantity from load_items where id=$1',[i.item2])).rows[0].quantity);
  const details=await driverDetails({[i.item2]:quantity/2});
  await compositionRpc(db,"select driver_record_delivery_outcome($1,'partial_delivery',$2::jsonb,$3,'arrived')",[stop,JSON.stringify(details),i.request2]);
  expect((await db.query('select * from proof_of_delivery where fiscal_document_id=$1',[i.doc])).rows).toEqual(proof);
  expect((await db.query('select status from fiscal_documents where id=$1',[i.doc2])).rows[0]).toEqual({status:'partial_delivery'});
  expect(await counts()).toEqual({histories:2,proofs:2,payments:0});
 });
 it('refuses conflicting legacy status instead of rewriting historical operation evidence',async()=>{
  await recordOperation(db,await operationPayload(db,stop,i.doc,'not_delivered'));const before=(await db.query('select * from delivery_document_outcomes')).rows;
  await db.query("update fiscal_documents set status='confirmed' where id=$1",[i.doc]);const details=await driverDetails();
  await rejected(()=>compositionRpc(db,"select driver_record_delivery_outcome($1,'delivered',$2::jsonb,$3,'arrived')",[stop,JSON.stringify(details),i.request2]),/Histórico da nota diverge/);
  expect((await db.query('select * from delivery_document_outcomes')).rows).toEqual(before);expect(await counts()).toEqual({histories:1,proofs:0,payments:0});
 });
 it.each(['delivered','returned','not_delivered'])('driver finishes remaining notes after operation recorded %s without rewriting that result',async(previous)=>{
  await recordOperation(db,await operationPayload(db,stop,i.doc,previous));const firstProofs=(await db.query('select * from proof_of_delivery where fiscal_document_id=$1',[i.doc])).rows;
  const firstHistory=(await db.query('select * from delivery_document_outcomes')).rows;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);const prefix=`${i.tenant}/deliveries/${trip}/${stop}/`;
  await db.query("insert into storage.objects(bucket_id,name) values('receipts',$1),('receipts',$2)",[prefix+'photo.jpg',prefix+'signatures/sign.png']);
  const details={receiver_name:'Recebedor motorista',photo_paths:[prefix+'photo.jpg'],signature_path:prefix+'signatures/sign.png'};
  await compositionRpc(db,"select driver_record_delivery_outcome($1,'delivered',$2::jsonb,$3,'arrived')",[stop,JSON.stringify(details),i.request2]);
  expect((await db.query('select status from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({status:previous});
  expect((await db.query('select status from fiscal_documents where id=$1',[i.doc2])).rows[0]).toEqual({status:'delivered'});
  expect((await db.query('select * from proof_of_delivery where fiscal_document_id=$1',[i.doc])).rows).toEqual(firstProofs);
  expect((await db.query("select * from delivery_document_outcomes where source='operation'")).rows).toEqual(firstHistory);
  expect((await db.query('select status from loads where id=$1',[i.load])).rows[0]).toEqual({status:previous==='delivered'?'delivered':'partial_delivery'});
  expect(await counts()).toEqual({histories:2,proofs:previous==='delivered'?2:1,payments:0});
 });
});
