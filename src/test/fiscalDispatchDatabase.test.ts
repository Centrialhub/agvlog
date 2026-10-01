// @vitest-environment node
import {beforeAll,beforeEach,afterEach,afterAll,it,expect,vi} from 'vitest';
import {createFiscalReadinessDatabase,prepareFiscal,fiscalSnapshot} from './helpers/fiscalReadinessDatabase';
import {fiscalServiceAdapter} from './helpers/fiscalServiceAdapter';
import {operationIds as i} from './helpers/operationOutcomeDatabase';
import {dispatchFiscalEmission} from '../../supabase/functions/_shared/fiscal-dispatch';
import {buildNFSeEmitPayload,type BuildNFSeInput} from '@/lib/fiscal/nfseBuilder';
import {resolveNFSeServiceValue} from '@/lib/fiscal/nfseServiceValue';
let context:Awaited<ReturnType<typeof createFiscalReadinessDatabase>>;
beforeAll(async()=>{context=await createFiscalReadinessDatabase();},30000);
beforeEach(async()=>{await context.db.exec('begin');});afterEach(async()=>{await context.db.exec('rollback');});afterAll(async()=>{await context?.db.close();});
const response=()=>({status:200,data:{document:{id:'hub-qa',status:'authorized',number:'1',accessKey:'test-key',authorizationProtocol:'test-protocol'}}});
async function input(options:{failConfirmation?:boolean}={}){
 const {db,emitter,client}=context;const document=await prepareFiscal(db,emitter,client);
 return {admin:fiscalServiceAdapter(db,options),tenant:i.tenant,actor:i.operator,emitter,type:'cte',environment:'homologation',fiscalId:document.id,body:fiscalSnapshot(client).cte_payload,call:vi.fn().mockResolvedValue(response())};
}
it('persists intent before the HTTP call and confirms all mirrors before success',async()=>{
 const args=await input();args.call.mockImplementation(async()=>{
  expect((await context.db.query('select count(*)::int n from hub_fiscal_emissions')).rows[0]).toEqual({n:1});return response();
 });
 const result=await dispatchFiscalEmission(args);expect(result.status).toBe(200);expect(args.call).toHaveBeenCalledOnce();
 expect((await context.db.query('select status from fiscal_documents where id=$1',[args.fiscalId])).rows[0]).toEqual({status:'authorized'});
});
it('does not post again after a lost network response',async()=>{
 const args=await input();args.call.mockRejectedValue(new Error('timeout after provider acceptance'));
 expect((await dispatchFiscalEmission(args)).status).toBe(409);expect((await dispatchFiscalEmission(args)).status).toBe(409);
 expect(args.call).toHaveBeenCalledOnce();
});
it('repairs a failed local confirmation through GET using the durable provider receipt',async()=>{
 const args=await input({failConfirmation:true});expect((await dispatchFiscalEmission(args)).status).toBe(409);
 expect((await dispatchFiscalEmission(args)).status).toBe(200);
 expect(args.call.mock.calls.map(call=>call[0])).toEqual(['POST','GET']);
});
it('does not send anything if reservation cannot be committed',async()=>{
 const args=await input();args.actor='ffffffff-ffff-4fff-8fff-ffffffffffff';
 await expect(dispatchFiscalEmission(args)).rejects.toThrow('fiscal_not_authorized');expect(args.call).not.toHaveBeenCalled();
});
it('does not convert a provider 503 or malformed success into authorization',async()=>{
 const args=await input();args.call.mockResolvedValue({status:503,data:{error:{code:'BOOT_ERROR'}}});
 expect((await dispatchFiscalEmission(args)).status).toBe(409);expect((await dispatchFiscalEmission(args)).status).toBe(409);expect(args.call).toHaveBeenCalledOnce();
});
it('a second session reaching the same in-flight intent cannot submit another document',async()=>{
 const args=await input();let release:(value:ReturnType<typeof response>)=>void=()=>{};
 const pending=new Promise<ReturnType<typeof response>>(resolve=>{release=resolve;});
 let started:()=>void=()=>{};const reached=new Promise<void>(resolve=>{started=resolve;});
 args.call.mockImplementation(()=>{started();return pending;});const first=dispatchFiscalEmission(args);await reached;
 expect((await dispatchFiscalEmission(args)).status).toBe(409);release(response());expect((await first).status).toBe(200);expect(args.call).toHaveBeenCalledOnce();
});


it('retains a matching Hub receipt on an error response and only GETs on the next attempt',async()=>{
 const args=await input();args.call.mockImplementation(async(_method,_path,_query,body)=>({status:502,data:{success:false,error:{code:'CTE_EXCEPTION'},document:{id:'hub-error',status:'error',idIntegracao:body?.idIntegracao,environment:args.environment,emitterCnpj:body?.emitterCnpj}}}));
 expect((await dispatchFiscalEmission(args)).status).toBe(409);
 expect((await context.db.query('select hub_document_id,status from hub_fiscal_emissions')).rows[0]).toEqual({hub_document_id:'hub-error',status:'pending'});
 await dispatchFiscalEmission(args);expect(args.call.mock.calls.map(call=>call[0])).toEqual(['POST','GET']);
});
it('does not attach an unrelated receipt from an error response',async()=>{
 const args=await input();args.call.mockResolvedValue({status:502,data:{document:{id:'wrong-hub',status:'error',idIntegracao:'other',environment:args.environment,emitterCnpj:'wrong'}}});
 await dispatchFiscalEmission(args);await dispatchFiscalEmission(args);
 expect((await context.db.query('select hub_document_id from hub_fiscal_emissions')).rows[0]).toEqual({hub_document_id:null});expect(args.call).toHaveBeenCalledOnce();
});

it.each([undefined,222.22])('keeps configured NFS-e freight/manual edit %s through the real claim RPC and effective transport',async manual=>{
 const {db,emitter,client}=context;
 const nfseId='fa200000-0000-4000-8000-000000000001';
 await db.query('update fiscal_documents set value=9876.54,freight_value=123.45 where id=$1',[i.doc]);
 const amount=resolveNFSeServiceValue(123.45,manual);
 await db.query("insert into nfse_documents(id,tenant_id,emitter_id,cliente_id,fiscal_document_ids,valor_servicos,valor_total,issue_date,status) values($1,$2,$3,$4,$5,$6,$6,current_date,'draft')",
  [nfseId,i.tenant,emitter,client,[i.doc],amount]);
 const doc:BuildNFSeInput['doc']={id:nfseId,rps_number:'1',issue_date:'2026-10-01',cod_servico:'160201',
  cliente_cnpj:'11222333000181',cliente_nome:'Tomador QA',cliente_municipio:'Belo Horizonte',cliente_cod_municipio:'3106200',
  cliente_uf:'MG',cliente_cep:'30110000',cliente_endereco:'Rua QA',cliente_numero:'10',cliente_bairro:'Centro',
  valor_servicos:amount,aliquota_iss:7,iss_retido:true,valor_iss:12.34,valor_pis:1.23,
  fiscal_document_ids:[i.doc],items:[{fiscal_document_id:i.doc,access_key:'29260614998371003215550000004411101880763852',unit_value:amount,total:amount}]};
 const built=buildNFSeEmitPayload({doc,environment:'homologation',emitter:{id:emitter,cnpj:'11222333000181',razao_social:'Emitente QA',im:'123',city_code:'3106200',regime_tributario:'normal',
  endereco:{uf:'MG',municipio:'Belo Horizonte',logradouro:'Rua QA',numero:'10',bairro:'Centro',cep:'30110000'}} as BuildNFSeInput['emitter']});
 const call=vi.fn().mockImplementation(async(method,path,query,body)=>{
  expect(method).toBe('POST');expect(path).toBe('/hub_documents_emit');expect(query).toEqual({type:'nfse'});
  expect(body.payload.servico[0]).toMatchObject({codigo:'160201',valor:{servico:amount,pis:1.23},iss:{aliquota:7,retido:true,valor:12.34}});
  const stored=(await db.query<{request_payload:unknown}>('select request_payload from hub_fiscal_emissions where nfse_document_id=$1',[nfseId])).rows[0];
  expect(stored.request_payload).toEqual(body);return response();
 });
 expect((await dispatchFiscalEmission({admin:fiscalServiceAdapter(db),tenant:i.tenant,actor:i.operator,emitter,type:'nfse',environment:'homologation',nfseId,body:built,call})).status).toBe(200);
 expect(call).toHaveBeenCalledOnce();
 expect((await db.query('select value,freight_value from fiscal_documents where id=$1',[i.doc])).rows[0]).toEqual({value:'9876.54',freight_value:'123.45'});
});
