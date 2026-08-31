// @vitest-environment node
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import {createFiscalReadinessDatabase,prepareFiscal,claimFiscal,completeFiscal,serviceFiscal} from './helpers/fiscalReadinessDatabase';
import {operationIds as i} from './helpers/operationOutcomeDatabase';
let context:Awaited<ReturnType<typeof createFiscalReadinessDatabase>>;
beforeAll(async()=>{context=await createFiscalReadinessDatabase();},30000);
beforeEach(async()=>{await context.db.exec('begin');});afterEach(async()=>{await context.db.exec('rollback');});afterAll(async()=>{await context.db.close();});
async function operation(){const doc=await prepareFiscal(context.db,context.emitter,context.client,'production');const claim=await claimFiscal(context.db,context.emitter,doc.id,'production');return{doc,claim};}
const rejected=(reference:string)=>({id:'hub-qa',status:'error',number:'269',series:'1',message:'Rejeicao: IE do destinatario nao vinculada ao CNPJ',idIntegracao:reference,environment:'production',emitterCnpj:'11222333000181',raw_response_json:{managersaas:{parsed:{cStat:'EXCEPTION',exceptionClass:'EspdManCTeRejeicaoEnvioException'}}}});
async function reconcileResponse(id:string,response:unknown,http=200){return (await serviceFiscal<{result:{confirmed:boolean;status?:string}}>(context.db,'select complete_hub_fiscal_emission($1,$2,$3::jsonb,$4) result',[i.tenant,id,JSON.stringify(response),http])).rows[0].result;}
it('reconciles the real error/EXCEPTION rejection and releases production source flags',async()=>{
 const {doc,claim}=await operation();await completeFiscal(context.db,claim.emission.id,'processing');
 expect(await reconcileResponse(claim.emission.id,{success:true,document:rejected(String(claim.emission.request_payload.idIntegracao))})).toMatchObject({confirmed:true,status:'rejected'});
 expect((await context.db.query('select status,sefaz_status,sefaz_message from fiscal_documents where id=$1',[doc.id])).rows[0]).toMatchObject({status:'rejected',sefaz_status:'rejected',sefaz_message:'Rejeicao: IE do destinatario nao vinculada ao CNPJ'});
 expect((await context.db.query('select cte_emitted_at,cte_emitted_outbound_id from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({cte_emitted_at:null,cte_emitted_outbound_id:null});
 expect((await context.db.query('select status,dispatch_state,hub_document_id from hub_fiscal_emissions')).rows[0]).toEqual({status:'rejected',dispatch_state:'recorded',hub_document_id:'hub-qa'});
});
it('records a typed rejection on the original HTTP error only when its identity matches',async()=>{
 const {claim}=await operation();expect(await reconcileResponse(claim.emission.id,{success:false,error:{code:'CTE_EXCEPTION'},document:rejected(String(claim.emission.request_payload.idIntegracao))},502)).toMatchObject({confirmed:true,status:'rejected'});
});
it('does not release a generic provider error or unknown state as rejection or processing',async()=>{
 const {claim}=await operation();for(const status of ['error','unexpected-state'])expect(await reconcileResponse(claim.emission.id,{document:{id:'hub-qa',status}})).toMatchObject({confirmed:false});
 expect((await context.db.query('select status,dispatch_state from hub_fiscal_emissions')).rows[0]).toEqual({status:'pending',dispatch_state:'uncertain'});
});
it('refuses an HTTP error receipt belonging to another integration reference',async()=>{
 const {claim}=await operation();expect(await reconcileResponse(claim.emission.id,{success:false,document:rejected('other')},502)).toMatchObject({confirmed:false});
});
it('does not downgrade an authorized document after a late typed rejection',async()=>{
 const {claim}=await operation();await completeFiscal(context.db,claim.emission.id,'authorized');expect(await reconcileResponse(claim.emission.id,{document:rejected(String(claim.emission.request_payload.idIntegracao))})).toMatchObject({status:'authorized'});
});
it('allows a corrected preview after rejection without sending anything automatically',async()=>{
 const {claim}=await operation();await reconcileResponse(claim.emission.id,{document:rejected(String(claim.emission.request_payload.idIntegracao))});const prepared=await prepareFiscal(context.db,context.emitter,context.client,'production');
 expect(prepared.id).not.toBeNull();expect((await context.db.query('select count(*)::int n from hub_fiscal_emissions')).rows[0]).toEqual({n:1});
});
