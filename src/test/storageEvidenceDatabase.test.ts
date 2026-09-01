// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {asRole,createStorageEvidenceDatabase,evidenceIds as i,receiptPath,storageEvidenceSql} from './helpers/storageEvidenceDatabase';

let db:PGlite;
beforeAll(async()=>{db=await createStorageEvidenceDatabase();},30000);
afterAll(async()=>{await db?.close();});

async function object(bucket:string,path:string){await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,path]);}
async function serviceDelete(bucket:string,path:string){return asRole(db,'service_role',null,'delete from storage.objects where bucket_id=$1 and name=$2 returning name',[bucket,path]);}

describe('immutable linked Storage evidence',()=>{
 it('blocks service-role deletion for current and historical POD paths while allowing a real orphan',async()=>{
  const current=receiptPath('current-signature.png'),historical=receiptPath('historical-photo.png'),orphan=receiptPath('orphan.png');
  await object('receipts',current);await object('receipts',historical);await object('receipts',orphan);
  await db.query("insert into proof_of_delivery(tenant_id,fiscal_document_id,storage_bucket,storage_path,metadata,is_active) values($1,$2,'receipts',$3,jsonb_build_object('photo_paths',jsonb_build_array($4::text)),false)",[i.tenant,i.doc,current,historical]);
  await expect(serviceDelete('receipts',current)).rejects.toThrow('storage_evidence_retention_required');
  await expect(serviceDelete('receipts',historical)).rejects.toThrow('storage_evidence_retention_required');
  expect((await serviceDelete('receipts',orphan)).rows).toEqual([{name:orphan}]);
 });
 it('retains delivery event attachments even when no POD row references them',async()=>{
  const dispatch=receiptPath('dispatch-history.png'),operation=receiptPath('operation-history.png');
  await object('receipts',dispatch);await object('receipts',operation);
  await db.query("insert into dispatch_events(tenant_id,payload) values($1,jsonb_build_object('delivery_request',jsonb_build_object('details',jsonb_build_object('photo_paths',jsonb_build_array($2::text)))))",[i.tenant,dispatch]);
  await db.query("insert into operational_events(tenant_id,report_details) values($1,jsonb_build_object('signature_path',$2::text))",[i.tenant,operation]);
  await expect(serviceDelete('receipts',dispatch)).rejects.toThrow('storage_evidence_retention_required');
  await expect(serviceDelete('receipts',operation)).rejects.toThrow('storage_evidence_retention_required');
 });
 it.each(['driver_expenses','driver_settlement_payments','payables'])('retains a receipt linked by %s',async table=>{
  const path=receiptPath(table+'.pdf');await object('receipts',path);
  await db.query(`insert into ${table}(tenant_id,receipt_url) values($1,$2)`,[i.tenant,path]);
  await expect(serviceDelete('receipts',path)).rejects.toThrow('storage_evidence_retention_required');
 });
 it('retains signed occurrence and pallet proofs through the same service-role trigger',async()=>{
  const occurrence=i.tenant+'/return-sheets/a/proof.pdf',pallet=i.tenant+'/protocols/a/proof.pdf';
  await object('occurrence-return-proofs',occurrence);await object('pallet-return-proofs',pallet);
  await db.query('insert into occurrence_return_sheets(tenant_id,signed_proof_url) values($1,$2)',[i.tenant,occurrence]);
  await db.query('insert into pallet_return_protocols(tenant_id,signed_proof_url) values($1,$2)',[i.tenant,pallet]);
  await expect(serviceDelete('occurrence-return-proofs',occurrence)).rejects.toThrow('storage_evidence_retention_required');
  await expect(serviceDelete('pallet-return-proofs',pallet)).rejects.toThrow('storage_evidence_retention_required');
 });
 it('removes direct authenticated receipt DELETE and grants only the explicit cleanup RPC',async()=>{
  const path=receiptPath('policy-orphan.png');await object('receipts',path);
  expect((await asRole(db,'authenticated',i.operator,'delete from storage.objects where bucket_id=$1 and name=$2 returning name',['receipts',path])).rows).toEqual([]);
  expect((await db.query('select count(*)::int n from storage.objects where name=$1',[path])).rows[0]).toEqual({n:1});
  expect((await db.query(`select has_function_privilege('authenticated','authorize_secure_upload_cleanup_v1(uuid,text,text[])','execute') authenticated,
   has_function_privilege('anon','authorize_secure_upload_cleanup_v1(uuid,text,text[])','execute') anon,
   has_function_privilege('service_role','authorize_secure_upload_cleanup_v1(uuid,text,text[])','execute') service`)).rows[0]).toEqual({authenticated:true,anon:false,service:false});
 });
 it('authorizes an exact operator orphan receipt but rejects cross-tenant, reserved and retained paths',async()=>{
  const orphan=receiptPath('authorized-orphan.png'),linked=receiptPath('linked.png');await object('receipts',linked);
  await db.query("insert into driver_expenses(tenant_id,receipt_url) values($1,$2)",[i.tenant,linked]);
  const result=(await asRole<{value:{tenant_id:string;actor_id:string;paths:string[]}}>(db,'authenticated',i.operator,
   'select authorize_secure_upload_cleanup_v1($1,$2,$3) value',[i.tenant,'receipts',[orphan]])).rows[0].value;
  expect(result).toMatchObject({tenant_id:i.tenant,actor_id:i.operator,paths:[orphan]});
  for(const path of [i.otherTenant+'/deliveries/a/b/c',i.tenant+'/expense-receipts/a/b/c',linked]){
   await expect(asRole(db,'authenticated',i.operator,'select authorize_secure_upload_cleanup_v1($1,$2,$3)',[i.tenant,'receipts',[path]])).rejects.toThrow(/secure_cleanup_not_authorized|storage_evidence_retention_required/);
  }
 });
 it('lets a driver clean only the orphan folder of their own trip and stop',async()=>{
  const own=receiptPath('driver-orphan.png'),other= i.tenant+'/deliveries/'+i.trip+'/ee000000-0000-4000-8000-000000000099/orphan.png';
  await expect(asRole(db,'authenticated',i.driverUser,'select authorize_secure_upload_cleanup_v1($1,$2,$3)',[i.tenant,'receipts',[own]])).resolves.toBeTruthy();
  await expect(asRole(db,'authenticated',i.driverUser,'select authorize_secure_upload_cleanup_v1($1,$2,$3)',[i.tenant,'receipts',[other]])).rejects.toThrow('secure_cleanup_not_authorized');
 });
 it('is additive and keeps its trigger/ACL intact on a local idempotent rehearsal',async()=>{
  await expect(db.exec(storageEvidenceSql())).resolves.toBeDefined();
  const path=receiptPath('rehearsal-linked.png');await object('receipts',path);
  await db.query('insert into payables(tenant_id,receipt_url) values($1,$2)',[i.tenant,path]);
  await expect(serviceDelete('receipts',path)).rejects.toThrow('storage_evidence_retention_required');
 });
});
