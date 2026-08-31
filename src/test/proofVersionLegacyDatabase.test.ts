// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createProofVersionDatabase,authorizeProofPortalViewer} from './helpers/proofVersionDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite;
beforeAll(async()=>{({db}=await createProofVersionDatabase(false));},30000);
beforeEach(async()=>{await db.exec('begin');await authorizeProofPortalViewer(db);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
describe('legacy proof/version reader failures reproduced from local baseline',()=>{
 it('rejects a new version even when the previous proof is inactive',async()=>{
  await db.query("insert into proof_of_delivery(tenant_id,fiscal_document_id,status,version,is_active) values($1,$2,'uploaded',1,false)",[i.tenant,i.doc]);
  await expect(db.query("insert into proof_of_delivery(tenant_id,fiscal_document_id,status,version,is_active) values($1,$2,'pending',2,true)",[i.tenant,i.doc])).rejects.toThrow(/uq_pod_fiscal_document/);
 });
 it('counts an inactive historical proof as the current available receipt',async()=>{
  await db.query("insert into proof_of_delivery(tenant_id,fiscal_document_id,status,version,is_active,storage_path) values($1,$2,'uploaded',1,false,'old')",[i.tenant,i.doc]);
  await db.query("update fiscal_documents set status='delivered' where id=$1",[i.doc]);
  expect((await operationRpc(db,'select get_public_shipment_status($1) result',[i.doc])).rows[0]).toEqual({result:'pod_available'});
 });
 it.each(['search_client_portal_shipments','search_client_portal_shipments_v2'])('fails %s because row_to_jsonb is not a PostgreSQL function',async(name)=>{
  await expect(operationRpc(db,`select ${name}($1)`,[i.tenant])).rejects.toThrow(/row_to_jsonb/);
 });
});
