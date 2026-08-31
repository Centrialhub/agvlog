// @vitest-environment node
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createCorrectionDatabase,seedCorrectableOutcome,correctOperation,correctionPayload} from './helpers/operationCorrectionDatabase';
import {operationIds as i,operationContext,operationRpc,recordOperation} from './helpers/operationOutcomeDatabase';
import {authorizeProofPortalViewer} from './helpers/proofVersionDatabase';
const containment=readFileSync('docs/qa/OPERATION-CORRECTION-CONTAINMENT-2026-08-30.sql','utf8').replace(/\r\n/g,'\n').replace(/^begin;$/m,'').replace(/^commit;$/m,'');
let db:PGlite;let stop:string;
beforeAll(async()=>{({db,stop}=await createCorrectionDatabase());},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const tables=['loads','load_items','fiscal_documents','dispatch_trips','dispatch_stops','dispatch_stop_documents','dispatch_events',
 'delivery_document_outcomes','delivery_document_corrections','proof_of_delivery','driver_settlements','driver_settlement_items','driver_settlement_events','driver_settlement_payments','idempotency_keys'];
const state=async()=>JSON.stringify((await db.query(`select jsonb_build_object(${tables.map(t=>`'${t}',(select jsonb_agg(to_jsonb(x) order by id) from ${t} x)`).join(',')})`)).rows);
describe('correction-aware containment without deleting evidence',()=>{
 it('suspends all three writers but preserves current/history readers, proofs and financial evidence',async()=>{
  const old=await seedCorrectableOutcome(db,stop,true);await db.query("update proof_of_delivery set storage_path='original-qa-proof',status='uploaded' where id=$1",[old.pod_id]);
  const body=await correctionPayload(db,stop,'delivered');await correctOperation(db,body);await authorizeProofPortalViewer(db);
  const before=await state(),context=await operationContext(db);await db.exec(containment);
  await expect(correctOperation(db,body)).rejects.toMatchObject({code:'55000'});
  await expect(recordOperation(db,body)).rejects.toMatchObject({code:'55000'});
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  await expect(operationRpc(db,"select driver_record_delivery_outcome($1,'returned')",[stop])).rejects.toMatchObject({code:'55000'});
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
  expect(await state()).toBe(before);expect(await operationContext(db)).toEqual(context);
  expect((await operationRpc(db,'select get_client_portal_shipment_detail_v2($1) result',[i.doc])).rows[0].result)
   .toMatchObject({proofs:[{version:2,status:'pending'}],proof_history:[{id:old.pod_id,version:1,has_file:true}]});
  expect((await db.query('select needs_recalculation from driver_settlements')).rows[0]).toEqual({needs_recalculation:true});
 });
 it.each([
  ['API body',"alter function record_operation_document_correction(jsonb) set search_path='public'"],
  ['anonymous API grant','grant execute on function record_operation_document_correction(jsonb) to anon'],
  ['private helper grant','grant execute on function _guard_recorded_delivery_document() to authenticated'],
  ['missing driver API grant','revoke execute on function driver_record_delivery_outcome(uuid,text,jsonb,uuid,text) from authenticated'],
  ['history write grant','grant insert on delivery_document_corrections to authenticated'],
  ['disabled RLS','alter table delivery_document_corrections disable row level security'],
  ['disabled integrity trigger','alter table fiscal_documents disable trigger guard_recorded_delivery_document'],
 ])('refuses drift in %s without changing business rows',async(_label,sql)=>{
  await seedCorrectableOutcome(db,stop,true);await correctOperation(db,await correctionPayload(db,stop));await db.exec(sql);const before=await state();
  await db.exec('savepoint refused');await expect(db.exec(containment)).rejects.toThrow('Correction containment refused');
  await db.exec('rollback to savepoint refused;release savepoint refused');expect(await state()).toBe(before);
 });
 it('rehearses reviewed forward restoration and exact replay without restoring pre-correction writers',async()=>{
  await seedCorrectableOutcome(db,stop,true);const body=await correctionPayload(db,stop,'delivered');const result=await correctOperation(db,body);
  const names=['record_operation_document_correction','record_operation_document_outcome','driver_record_delivery_outcome'];
  const definitions=(await db.query<{definition:string}>("select pg_get_functiondef(oid) definition from pg_proc where pronamespace='public'::regnamespace and proname=any($1)",[names])).rows;
  const before=await state();await db.exec(containment);for(const row of definitions)await db.exec(row.definition);
  expect(await correctOperation(db,body)).toEqual(result);expect(await state()).toBe(before);
 });
 it('refuses reapplication instead of pretending already-replaced bodies are the approved candidate',async()=>{
  await db.exec(containment);await expect(db.exec(containment)).rejects.toThrow('Correction containment refused');
 });
});
