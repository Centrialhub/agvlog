// @vitest-environment node
import {beforeAll,beforeEach,afterEach,afterAll,it,expect,vi} from 'vitest';
import {createFiscalReadinessDatabase,prepareFiscal,claimFiscal,completeFiscal,serviceFiscal,fiscalSnapshot} from './helpers/fiscalReadinessDatabase';
import {operationIds as i} from './helpers/operationOutcomeDatabase';
import {fiscalServiceAdapter} from './helpers/fiscalServiceAdapter';
import {dispatchFiscalEmission} from '../../supabase/functions/_shared/fiscal-dispatch';
let context:Awaited<ReturnType<typeof createFiscalReadinessDatabase>>;
beforeAll(async()=>{context=await createFiscalReadinessDatabase();},30000);
beforeEach(async()=>{await context.db.exec('begin');});afterEach(async()=>{await context.db.exec('rollback');});afterAll(async()=>{await context.db.close();});
async function pair(){const {db,emitter,client}=context;return {first:await prepareFiscal(db,emitter,client,'production',[i.doc]),second:await prepareFiscal(db,emitter,client,'production',[i.doc2])};}
it('admits only one CT-e at a time and allows the next after terminal confirmation',async()=>{
 const {db,emitter}=context;const {first,second}=await pair();const a=await claimFiscal(db,emitter,first.id,'production');
 await expect(claimFiscal(db,emitter,second.id,'production')).rejects.toThrow('fiscal_emitter_busy');
 expect((await claimFiscal(db,emitter,first.id,'production')).dispatch).toBe(false);
 expect((await db.query<{n:number}>('select count(*)::int n from hub_fiscal_emissions')).rows[0].n).toBe(1);
 await completeFiscal(db,a.emission.id);expect((await claimFiscal(db,emitter,second.id,'production')).dispatch).toBe(true);
});
it.each(['processing','unknown'])('keeps the emitter reserved after %s without a timeout-based resend',async status=>{
 const {db,emitter}=context;const {first,second}=await pair();const a=await claimFiscal(db,emitter,first.id,'production');
 await completeFiscal(db,a.emission.id,status);await db.query("update hub_fiscal_emissions set created_at=now()-interval '2 days' where id=$1",[a.emission.id]);
 await expect(claimFiscal(db,emitter,second.id,'production')).rejects.toThrow('fiscal_emitter_busy');
});
it('does not send a second HTTP request while the first provider request has no result',async()=>{
 const {db,emitter,client}=context;const {first,second}=await pair();
 const base={admin:fiscalServiceAdapter(db),tenant:i.tenant,actor:i.operator,emitter,type:'cte',environment:'production',body:fiscalSnapshot(client,'production').cte_payload};
 let resolveResponse:(value:{status:number;data:unknown})=>void=()=>{};let started:()=>void=()=>{};
 const reached=new Promise<void>(resolve=>{started=resolve;});const response=new Promise<{status:number;data:unknown}>(resolve=>{resolveResponse=resolve;});
 const call=vi.fn(()=>{started();return response;});const pending=dispatchFiscalEmission({...base,fiscalId:first.id,call});await reached;
 const secondCall=vi.fn();await expect(dispatchFiscalEmission({...base,fiscalId:second.id,call:secondCall})).rejects.toThrow('fiscal_emitter_busy');expect(secondCall).not.toHaveBeenCalled();
 resolveResponse({status:200,data:{document:{id:'hub-qa',status:'authorized'}}});expect((await pending).status).toBe(200);
});
it('accepts an identity-bound rejected status on HTTP502 and releases the lane',async()=>{
 const {db,emitter}=context;const {first,second}=await pair();const a=await claimFiscal(db,emitter,first.id,'production');
 const document={id:'hub-qa',status:'rejected',idIntegracao:a.emission.request_payload.idIntegracao,environment:'production',emitterCnpj:'11222333000181',message:'IE do destinatario nao informada',raw_response_json:{managersaas:{parsed:{exceptionClass:'EspdManCTeRejeicaoEnvioException'}}}};
 const response=await serviceFiscal<{result:{confirmed:boolean;status:string}}>(db,'select complete_hub_fiscal_emission($1,$2,$3::jsonb,502) result',[i.tenant,a.emission.id,JSON.stringify({success:false,error:{code:'CTE_EXCEPTION'},document})]);
 expect(response.rows[0].result).toMatchObject({confirmed:true,status:'rejected'});expect((await claimFiscal(db,emitter,second.id,'production')).dispatch).toBe(true);
});
it('records provider_unknown without interpreting it as authorization or releasing the lane',async()=>{
 const {db,emitter}=context;const {first,second}=await pair();const a=await claimFiscal(db,emitter,first.id,'production');
 const response=await serviceFiscal<{result:{confirmed:boolean;status:string}}>(db,'select complete_hub_fiscal_emission($1,$2,$3::jsonb,200) result',[i.tenant,a.emission.id,JSON.stringify({document:{id:'hub-qa',status:'provider_unknown',message:'Duplicidade de CT-e com outra chave',raw_response_json:{managersaas:{parsed:{exceptionClass:'EspdManCTeRejeicaoEnvioException'}}}}})]);
 expect(response.rows[0].result).toMatchObject({confirmed:true,status:'provider_unknown'});await expect(claimFiscal(db,emitter,second.id,'production')).rejects.toThrow('fiscal_emitter_busy');
});
