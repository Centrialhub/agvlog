// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createCorrectionDatabase,correctionPayload,correctOperation,seedCorrectableOutcome,correctionSql} from './helpers/operationCorrectionDatabase';
import {operationIds as i,recordOperation,operationRpc,operationContext} from './helpers/operationOutcomeDatabase';
import {authorizeProofPortalViewer} from './helpers/proofVersionDatabase';
let db:PGlite;let trip:string;let stop:string;
beforeAll(async()=>{({db,trip,stop}=await createCorrectionDatabase());},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const state=async()=>JSON.stringify((await db.query(`select jsonb_build_object('docs',(select jsonb_agg(to_jsonb(t) order by id) from fiscal_documents t),
 'history',(select jsonb_agg(to_jsonb(t) order by id) from delivery_document_outcomes t),'proofs',(select jsonb_agg(to_jsonb(t) order by id) from proof_of_delivery t),
 'corrections',(select jsonb_agg(to_jsonb(t) order by id) from delivery_document_corrections t),'settlements',(select jsonb_agg(to_jsonb(t) order by id) from driver_settlements t))`)).rows);
describe('audited correction of an existing delivery attempt',()=>{
 it('replaces the current result without editing its original history or releasing the document',async()=>{
  const old=await seedCorrectableOutcome(db,stop);const history=(await db.query('select to_jsonb(h) row from delivery_document_outcomes h')).rows;
  const result=await correctOperation(db,await correctionPayload(db,stop));
  expect(result).toMatchObject({outcome:'not_delivered',correction_of:old.history_id,proof_pending:false,financial_review_required:false});
  expect((await db.query('select to_jsonb(h) row from delivery_document_outcomes h where id=$1',[old.history_id])).rows).toEqual(history);
  expect((await db.query('select status,load_id from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({status:'not_delivered',load_id:i.load});
  expect((await db.query('select outcome from current_delivery_document_outcomes')).rows).toEqual([{outcome:'not_delivered'}]);
 });
 it('keeps a completed trip and its physical timestamps while correcting stop/load results',async()=>{
  await seedCorrectableOutcome(db,stop,true);const before=(await db.query('select actual_start_at,actual_end_at from dispatch_trips where id=$1',[trip])).rows;
  const result=await correctOperation(db,await correctionPayload(db,stop,'returned'));
  expect(result).toMatchObject({trip_completed:true,stop_status:'partial_delivery',financial_review_required:true});
  expect((await db.query('select actual_start_at,actual_end_at from dispatch_trips where id=$1',[trip])).rows).toEqual(before);
  expect((await db.query('select status from loads where id=$1',[i.load])).rows[0]).toEqual({status:'partial_delivery'});
 });
 it.each(['pending_review','in_review','reopened','approved','paid','closed'])('preserves %s settlement values/items/payments/snapshot and flags explicit review',async(status)=>{
  await seedCorrectableOutcome(db,stop,true);await db.query('update driver_settlements set status=$1',[status]);await db.exec('delete from qa_delivery_side_effects');
  const financial=async()=>JSON.stringify((await db.query(`select jsonb_build_object('settlement',(select to_jsonb(s)-array['needs_recalculation','recalculation_reason','source_updated_at','updated_at'] from driver_settlements s),
   'items',(select jsonb_agg(to_jsonb(t) order by id) from driver_settlement_items t),'payments',(select jsonb_agg(to_jsonb(t) order by id) from driver_settlement_payments t))`)).rows);
  const before=await financial();const result=await correctOperation(db,await correctionPayload(db,stop));
  expect(result).toMatchObject({settlement_status:status,financial_review_required:true});expect(await financial()).toBe(before);
  expect((await db.query('select status,needs_recalculation,recalculation_reason from driver_settlements')).rows[0]).toEqual({status,needs_recalculation:true,recalculation_reason:'delivery_outcome_correction'});
  expect((await db.query('select * from qa_delivery_side_effects')).rows).toEqual([]);
  expect((await db.query("select count(*)::int n from driver_settlement_events where event_type='delivery_outcome_corrected'")).rows[0]).toEqual({n:1});
 });
 it('replays the identical correction without another history/proof/financial event',async()=>{
  await seedCorrectableOutcome(db,stop,true);const payload=await correctionPayload(db,stop,'delivered');const first=await correctOperation(db,payload);const before=await state();
  expect(await correctOperation(db,payload)).toEqual(first);expect(await state()).toBe(before);
  expect((await db.query('select version,is_active from proof_of_delivery where fiscal_document_id=$1 order by version',[i.doc])).rows).toEqual([{version:1,is_active:false},{version:2,is_active:true}]);
 });
 it('preserves an existing nonzero payment and copies it into the immutable correction snapshot',async()=>{
  await seedCorrectableOutcome(db,stop,true);
  await db.exec("update driver_settlements set status='approved',driver_payable_amount=125,total_paid_amount=125");
  await db.query(`insert into driver_settlement_payments(tenant_id,settlement_id,amount,payment_method,paid_by)
   select tenant_id,id,125,'pix',$1 from driver_settlements`,[i.operator]);
  await db.exec("update driver_settlements set status='paid';delete from qa_delivery_side_effects");
  const payments=(await db.query<{value:unknown}>('select jsonb_agg(to_jsonb(p) order by id) value from driver_settlement_payments p')).rows[0].value;
  await correctOperation(db,await correctionPayload(db,stop,'returned'));
  expect((await db.query('select status,driver_payable_amount::float8 payable,total_paid_amount::float8 paid,needs_recalculation from driver_settlements')).rows[0])
   .toEqual({status:'paid',payable:125,paid:125,needs_recalculation:true});
  expect((await db.query<{value:unknown}>('select jsonb_agg(to_jsonb(p) order by id) value from driver_settlement_payments p')).rows[0].value).toEqual(payments);
  expect((await db.query<{value:unknown}>("select financial_snapshot->'payments' value from delivery_document_corrections")).rows[0].value).toEqual(payments);
  expect((await db.query('select * from qa_delivery_side_effects')).rows).toEqual([]);
 });
 it('corrects the current correction again while keeping one current result and all old versions',async()=>{
  await seedCorrectableOutcome(db,stop);await correctOperation(db,await correctionPayload(db,stop));const second=await correctionPayload(db,stop,'delivered');second.request_id=i.request2;
  await correctOperation(db,second);expect((await db.query('select count(*)::int n from delivery_document_outcomes')).rows[0]).toEqual({n:3});
  expect((await db.query('select outcome from current_delivery_document_outcomes')).rows).toEqual([{outcome:'delivered'}]);
  const context=await operationContext(db);expect(context.history).toHaveLength(3);
 });
 it('rejects key reuse with changed content',async()=>{
  await seedCorrectableOutcome(db,stop);const payload=await correctionPayload(db,stop);await correctOperation(db,payload);const before=await state();
  await expect(correctOperation(db,{...payload,reason:'Outra correção'})).rejects.toThrow('operation_correction_key_mismatch');expect(await state()).toBe(before);
 });
 it('rejects obsolete revision without changing documents, proof or finance',async()=>{
  await seedCorrectableOutcome(db,stop);const payload=await correctionPayload(db,stop);await db.query("update fiscal_documents set delivery_meta=delivery_meta||'{\"payment_method\":\"pix\"}' where id=$1",[i.doc]);const before=await state();
  await expect(correctOperation(db,payload)).rejects.toThrow('context_changed');expect(await state()).toBe(before);
 });
 it('rejects selection of superseded result even with a fresh context',async()=>{
  await seedCorrectableOutcome(db,stop);const payload=await correctionPayload(db,stop);await correctOperation(db,payload);const next=await correctionPayload(db,stop,'delivered');next.request_id=i.request2;next.correction_of=payload.correction_of;
  await expect(correctOperation(db,next)).rejects.toThrow('requires_current_outcome');
 });
 it.each(['driver','foreign_operator','inactive_operator'])('denies %s including direct calls',async(actor)=>{
  await seedCorrectableOutcome(db,stop);const payload=await correctionPayload(db,stop);const before=await state();
  if(actor==='inactive_operator')await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);
  else {
   const user=actor==='driver'?i.user:'a9000000-0000-4000-8000-000000000099';
   if(actor==='foreign_operator')await db.query("insert into tenant_memberships values($1,$2,'operator',true)",[user,i.otherTenant]);
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
  }
  await expect(correctOperation(db,payload)).rejects.toMatchObject({code:'42501'});expect(await state()).toBe(before);
 });
 it('records explicit partial quantities only for this note',async()=>{
  await seedCorrectableOutcome(db,stop);const payload=await correctionPayload(db,stop,'partial_delivery');payload.returned_items={[i.item]:0.5};
  const result=await correctOperation(db,payload);expect(result).toMatchObject({outcome:'partial_delivery',proof_pending:true});
  expect((await db.query('select status,metadata from proof_of_delivery where is_active')).rows[0]).toMatchObject({status:'pending',metadata:{returned_items:{[i.item]:0.5}}});
 });
 it.each([{}, {[i.item]:0},{[i.item]:99999},{[i.item2]:1}])('rejects invalid partial quantities %j',async(returned_items)=>{
  await seedCorrectableOutcome(db,stop);const payload=await correctionPayload(db,stop,'partial_delivery');const before=await state();
  await expect(correctOperation(db,{...payload,returned_items})).rejects.toThrow('invalid_quantities');expect(await state()).toBe(before);
 });
 it('leaves full historic evidence available only under the usual portal download permission',async()=>{
  const old=await seedCorrectableOutcome(db,stop);await db.query("update proof_of_delivery set storage_path='original-proof',status='uploaded' where id=$1",[old.pod_id]);
  await correctOperation(db,await correctionPayload(db,stop,'delivered'));await authorizeProofPortalViewer(db);
  expect((await operationRpc(db,'select get_client_portal_shipment_detail_v2($1) result',[i.doc])).rows[0].result)
   .toMatchObject({proofs:[{version:2,status:'pending'}],proof_history:[{id:old.pod_id,version:1,has_file:true}]});
 });
 it('allows driver completion after correction without counting the superseded result as divergence',async()=>{
  await seedCorrectableOutcome(db,stop);await correctOperation(db,await correctionPayload(db,stop,'returned'));
  const prefix=`${i.tenant}/deliveries/${trip}/${stop}/`;await db.query("insert into storage.objects(bucket_id,name) values('receipts',$1),('receipts',$2)",[prefix+'photo.jpg',prefix+'signature.png']);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  const details={receiver_name:'Motorista QA',photo_paths:[prefix+'photo.jpg'],signature_path:prefix+'signature.png'};
  const row=(await operationRpc(db,"select driver_record_delivery_outcome($1,'delivered',$2::jsonb,$3,'arrived') result",[stop,JSON.stringify(details),i.request2])).rows[0];
  expect(row.result).toMatchObject({preserved_document_ids:[i.doc],applied_document_ids:[i.doc2],stop_outcome:'partial_delivery',trip_completed:true});
 });
 it('does not permit the normal confirmation API to process a correction payload',async()=>{
  await seedCorrectableOutcome(db,stop);await expect(recordOperation(db,await correctionPayload(db,stop))).rejects.toThrow('requires_correction_api');
 });
 it('rejects a time outside the recorded journey rather than inventing a new movement',async()=>{
  await seedCorrectableOutcome(db,stop,true);await expect(correctOperation(db,{...await correctionPayload(db,stop),occurred_at:new Date(Date.now()+60_000).toISOString()})).rejects.toThrow('invalid_time');
 });
 it('does not grant table writes or private projection/aggregate execution to browser roles',async()=>{
  expect((await db.query("select has_table_privilege('authenticated','delivery_document_corrections','insert') write,has_table_privilege('authenticated','current_delivery_document_outcomes','select') view,has_function_privilege('authenticated','_derive_corrected_delivery_result(uuid,uuid,uuid)','execute') helper")).rows[0]).toEqual({write:false,view:false,helper:false});
 });
 it('retains immutable correction links',async()=>{
  await seedCorrectableOutcome(db,stop);await correctOperation(db,await correctionPayload(db,stop));
  await expect(db.exec('delete from delivery_document_corrections')).rejects.toMatchObject({code:'55000'});
 });
 it('restricts correction history reads to active operators of its tenant',async()=>{
  await seedCorrectableOutcome(db,stop);await correctOperation(db,await correctionPayload(db,stop));
  expect((await operationRpc(db,'select id from delivery_document_corrections')).rows).toHaveLength(1);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  expect((await operationRpc(db,'select id from delivery_document_corrections')).rows).toHaveLength(0);
  const foreign='a9000000-0000-4000-8000-000000000099';await db.query("insert into tenant_memberships values($1,$2,'operator',true)",[foreign,i.otherTenant]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[foreign]);
  expect((await operationRpc(db,'select id from delivery_document_corrections')).rows).toHaveLength(0);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
  await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);
  expect((await operationRpc(db,'select id from delivery_document_corrections')).rows).toHaveLength(0);
 });
 it('denies all browser direct writes and private trigger/helper execution',async()=>{
  const result=(await db.query<Record<string,boolean>>(`select
   has_function_privilege('anon','record_operation_document_correction(jsonb)','execute') anon_api,
   has_function_privilege('service_role','record_operation_document_correction(jsonb)','execute') service_api,
   has_function_privilege('authenticated','_guard_recorded_delivery_document()','execute') guard,
   has_function_privilege('authenticated','_guard_delivery_correction_finance()','execute') finance,
   has_function_privilege('authenticated','_validate_delivery_document_correction()','execute') validate,
   has_table_privilege('authenticated','delivery_document_corrections','update') update,
   has_table_privilege('authenticated','delivery_document_corrections','delete') delete`)).rows[0];
  expect(Object.values(result)).toEqual(Array(7).fill(false));
 });
 it.each(["status='confirmed'","delivery_meta='{}'::jsonb","load_id=null"])( 'refuses an old direct writer at the transaction boundary: %s',async(change)=>{
  await seedCorrectableOutcome(db,stop);const before=await state();await db.exec('savepoint legacy');
  await expect(db.exec(`update fiscal_documents set ${change} where id='${i.doc}';set constraints guard_recorded_delivery_document immediate;`)).rejects.toMatchObject({code:'23514'});
  await db.exec('rollback to savepoint legacy;release savepoint legacy');expect(await state()).toBe(before);
 });
 it('blocks additional payment and finalization until the corrected settlement is reviewed',async()=>{
  await seedCorrectableOutcome(db,stop,true);await db.exec("update driver_settlements set status='approved'");await correctOperation(db,await correctionPayload(db,stop));
  const before=await state();await db.exec('savepoint payment');
  await expect(db.exec(`insert into driver_settlement_payments(tenant_id,settlement_id,amount,payment_method,paid_by)
   select tenant_id,id,10,'pix','${i.operator}' from driver_settlements`)).rejects.toThrow('settlement_requires_review_before_payment');
  await db.exec('rollback to savepoint payment;release savepoint payment;savepoint finalization');
  await expect(db.exec("update driver_settlements set status='closed',needs_recalculation=false")).rejects.toThrow('settlement_requires_review_before_finalization');
  await db.exec('rollback to savepoint finalization;release savepoint finalization');expect(await state()).toBe(before);
 });
 it('refuses reapplication of the correction migration',async()=>{await expect(db.exec(correctionSql())).rejects.toThrow('Correction contract already exists');});
});
