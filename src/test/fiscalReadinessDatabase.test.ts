// @vitest-environment node
import {beforeAll,beforeEach,afterEach,afterAll,describe,it,expect} from 'vitest';
import {createFiscalReadinessDatabase,fiscalSnapshot,prepareFiscal,claimFiscal,completeFiscal,serviceFiscal} from './helpers/fiscalReadinessDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {manualInvoiceDraft,directInvoicePayload,invoiceCommand,invoiceCreationContext} from './helpers/clientInvoiceLifecycleDatabase';
let context:Awaited<ReturnType<typeof createFiscalReadinessDatabase>>;
beforeAll(async()=>{context=await createFiscalReadinessDatabase();},30000);
beforeEach(async()=>{await context.db.exec('begin');});
afterEach(async()=>{await context.db.exec('rollback');});
afterAll(async()=>{await context?.db.close();});
describe('durable fiscal issuance and commercial billing',()=>{
 it('recovers the same frozen preparation after a lost response and reordered sources',async()=>{
  const {db,emitter,client}=context;const first=await prepareFiscal(db,emitter,client);
  const next=await prepareFiscal(db,emitter,client,'homologation',[i.doc2,i.doc]);
  expect(next.id).toBe(first.id);expect(next.recovered).toBe(true);
  expect((await db.query("select count(*)::int n from fiscal_documents where document_type='outbound'")).rows[0]).toEqual({n:1});
 });
 it('refuses changed preview data while an earlier preparation is unresolved',async()=>{
  const {db,emitter,client}=context;await prepareFiscal(db,emitter,client);
  const changed={...fiscalSnapshot(client),freight_value:999};
  await expect(operationRpc(db,'select prepare_cte_issue($1,$2,$3,$4,$5::jsonb)',[i.tenant,emitter,'homologation',[i.doc,i.doc2],JSON.stringify(changed)])).rejects.toThrow('fiscal_snapshot_changed_reconcile_first');
 });
 it('does not let an overlapping group create another outbound document',async()=>{
  const {db,emitter,client}=context;await prepareFiscal(db,emitter,client);
  await expect(prepareFiscal(db,emitter,client,'homologation',[i.doc])).rejects.toThrow('fiscal_sources_reserved');
 });
 it('rejects a source from another tenant before any reservation',async()=>{
  const {db,emitter,client}=context;
  await expect(prepareFiscal(db,emitter,client,'homologation',['ffffffff-ffff-4fff-8fff-ffffffffffff'])).rejects.toThrow('fiscal_source_invalid');
  expect((await db.query('select count(*)::int n from fiscal_source_reservations')).rows[0]).toEqual({n:0});
 });
 it('only the first claim permits a POST; changing client IDs cannot bypass it',async()=>{
  const {db,emitter,client}=context;const doc=await prepareFiscal(db,emitter,client);
  const first=await claimFiscal(db,emitter,doc.id),again=await claimFiscal(db,emitter,doc.id);
  expect(first.dispatch).toBe(true);expect(again.dispatch).toBe(false);expect(again.emission.id).toBe(first.emission.id);
  expect(first.emission.request_payload.externalId).toBe('agvlog-'+first.emission.id);
 });
 it('keeps HTTP 503 uncertain and never grants a second dispatch',async()=>{
  const {db,emitter,client}=context;const doc=await prepareFiscal(db,emitter,client);const claim=await claimFiscal(db,emitter,doc.id);
  await completeFiscal(db,claim.emission.id,'processing',503);
  expect((await claimFiscal(db,emitter,doc.id)).dispatch).toBe(false);
  expect((await db.query('select status from fiscal_documents where id=$1',[doc.id])).rows[0]).toEqual({status:'transmitting'});
 });
 it('atomically persists authorization and exposes a production CT-e to billing',async()=>{
  const {db,emitter,client}=context;const doc=await prepareFiscal(db,emitter,client,'production');const claim=await claimFiscal(db,emitter,doc.id,'production');
  await completeFiscal(db,claim.emission.id);
  expect((await db.query('select status,hub_document_id from fiscal_documents where id=$1',[doc.id])).rows[0]).toEqual({status:'authorized',hub_document_id:'hub-qa'});
  expect((await operationRpc(db,"select filter_billable_fiscal_sources($1,'cte_document',$2) ids",[i.tenant,[doc.id]])).rows[0]).toEqual({ids:[doc.id]});
  expect((await db.query('select count(*)::int n from fiscal_documents where cte_emitted_outbound_id=$1',[doc.id])).rows[0]).toEqual({n:2});
 });
 it('homologation neither consumes production source flags nor creates billable sources',async()=>{
  const {db,emitter,client}=context;const doc=await prepareFiscal(db,emitter,client);const claim=await claimFiscal(db,emitter,doc.id);await completeFiscal(db,claim.emission.id);
  expect((await db.query('select cte_emitted_at from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({cte_emitted_at:null});
  expect((await operationRpc(db,"select filter_billable_fiscal_sources($1,'cte_document',$2) ids",[i.tenant,[doc.id]])).rows[0]).toEqual({ids:[]});
 });
 it('does not downgrade a terminal authorization after a late processing response',async()=>{
  const {db,emitter,client}=context;const doc=await prepareFiscal(db,emitter,client);const claim=await claimFiscal(db,emitter,doc.id);
  await completeFiscal(db,claim.emission.id);await completeFiscal(db,claim.emission.id,'processing');
  expect((await db.query('select status from fiscal_documents where id=$1',[doc.id])).rows[0]).toEqual({status:'authorized'});
 });
 it('rolls the entire confirmation back if the local document cannot be updated',async()=>{
  const {db,emitter,client}=context;const doc=await prepareFiscal(db,emitter,client);const claim=await claimFiscal(db,emitter,doc.id);
  await db.exec("create function qa_fiscal_fail() returns trigger language plpgsql as $$begin raise exception 'qa_mirror_failed';end;$$; create trigger qa_fiscal_fail before update on fiscal_documents for each row execute function qa_fiscal_fail();");
  await expect(completeFiscal(db,claim.emission.id)).rejects.toThrow('qa_mirror_failed');
  expect((await db.query('select status,dispatch_state from hub_fiscal_emissions where id=$1',[claim.emission.id])).rows[0]).toEqual({status:'pending',dispatch_state:'in_flight'});
 });
 it('rejects environment changes for an already prepared document',async()=>{
  const {db,emitter,client}=context;const doc=await prepareFiscal(db,emitter,client);await claimFiscal(db,emitter,doc.id);
  await expect(claimFiscal(db,emitter,doc.id,'production')).rejects.toThrow('fiscal_existing_environment_mismatch');
 });
 it('denies browser calls to service-only dispatch and confirmation',async()=>{
  const {db}=context;
  await expect(operationRpc(db,"select complete_hub_fiscal_emission($1,$2,'{}',200)",[i.tenant,i.doc])).rejects.toThrow('permission denied');
  expect((await db.query("select has_table_privilege('authenticated','hub_fiscal_emissions','UPDATE') allowed")).rows[0]).toEqual({allowed:false});
 });
 it('rejects a revoked operator preparing another document',async()=>{
  const {db,emitter,client}=context;await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[i.tenant,i.operator]);
  await expect(prepareFiscal(db,emitter,client)).rejects.toThrow('fiscal_not_authorized');
 });
 it('rejected provider state allows a new corrected preparation, preserving the old record',async()=>{
  const {db,emitter,client}=context;const doc=await prepareFiscal(db,emitter,client);const claim=await claimFiscal(db,emitter,doc.id);await completeFiscal(db,claim.emission.id,'rejected');
  const corrected=await prepareFiscal(db,emitter,client);expect(corrected.id).not.toBe(doc.id);
  expect((await db.query('select count(*)::int n from hub_fiscal_emissions')).rows[0]).toEqual({n:1});
 });
 it('validates fiscal proof on the invoice server even if a client bypasses the filter',async()=>{
  const {db,emitter,client}=context;const doc=await prepareFiscal(db,emitter,client);const claim=await claimFiscal(db,emitter,doc.id);await completeFiscal(db,claim.emission.id);
  const draft=await manualInvoiceDraft(db);draft.charges=[{source_type:'cte_document',source_id:doc.id,description:'CT-e QA',gross_amount:100,net_amount:100,sort_order:0}] as unknown as typeof draft.charges;
  await expect(invoiceCreationContext(db,null,draft)).rejects.toThrow('invoice_source_not_authorized_production');
 });
 it('generates one invoice and receivable from a production authorization',async()=>{
  const {db,emitter,client}=context;const doc=await prepareFiscal(db,emitter,client,'production');const claim=await claimFiscal(db,emitter,doc.id,'production');await completeFiscal(db,claim.emission.id);
  const draft=await manualInvoiceDraft(db);draft.charges=[{source_type:'cte_document',source_id:doc.id,description:'CT-e QA',gross_amount:100,net_amount:100,sort_order:0}] as unknown as typeof draft.charges;
  const payload=await directInvoicePayload(db,draft);const first=await invoiceCommand(db,payload);expect((await invoiceCommand(db,payload)).invoice_id).toBe(first.invoice_id);
  expect((await db.query('select count(*)::int n from receivables where client_invoice_id=$1',[first.invoice_id])).rows[0]).toEqual({n:1});
 });
});


describe('NFS-e source reservations and environment',()=>{
 async function nfse(environment='homologation'){
  const {db,emitter,client}=context;const id='fa200000-0000-4000-8000-000000000001';
  await db.query("insert into nfse_documents(id,tenant_id,emitter_id,cliente_id,fiscal_document_ids,valor_servicos,valor_total,issue_date) values($1,$2,$3,$4,$5,100,100,current_date)",[id,i.tenant,emitter,client,[i.doc,i.doc2]]);
  const body={emitterCnpj:'11222333000181',environment,externalId:'browser-controlled',payload:{ambiente:'producao',valor:100}};
  const result=await serviceFiscal<{result:{dispatch:boolean;emission:{id:string;request_payload:{payload:{ambiente:string}}}}}>(db,
   'select claim_hub_fiscal_emission($1,$2,$3,$4,$5,$6::jsonb,null,null,$7) result',[i.tenant,i.operator,emitter,'nfse',environment,JSON.stringify(body),id]);
  return {id,claim:result.rows[0].result};
 }
 it('forces homologation inside the payload and reserves sources without production flags',async()=>{
  const {db}=context;const {id,claim}=await nfse();
  expect(claim.emission.request_payload.payload.ambiente).toBe('homologacao');
  expect((await db.query('select status from nfse_documents where id=$1',[id])).rows[0]).toEqual({status:'submitted'});
  expect((await db.query('select count(*)::int n from fiscal_source_reservations where nfse_id=$1',[id])).rows[0]).toEqual({n:2});
  await completeFiscal(db,claim.emission.id);
  expect((await db.query('select nfse_emitted_at from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({nfse_emitted_at:null});
 });
 it.each(['update','delete'])('blocks authenticated %s of an uncertain NFS-e even with table write grants',async(action)=>{
  const {db}=context;const {id}=await nfse();
  await db.exec('grant select on hub_fiscal_emissions to authenticated;grant select,update,delete on nfse_documents to authenticated');
  const sql=action==='update'?'update nfse_documents set valor_servicos=999 where id=$1':'delete from nfse_documents where id=$1';
  await expect(operationRpc(db,sql,[id])).rejects.toThrow('fiscal_document_locked_until_reconciled');
  expect((await db.query('select status,valor_servicos::int amount from nfse_documents where id=$1',[id])).rows[0]).toEqual({status:'submitted',amount:100});
  expect((await db.query('select count(*)::int n from fiscal_source_reservations where nfse_id=$1',[id])).rows[0]).toEqual({n:2});
 });
 it('prevents CT-e from competing for NFS-e sources',async()=>{
  const {db,emitter,client}=context;await nfse();
  await expect(prepareFiscal(db,emitter,client)).rejects.toThrow('fiscal_sources_reserved');
 });
 it('sets and clears production source flags only after provider confirmation',async()=>{
  const {db}=context;const {id,claim}=await nfse('production');await completeFiscal(db,claim.emission.id);
  expect((await db.query('select nfse_emitted_document_id from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({nfse_emitted_document_id:id});
  await completeFiscal(db,claim.emission.id,'cancelled');
  expect((await db.query('select nfse_emitted_document_id from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({nfse_emitted_document_id:null});
 });
 it('refuses changing provider identity during reconciliation',async()=>{
  const {db}=context;const {claim}=await nfse();await completeFiscal(db,claim.emission.id);
  await expect(serviceFiscal(db,"select complete_hub_fiscal_emission($1,$2,$3::jsonb,200)",[i.tenant,claim.emission.id,JSON.stringify({document:{id:'other-provider-document',status:'authorized'}})])).rejects.toThrow('fiscal_provider_identity_mismatch');
 });
});

