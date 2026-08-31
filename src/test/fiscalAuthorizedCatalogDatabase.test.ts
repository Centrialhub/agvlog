// @vitest-environment node
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createFiscalReadinessDatabase,prepareFiscal,claimFiscal,serviceFiscal} from './helpers/fiscalReadinessDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
let context:Awaited<ReturnType<typeof createFiscalReadinessDatabase>>;
beforeAll(async()=>{context=await createFiscalReadinessDatabase();},30000);
beforeEach(async()=>{await context.db.exec('begin');});afterEach(async()=>{await context.db.exec('rollback');});afterAll(async()=>{await context?.db.close();});
const key='31260818666510000168570010000002701792800927';
const receipt=(syncKey=key)=>({success:true,document:{id:'hub-270',status:'authorized',number:'270',series:'1',accessKey:key,authorizationProtocol:'79280092',message:'Autorizado o uso do CT-e,131264829388436,270,1',raw_response_json:{managersaas_sync:{raw:syncKey+',AUTORIZADA,100,Autorizado o uso do CT-e,131264829388436,270,1'}}}});
async function operation(){const doc=await prepareFiscal(context.db,context.emitter,context.client,'production');const claim=await claimFiscal(context.db,context.emitter,doc.id,'production');return{doc,claim};}
async function reconcileReceipt(id:string,data=receipt()){return serviceFiscal(context.db,'select complete_hub_fiscal_emission($1,$2,$3::jsonb,200) result',[i.tenant,id,JSON.stringify(data)]);}
it('stores authorization, actual protocol, generated batch and billable CT-e with production CHECK constraints',async()=>{
 const {doc,claim}=await operation();await reconcileReceipt(claim.emission.id);
 expect((await context.db.query('select status,authorization_protocol from hub_fiscal_emissions')).rows[0]).toEqual({status:'authorized',authorization_protocol:'131264829388436'});
 expect((await context.db.query('select source_type,status from cte_batches')).rows[0]).toEqual({source_type:'fiscal_documents',status:'generated'});
 expect((await context.db.query('select status,protocol_number,cte_number,cte_series from cte_documents')).rows[0]).toEqual({status:'authorized',protocol_number:'131264829388436',cte_number:'270',cte_series:'1'});
 expect((await operationRpc(context.db,"select filter_billable_fiscal_sources($1,'cte_document',$2) ids",[i.tenant,[doc.id]])).rows[0]).toEqual({ids:[doc.id]});
 expect((await context.db.query('select cte_emitted_outbound_id from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({cte_emitted_outbound_id:doc.id});
});
it('recovers confirmation after the old mirror rolls back on the batch CHECK constraint',async()=>{
 const {claim}=await operation();const baseline=readFileSync('supabase/migrations/20260831124505_fiscal_emission_readiness.sql','utf8');const start=baseline.indexOf('create function public.mirror_hub_cte_for_billing');const old=baseline.slice(start,baseline.indexOf('create trigger mirror_hub_cte_for_billing',start)).replace('create function','create or replace function');await context.db.exec(old);
 await expect(reconcileReceipt(claim.emission.id)).rejects.toThrow('cte_batches_status_check');
 expect((await context.db.query('select status from hub_fiscal_emissions')).rows[0]).toEqual({status:'pending'});
 await context.db.exec(readFileSync('supabase/migrations/20260831160938_reconcile_authorized_cte_catalog.sql','utf8'));
 await reconcileReceipt(claim.emission.id);expect((await context.db.query('select status from hub_fiscal_emissions')).rows[0]).toEqual({status:'authorized'});
});
it('repeated reconciliation does not duplicate the catalog or batch',async()=>{
 const {claim}=await operation();await reconcileReceipt(claim.emission.id);await reconcileReceipt(claim.emission.id);
 expect((await context.db.query('select (select count(*)::int from cte_batches) batches,(select count(*)::int from cte_documents) documents')).rows[0]).toEqual({batches:1,documents:1});
});
it('does not borrow a protocol from a sync receipt for a different access key',async()=>{
 const {claim}=await operation();await reconcileReceipt(claim.emission.id,receipt('1'.repeat(44)));
 expect((await context.db.query('select authorization_protocol from hub_fiscal_emissions')).rows[0]).not.toEqual({authorization_protocol:'131264829388436'});
});
it('keeps explicit catalog CHECK constraints instead of allowing arbitrary statuses',async()=>{
 const {claim}=await operation();await reconcileReceipt(claim.emission.id);
 await expect(context.db.exec("update cte_documents set status='not-a-state'")).rejects.toThrow('cte_documents_status_check');
});
