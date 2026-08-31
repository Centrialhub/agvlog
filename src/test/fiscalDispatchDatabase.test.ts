// @vitest-environment node
import {beforeAll,beforeEach,afterEach,afterAll,it,expect,vi} from 'vitest';
import {createFiscalReadinessDatabase,prepareFiscal,fiscalSnapshot} from './helpers/fiscalReadinessDatabase';
import {fiscalServiceAdapter} from './helpers/fiscalServiceAdapter';
import {operationIds as i} from './helpers/operationOutcomeDatabase';
import {dispatchFiscalEmission} from '../../supabase/functions/_shared/fiscal-dispatch';
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

