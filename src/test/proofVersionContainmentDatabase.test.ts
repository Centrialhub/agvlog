// @vitest-environment node
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createProofVersionDatabase,seedHistoricalProof,authorizeProofPortalViewer,proofReaders} from './helpers/proofVersionDatabase';
import {operationIds as i,operationPayload,recordOperation,operationRpc} from './helpers/operationOutcomeDatabase';
const containment=readFileSync('docs/qa/PROOF-VERSION-CONTAINMENT-2026-08-30.sql','utf8').replace(/\r\n/g,'\n').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
let db:PGlite;let trip:string;let stop:string;
beforeAll(async()=>{({db,trip,stop}=await createProofVersionDatabase());},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const state=async()=>JSON.stringify((await db.query(`select jsonb_build_object(
 'proofs',(select jsonb_agg(to_jsonb(t) order by id) from proof_of_delivery t),
 'documents',(select jsonb_agg(to_jsonb(t) order by id) from fiscal_documents t),
 'history',(select jsonb_agg(to_jsonb(t) order by id) from delivery_document_outcomes t),
 'events',(select jsonb_agg(to_jsonb(t) order by id) from dispatch_events t),
 'cache',(select jsonb_agg(to_jsonb(t)) from idempotency_keys t),
 'settlements',(select jsonb_agg(to_jsonb(t) order by id) from driver_settlements t),
 'payments',(select jsonb_agg(to_jsonb(t) order by id) from driver_settlement_payments t))`)).rows);
describe('proof versioning local containment',()=>{
 it('suspends both new outcome calls without changing proofs, history, caches or reader contracts',async()=>{
  const old=await seedHistoricalProof(db,trip,stop);const payload=await operationPayload(db,stop);await recordOperation(db,payload);
  await authorizeProofPortalViewer(db);const before=await state();
  const readers=async()=>JSON.stringify((await db.query('select proname,md5(pg_get_functiondef(oid)) hash from pg_proc where proname=any($1) order by proname',[proofReaders])).rows);
  const readerState=await readers();await db.exec(containment);
  await expect(recordOperation(db,payload)).rejects.toMatchObject({code:'55000'});
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  await expect(operationRpc(db,"select driver_record_delivery_outcome($1,'delivered')",[stop])).rejects.toMatchObject({code:'55000'});
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
  expect(await state()).toBe(before);expect(await readers()).toBe(readerState);
  expect((await operationRpc(db,'select get_client_portal_shipment_detail_v2($1) result',[i.doc])).rows[0].result)
   .toMatchObject({proofs:[{version:2,has_file:false}],proof_history:[{id:old.proof,version:1,has_file:true}]});
  expect((await operationRpc(db,'select * from get_client_pod_metadata($1,$2)',[i.tenant,old.proof])).rows)
   .toEqual([{storage_bucket:'receipts',storage_path:'QA-ORIGINAL-RECEIPT'}]);
 });
 it.each([
  ['changed body',"alter function record_operation_document_outcome(jsonb) set search_path='public'"],
  ['anonymous grant','grant execute on function record_operation_document_outcome(jsonb) to anon'],
  ['missing API grant','revoke execute on function driver_record_delivery_outcome(uuid,text,jsonb,uuid,text) from authenticated'],
  ['unexpected backend grant','grant execute on function record_operation_document_outcome(jsonb) to service_role'],
 ])('refuses %s without modifying business state',async(_name,drift)=>{
  await db.exec(drift);const before=await state();await db.exec('savepoint refused');
  await expect(db.exec(containment)).rejects.toThrow('Proof containment refused');
  await db.exec('rollback to savepoint refused;release savepoint refused');expect(await state()).toBe(before);
 });
 it('refuses reapplication and requires reviewed forward restoration',async()=>{
  await db.exec(containment);await expect(db.exec(containment)).rejects.toThrow('Proof containment refused');
 });
});
