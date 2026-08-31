// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createDocumentMetadataDatabase,metadataPayload,updateMetadata} from './helpers/documentMetadataDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {seedUndelivered,ownerStatement,driverPartial} from './helpers/deliveryAttemptDatabase';
import {requestRedelivery,redeliveryPayload} from './helpers/redeliveryDatabase';
import {correctOperation,correctionPayload} from './helpers/operationCorrectionDatabase';
let db:PGlite;let stop:string;let trip:string;
beforeAll(async()=>{({db,stop,trip}=await createDocumentMetadataDatabase());},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
describe('audited operational conference metadata',()=>{
 it.each([{ne:true},{delivery_at:'2030-01-01T00:00:00Z'},{delivered_at:'2030-01-01T00:00:00Z'},{redelivery:true}])('blocks invented original-attempt metadata through legacy writers: %j',async patch=>{
  await db.exec('savepoint legacy_result_test');
  try{
   await db.query('update fiscal_documents set delivery_meta=coalesce(delivery_meta,\'{}\')||$2::jsonb where id=$1',[i.doc,JSON.stringify(patch)]);
   await expect(db.exec('set constraints all immediate')).rejects.toThrow('delivery_result_requires_audited_api');
  }finally{await db.exec('rollback to savepoint legacy_result_test;release savepoint legacy_result_test');}
 });
 it('preserves the canonical driver partial delivery and reentrega history with receipt reset',async()=>{
  await driverPartial(db,trip,stop,{[i.item]:2});await updateMetadata(db,await metadataPayload(db,{rec_canhoto:true}));
  await requestRedelivery(db,await redeliveryPayload(db));
  expect((await db.query("select source_document_snapshot->>'status' status,source_document_snapshot#>>'{delivery_meta,rec_canhoto}' receipt from delivery_attempts")).rows[0]).toEqual({status:'partial_delivery',receipt:'true'});
 });
 it.each(['delivered_at','redelivery_at'])('blocks a forged legacy date after the original recorded outcome: %s',async key=>{
  await seedUndelivered(db,stop);await db.exec('savepoint alias_test');
  try{
   await db.query('update fiscal_documents set delivery_meta=delivery_meta||$2::jsonb where id=$1',[i.doc,JSON.stringify({[key]:'2030-01-01T00:00:00Z'})]);
   await expect(db.exec('set constraints all immediate')).rejects.toThrow('delivery_result_requires_audited_api');
  }finally{await db.exec('rollback to savepoint alias_test;release savepoint alias_test');}
 });
 it('updates only editable keys, retains unrelated metadata and emits one immutable audit',async()=>{
  await db.query("update fiscal_documents set delivery_meta='{\"contact_email\":\"qa@example.invalid\"}' where id=$1",[i.doc]);
  const result=await updateMetadata(db,await metadataPayload(db));expect(result).toMatchObject({status:'confirmed',document_count:1,delivery_outcomes_preserved:true,financial_values_preserved:true});
  expect((await db.query('select delivery_meta from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({delivery_meta:{contact_email:'qa@example.invalid',payment_method:'pix'}});
  expect((await db.query('select changes,source from delivery_document_metadata_audits')).rows[0]).toEqual({changes:{payment_method:'pix'},source:'operator'});
  await expect(ownerStatement(db,"update delivery_document_metadata_audits set reason='Alteração indevida QA'")).rejects.toThrow('append-only');
 });
 it('requires an audited outcome before confirming receipt of a canhoto',async()=>{
  await expect(updateMetadata(db,await metadataPayload(db,{rec_canhoto:true}))).rejects.toThrow('receipt_requires_recorded_outcome');
  expect((await db.query('select count(*)::int n from delivery_document_metadata_audits')).rows[0]).toEqual({n:0});
 });
 it('clears attempt-specific conference on release while preserving the old snapshot and payment terms',async()=>{
  await seedUndelivered(db,stop);await updateMetadata(db,await metadataPayload(db,{rec_canhoto:true,payment_method:'pix',oco_01:'02',oco_02:'09',resp_oco:'cliente'}));
  await requestRedelivery(db,await redeliveryPayload(db));
  const row=(await db.query<{delivery_meta:Record<string,unknown>}>('select delivery_meta from fiscal_documents where id=$1',[i.doc])).rows[0];
  expect(row.delivery_meta).toMatchObject({payment_method:'pix',redelivery:true});expect(row.delivery_meta.rec_canhoto).toBeUndefined();expect(row.delivery_meta.oco_01).toBeUndefined();
  expect((await db.query("select source_document_snapshot->'delivery_meta' meta from delivery_attempts")).rows[0]).toMatchObject({meta:{rec_canhoto:true,payment_method:'pix',oco_01:'02'}});
 });
 it('replays a committed administrative change after release without reapplying it to the new attempt',async()=>{
  await seedUndelivered(db,stop);const payload=await metadataPayload(db,{rec_canhoto:true});const result=await updateMetadata(db,payload);
  await requestRedelivery(db,await redeliveryPayload(db));expect(await updateMetadata(db,payload)).toEqual(result);
  expect((await db.query("select delivery_meta->'rec_canhoto' received from fiscal_documents where id=$1",[i.doc])).rows[0]).toEqual({received:null});
  expect((await db.query('select count(*)::int n from delivery_document_metadata_audits')).rows[0]).toEqual({n:1});
 });
 it('resets receipt during an audited outcome correction and records the reason/source event',async()=>{
  await seedUndelivered(db,stop);await updateMetadata(db,await metadataPayload(db,{rec_canhoto:true}));
  await correctOperation(db,await correctionPayload(db,stop));
  expect((await db.query("select delivery_meta->'rec_canhoto' received from fiscal_documents where id=$1",[i.doc])).rows[0]).toEqual({received:false});
  expect((await db.query("select source,changes,source_event_id is not null linked from delivery_document_metadata_audits where source='outcome_correction'")).rows[0])
   .toEqual({source:'outcome_correction',changes:{rec_canhoto:false},linked:true});
 });
 it('refuses a changed payload under the same key',async()=>{
  const payload=await metadataPayload(db);await updateMetadata(db,payload);
  await expect(updateMetadata(db,{...payload,reason:'Outro motivo conferido'})).rejects.toThrow('document_metadata_key_mismatch');
 });
 it('validates the entire batch before mutating any document',async()=>{
  const first=await metadataPayload(db);const second=await metadataPayload(db,{payment_method:'boleto'},i.doc2);
  second.items[0].revision='a'.repeat(64);await expect(updateMetadata(db,{...first,items:[...first.items,...second.items]})).rejects.toThrow('document_metadata_context_changed');
  expect((await db.query('select count(*)::int n from delivery_document_metadata_audits')).rows[0]).toEqual({n:0});
  expect((await db.query("select delivery_meta->>'payment_method' payment from fiscal_documents where id=$1",[i.doc])).rows[0]).toEqual({payment:null});
 });
 it.each([{ne:true},{delivery_at:'2030-01-01T00:00:00Z'},{status:'delivered'},{rec_canhoto:'true'},{payment_method:'unknown'},{oco_01:'99'}])('rejects invalid/protected field patch %j',async changes=>{
  await expect(updateMetadata(db,await metadataPayload(db,changes))).rejects.toThrow(/not_editable|invalid_document_metadata_patch/);
 });
 it('blocks legacy replacement and field updates even through an elevated writer',async()=>{
  await expect(ownerStatement(db,"update fiscal_documents set delivery_meta='{\"payment_method\":\"pix\"}' where id=$1",[i.doc])).rejects.toThrow('document_metadata_requires_audited_api');
  await updateMetadata(db,await metadataPayload(db));
  await expect(ownerStatement(db,"update fiscal_documents set delivery_meta='{}' where id=$1",[i.doc])).rejects.toThrow('document_metadata_requires_audited_api');
 });
 it('preserves ingestion payment information on new invoices but rejects inherited receipt state',async()=>{
  await ownerStatement(db,"insert into fiscal_documents(id,tenant_id,document_type,status,delivery_meta) values(gen_random_uuid(),$1,'inbound','confirmed','{\"payment_method\":\"pix\",\"payment_method_source\":\"tpag\"}')",[i.tenant]);
  await expect(ownerStatement(db,"insert into fiscal_documents(id,tenant_id,document_type,status,delivery_meta) values(gen_random_uuid(),$1,'inbound','confirmed','{\"rec_canhoto\":true}')",[i.tenant])).rejects.toThrow('new_invoice_cannot_adopt_delivery_conference');
 });
 it('enforces role and tenant boundaries and keeps helpers/table DML private',async()=>{
  const payload=await metadataPayload(db);await expect(updateMetadata(db,{...payload,tenant_id:i.otherTenant})).rejects.toThrow('not_authorized');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);await expect(updateMetadata(db,payload)).rejects.toThrow('not_authorized');
  const acl=(await db.query("select has_function_privilege('authenticated','_apply_delivery_admin_patch(uuid,uuid,jsonb,text,uuid,text,uuid)','execute') helper,has_table_privilege('authenticated','delivery_document_metadata_audits','insert') write")).rows[0];
  expect(acl).toEqual({helper:false,write:false});
  expect((await operationRpc(db,'select * from delivery_document_metadata_audits')).rows).toEqual([]);
 });
});
