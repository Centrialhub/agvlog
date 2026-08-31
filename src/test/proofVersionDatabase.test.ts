// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createProofVersionDatabase,seedHistoricalProof,proofVersionSql,authorizeProofPortalViewer,proofReaders} from './helpers/proofVersionDatabase';
import {operationIds as i,operationPayload,recordOperation,operationRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite;let stop:string;let trip:string;
beforeAll(async()=>{({db,stop,trip}=await createProofVersionDatabase());},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
describe('versioned proof evidence — prerequisite for correction and redelivery',()=>{
 it('creates a separate active proof while retaining the retired original ID, file and receiver',async()=>{
  const old=await seedHistoricalProof(db,trip,stop);const payload=await operationPayload(db,stop);const result=await recordOperation(db,payload);
  expect(result.pod_id).not.toBe(old.proof);
  expect((await db.query('select id,version,is_active,storage_path,receiver_name,status from proof_of_delivery where fiscal_document_id=$1 order by version',[i.doc])).rows).toEqual([
   {id:old.proof,version:1,is_active:false,storage_path:'QA-ORIGINAL-RECEIPT',receiver_name:'Recebedor anterior',status:'uploaded'},
   {id:result.pod_id,version:2,is_active:true,storage_path:null,receiver_name:'Recebedor QA',status:'pending'},
  ]);
 });
 it('replays a committed operation without adding another proof version',async()=>{
  await seedHistoricalProof(db,trip,stop);const payload=await operationPayload(db,stop);const first=await recordOperation(db,payload);
  expect(await recordOperation(db,payload)).toEqual(first);expect((await db.query('select count(*)::int n from proof_of_delivery')).rows[0]).toEqual({n:2});
 });
 it.each(["update proof_of_delivery set storage_path='changed' where not is_active","update proof_of_delivery set is_active=true where not is_active","delete from proof_of_delivery where not is_active"])( 'prevents alteration/reactivation/removal of historical evidence: %s',async(sql)=>{
  await seedHistoricalProof(db,trip,stop);await expect(db.exec(sql)).rejects.toThrow(/immutable|cannot be deleted/);
 });
 it('requires a correction event for this document and actor to retire evidence',async()=>{
  await db.query("insert into proof_of_delivery(tenant_id,fiscal_document_id,status,version,is_active) values($1,$2,'uploaded',1,true)",[i.tenant,i.doc]);
  await expect(db.exec('update proof_of_delivery set is_active=false')).rejects.toThrow(/preserve original evidence/);
 });
 it('does not expose proof write helpers, table writes or internal views to authenticated clients',async()=>{
  const row=(await db.query(`select has_function_privilege('authenticated','_prepare_delivery_proof(uuid,uuid,uuid,uuid)','execute') prepare,
   has_function_privilege('authenticated','_retire_delivery_proof(uuid,uuid,uuid)','execute') retire,
   has_table_privilege('authenticated','proof_of_delivery','update') direct_write,
   has_table_privilege('authenticated','current_delivery_proofs','select') internal_view`)).rows[0];
  expect(row).toEqual({prepare:false,retire:false,direct_write:false,internal_view:false});
 });
 it('refuses reapplication of the schema migration',async()=>{await expect(db.exec(proofVersionSql())).rejects.toThrow(/reader changed|requires the verified|unexpected evidence schema/);});
 it('keeps proof creation unavailable through its private helper under API role',async()=>{await expect(operationRpc(db,'select _prepare_delivery_proof($1,$2,$3,$4)',[i.tenant,i.doc,trip,stop])).rejects.toThrow(/permission denied/);});
 it.each(proofReaders)('executes the real current-proof reader %s with historical evidence present',async(name)=>{
  const old=await seedHistoricalProof(db,trip,stop);await authorizeProofPortalViewer(db);
  await db.query("update fiscal_documents set status='delivered' where id=$1",[i.doc]);
  const single=name==='get_public_shipment_status'||name.startsWith('get_client_portal_shipment_detail');
  const rows=(await operationRpc(db,`select * from public.${name}($1)`,[single?i.doc:i.tenant])).rows;
  if(name.startsWith('list_client_pods'))expect(rows).toEqual([]);
  else if(name==='get_public_shipment_status')expect(rows[0]).toEqual({get_public_shipment_status:'pod_pending'});
  else if(name.startsWith('get_client_portal_shipment_detail')){
   const data=Object.values(rows[0])[0] as {proofs:unknown[];proof_history:{id:string}[]};
   expect(data.proofs).toEqual([]);expect(data.proof_history.map(p=>p.id)).toEqual([old.proof]);
  }else expect(JSON.stringify(rows)).not.toContain(old.proof);
 });
 it('keeps a retired file downloadable only to a portal viewer with document download permission',async()=>{
  const old=await seedHistoricalProof(db,trip,stop);await authorizeProofPortalViewer(db);
  expect((await operationRpc(db,'select * from get_client_pod_metadata($1,$2)',[i.tenant,old.proof])).rows).toEqual([{storage_bucket:'receipts',storage_path:'QA-ORIGINAL-RECEIPT'}]);
  await db.exec('update client_portal_access set can_download_documents=false');
  expect((await operationRpc(db,'select * from get_client_pod_metadata($1,$2)',[i.tenant,old.proof])).rows).toEqual([]);
 });
 it('does not count a pending manual receipt as an available downloadable proof',async()=>{
  await seedHistoricalProof(db,trip,stop);await recordOperation(db,await operationPayload(db,stop));await authorizeProofPortalViewer(db);
  expect((await operationRpc(db,'select get_public_shipment_status($1) status',[i.doc])).rows[0]).toEqual({status:'pod_pending'});
  expect((await operationRpc(db,'select get_client_portal_reports_summary_v2($1) result',[i.tenant])).rows[0].result).toMatchObject({pending_pods:1});
 });
 it('prevents two simultaneous active versions at the database constraint',async()=>{
  await recordOperation(db,await operationPayload(db,stop));
  await expect(db.query("insert into proof_of_delivery(tenant_id,fiscal_document_id,status,version,is_active) values($1,$2,'pending',2,true)",[i.tenant,i.doc])).rejects.toThrow(/proof_one_active_document_idx/);
 });
 it('prevents a duplicate historical version number',async()=>{
  await seedHistoricalProof(db,trip,stop);
  await expect(db.query("insert into proof_of_delivery(tenant_id,fiscal_document_id,status,version,is_active) values($1,$2,'pending',1,false)",[i.tenant,i.doc])).rejects.toThrow(/proof_document_version_unique/);
 });
 it('keeps an empty current file pending consistently in detail and public status',async()=>{
  await recordOperation(db,await operationPayload(db,stop));await authorizeProofPortalViewer(db);
  await db.exec("update proof_of_delivery set status='uploaded',storage_path='' where is_active");
  const row=(await operationRpc(db,'select get_client_portal_shipment_detail_v2($1) result',[i.doc])).rows[0];
  expect(row.result).toMatchObject({document:{public_status:'pod_pending'},proofs:[{has_file:false}]});
  expect((await operationRpc(db,'select get_public_shipment_status($1) result',[i.doc])).rows[0]).toEqual({result:'pod_pending'});
 });
 it('does not treat proof of another tenant as current receipt',async()=>{
  await db.query("insert into proof_of_delivery(tenant_id,fiscal_document_id,load_id,status,version,is_active,storage_path) values($1,$2,$3,'uploaded',1,true,'old')",[i.otherTenant,i.doc,i.load]);
  expect((await db.query('select count(*)::int n from current_delivery_proofs')).rows[0]).toEqual({n:0});
 });
 it('does not treat proof of a former load as current receipt',async()=>{
  await db.query("insert into proof_of_delivery(tenant_id,fiscal_document_id,load_id,status,version,is_active,storage_path) values($1,$2,$3,'uploaded',1,true,'old')",[i.tenant,i.doc,i.load]);
  await db.query('update fiscal_documents set load_id=null where id=$1',[i.doc]);
  expect((await db.query('select count(*)::int n from current_delivery_proofs')).rows[0]).toEqual({n:0});
 });
 it('rejects proof creation for a document without a document type',async()=>{
  await db.query('update fiscal_documents set document_type=null where id=$1',[i.doc]);
  await expect(db.query('select _prepare_delivery_proof($1,$2,$3,$4)',[i.tenant,i.doc,trip,stop])).rejects.toThrow('Invalid current proof allocation');
 });
 it('installs both private views with runtime security-invoker semantics',async()=>{
  const {rows}=await db.query('select relname,reloptions from pg_class where oid in(\'current_delivery_proofs\'::regclass,\'available_delivery_proofs\'::regclass) order by relname');
  expect(rows).toEqual([{relname:'available_delivery_proofs',reloptions:['security_invoker=true']},{relname:'current_delivery_proofs',reloptions:['security_invoker=true']}]);
 });
});
