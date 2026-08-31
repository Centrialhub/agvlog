// @vitest-environment node
import {beforeAll,beforeEach,afterEach,afterAll,it,expect,vi} from 'vitest';
import {createFiscalReadinessDatabase,prepareFiscal,fiscalSnapshot,serviceFiscal} from './helpers/fiscalReadinessDatabase';
import {fiscalServiceAdapter} from './helpers/fiscalServiceAdapter';
import {operationIds as i} from './helpers/operationOutcomeDatabase';
import {dispatchFiscalEmission} from '../../supabase/functions/_shared/fiscal-dispatch';
let context:Awaited<ReturnType<typeof createFiscalReadinessDatabase>>;
beforeAll(async()=>{context=await createFiscalReadinessDatabase();},30000);
beforeEach(async()=>{await context.db.exec('begin');});afterEach(async()=>{await context.db.exec('rollback');});afterAll(async()=>{await context?.db.close();});
const receipt=(status='authorized')=>({status:200,data:{document:{id:'hub-qa',status,number:'270',series:'1',accessKey:'key-qa',authorizationProtocol:'131264829388436',message:'Autorizado'}}});
async function input(type:'cte'|'nfse'){
 const {db,emitter,client}=context;
 let id:string;
 if(type==='cte')id=(await prepareFiscal(db,emitter,client,'production')).id;
 else {id='fa200000-0000-4000-8000-000000000001';await db.query('insert into nfse_documents(id,tenant_id,emitter_id,cliente_id,fiscal_document_ids,valor_servicos,valor_total,issue_date) values($1,$2,$3,$4,$5,100,100,current_date)',[id,i.tenant,emitter,client,[i.doc,i.doc2]]);}
 return {admin:fiscalServiceAdapter(db),tenant:i.tenant,actor:i.operator,emitter,type,environment:'production',fiscalId:type==='cte'?id:undefined,nfseId:type==='nfse'?id:undefined,body:type==='cte'?fiscalSnapshot(client,'production').cte_payload:{emitterCnpj:'11222333000181',environment:'production',payload:{ambiente:'producao',valor:100}},call:vi.fn().mockResolvedValue(receipt())};
}
async function snapshot(){return (await context.db.query<Record<string,unknown>>('select status,dispatch_state,authorization_protocol,number,message,last_response from hub_fiscal_emissions')).rows[0];}
for(const type of ['cte','nfse'] as const){
 it.each(['processing','rejected','timeout','503','malformed'])('%s cannot replace committed '+type+' authorization or evidence',async late=>{
  const args=await input(type);expect((await dispatchFiscalEmission(args)).status).toBe(200);const before=await snapshot();
  if(late==='timeout')args.call.mockRejectedValue(new Error('network'));
  else if(late==='503')args.call.mockResolvedValue({status:503,data:{error:{code:'UNAVAILABLE'}}});
  else if(late==='malformed')args.call.mockResolvedValue({status:200,data:{success:false}});
  else args.call.mockResolvedValue({status:200,data:{document:{...receipt(late).data.document,number:'batch-placeholder',authorizationProtocol:'batch',message:'late'}}});
  const result=await dispatchFiscalEmission(args);expect(result.status).toBe(200);expect(result.data).toMatchObject({success:true,hub:{document:{status:'authorized',number:'270',authorizationProtocol:'131264829388436'}}});
  expect(await snapshot()).toEqual(before);expect(args.call.mock.calls.map(call=>call[0])).toEqual(['POST','GET']);
  expect((await context.db.query<Record<string,unknown>>('select '+(type==='cte'?'cte_emitted_outbound_id':'nfse_emitted_document_id')+' source from fiscal_documents where id=$1',[i.doc])).rows[0].source).toBe(args.fiscalId||args.nfseId);
 });
 it('keeps '+type+' authorization when an exhausted poll races with its callback',async()=>{
  const args=await input(type);await dispatchFiscalEmission(args);
  const result=await serviceFiscal<{result:{status:string;queued_for_reconciliation:boolean}}>(context.db,"select terminalize_fiscal_poll_v1($1,$2,$3,'270','provider_unavailable',30,now(),'{}') result",[i.tenant,type,args.fiscalId||args.nfseId]);
  expect(result.rows[0].result.queued_for_reconciliation).toBe(false);
  expect((await context.db.query<Record<string,unknown>>('select count(*)::int n from fiscal_poll_dead_letters')).rows[0].n).toBe(0);
  expect((await snapshot()).status).toBe('authorized');
 });
 it('queues an uncertain '+type+' without releasing it for duplicate billing',async()=>{
  const args=await input(type);args.call.mockRejectedValue(new Error('timeout'));await dispatchFiscalEmission(args);
  await serviceFiscal(context.db,"select terminalize_fiscal_poll_v1($1,$2,$3,'270','provider_unavailable',30,now(),'{}')",[i.tenant,type,args.fiscalId||args.nfseId]);
  const table=type==='cte'?'fiscal_documents':'nfse_documents';
  expect((await context.db.query<Record<string,unknown>>('select status from '+table+' where id=$1',[args.fiscalId||args.nfseId])).rows[0].status).toBe(type==='cte'?'transmitting':'submitted');
  expect((await context.db.query<Record<string,unknown>>('select count(*)::int n from fiscal_source_reservations')).rows[0].n).toBe(2);
  expect((await context.db.query<Record<string,unknown>>('select count(*)::int n from fiscal_poll_dead_letters')).rows[0].n).toBe(1);
 });
}
it('NFS-e rejection releases sources but a late processing response cannot hide the rejection',async()=>{
 const args=await input('nfse');args.call.mockResolvedValue(receipt('rejected'));await dispatchFiscalEmission(args);const before=await snapshot();
 args.call.mockResolvedValue(receipt('processing'));await dispatchFiscalEmission(args);expect(await snapshot()).toEqual(before);
 expect((await context.db.query<Record<string,unknown>>('select status from nfse_documents where id=$1',[args.nfseId])).rows[0].status).toBe('rejected');
 expect((await context.db.query<Record<string,unknown>>('select nfse_emitted_at from fiscal_documents where id=$1',[i.doc])).rows[0].nfse_emitted_at).toBeNull();
 expect((await context.db.query<Record<string,unknown>>('select count(*)::int n from fiscal_source_reservations')).rows[0].n).toBe(0);
});
it('NFS-e authorization remains repairable by GET after a failed mirror transaction',async()=>{
 const args=await input('nfse');args.admin=fiscalServiceAdapter(context.db,{failConfirmation:true});
 expect((await dispatchFiscalEmission(args)).status).toBe(409);expect((await dispatchFiscalEmission(args)).status).toBe(200);
 expect(args.call.mock.calls.map(call=>call[0])).toEqual(['POST','GET']);
});
it('CT-e refresh preserves a verified protocol when the Hub still returns its batch number',async()=>{
 const args=await input('cte');await dispatchFiscalEmission(args);
 args.call.mockResolvedValue({status:200,data:{document:{...receipt().data.document,authorizationProtocol:'270'}}});await dispatchFiscalEmission(args);
 expect((await snapshot()).authorization_protocol).toBe('131264829388436');
});
