// @vitest-environment node
import {afterAll,beforeAll,beforeEach,afterEach,describe,expect,it} from 'vitest';
import {createFiscalReadinessDatabase,serviceFiscal} from './helpers/fiscalReadinessDatabase';
import {operationIds as ids} from './helpers/operationOutcomeDatabase';

let context:Awaited<ReturnType<typeof createFiscalReadinessDatabase>>;
const nfse1='fa200000-0000-4000-8000-000000000001';
const nfse2='fa200000-0000-4000-8000-000000000002';

beforeAll(async()=>{context=await createFiscalReadinessDatabase();},30000);
beforeEach(async()=>{
 await context.db.exec('begin');
 await context.db.query(
  "insert into nfse_documents(id,tenant_id,emitter_id,cliente_id,fiscal_document_ids,valor_servicos,valor_total,issue_date,status) values($1,$2,$3,$4,$5,100,100,current_date,'draft'),($6,$2,$3,$4,$7,200,200,current_date,'draft')",
  [nfse1,ids.tenant,context.emitter,context.client,[ids.doc],nfse2,[ids.doc2]],
 );
});
afterEach(async()=>{await context.db.exec('rollback');});
afterAll(async()=>{await context?.db.close();});

const snapshot=(entries= [nfse1,nfse2])=>({
 mode:'individual',environment:'homologation',emitterId:context.emitter,
 entries:entries.map(nfseDocumentId=>({nfseDocumentId,body:{environment:'homologation',emitterCnpj:'11222333000181',payload:{aliquota:2}}})),
});
const prepare=(requestId:string,value= snapshot())=>serviceFiscal<{result:{recovered:boolean}}>(context.db,
 'select prepare_nfse_issue_batch_v1($1,$2,$3,$4,$5,$6,$7::jsonb) result',
 [ids.tenant,ids.operator,requestId,'individual','homologation',context.emitter,JSON.stringify(value)],
);

describe('durable NFS-e batch preparation',()=>{
 it('preserves shared private-schema usage while keeping batch state service-only',async()=>{
  expect((await context.db.query(`select
   has_schema_privilege('authenticated','private','usage') authenticated_schema_usage,
   has_table_privilege('authenticated','private.nfse_issue_batches','select') authenticated_batch_read,
   has_function_privilege('authenticated','public.prepare_nfse_issue_batch_v1(uuid,uuid,text,text,text,uuid,jsonb)','execute') authenticated_prepare,
   has_function_privilege('service_role','public.prepare_nfse_issue_batch_v1(uuid,uuid,text,text,text,uuid,jsonb)','execute') service_prepare`)).rows[0])
   .toEqual({authenticated_schema_usage:true,authenticated_batch_read:false,authenticated_prepare:false,service_prepare:true});
 });

 it('reserves every individual source atomically before transport',async()=>{
  expect((await prepare('batch-1')).rows[0].result).toMatchObject({recovered:false});
  expect((await context.db.query('select source_id,nfse_id from fiscal_source_reservations order by source_id')).rows)
   .toEqual([{source_id:ids.doc,nfse_id:nfse1},{source_id:ids.doc2,nfse_id:nfse2}]);
  expect((await context.db.query('select count(*)::int n from private.nfse_issue_batch_items')).rows[0]).toEqual({n:2});
 });

 it('recovers the exact request and rejects a changed tax snapshot',async()=>{
  await prepare('batch-retry');
  expect((await prepare('batch-retry')).rows[0].result).toMatchObject({recovered:true});
  const changed=snapshot();changed.entries[0].body.payload.aliquota=3;
  await expect(prepare('batch-retry',changed)).rejects.toThrow('nfse_batch_request_conflict');
  expect((await context.db.query('select count(*)::int n from private.nfse_issue_batches')).rows[0]).toEqual({n:1});
 });

 it('rolls back the whole preparation when one source is already reserved',async()=>{
  await context.db.query('insert into fiscal_source_reservations(tenant_id,environment,source_id,nfse_id) values($1,$2,$3,$4)',
   [ids.tenant,'homologation',ids.doc2,nfse2]);
  await expect(prepare('batch-conflict')).rejects.toThrow('fiscal_sources_reserved');
  expect((await context.db.query('select count(*)::int n from private.nfse_issue_batches')).rows[0]).toEqual({n:0});
  expect((await context.db.query('select count(*)::int n from fiscal_source_reservations')).rows[0]).toEqual({n:1});
 });
});
