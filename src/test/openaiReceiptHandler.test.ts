// @vitest-environment node
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {it,expect,vi} from 'vitest';
import {receiptOcrConfiguration} from '../../supabase/functions/process-delivery-receipt-ocr/configuration';
import {processReceiptOcr} from '../../supabase/functions/process-delivery-receipt-ocr/worker';
import {syntheticReceiptImages} from '../../supabase/functions/process-delivery-receipt-ocr/synthetic-fixtures';
const js=ts.transpileModule(readFileSync('supabase/functions/process-delivery-receipt-ocr/index.ts','utf8'),
 {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^import .*;\r?\n/gm,'').replace(/^export \{\};?\r?\n?/gm,'');
const reading={text:'Recebido em 09/11/2026',date_text:'09/11/2026',delivery_date:'2026-11-09',date_confidence:0.95,signature_presence:'present',signature_confidence:0.96,needs_review:false};
const providerResponse=(r:unknown)=>new Response(JSON.stringify({status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(r)}]}],usage:{input_tokens:100,output_tokens:50}}));
function setup(key:string|null='test-server-credential'){
 const transport=vi.fn<typeof fetch>().mockImplementation(async()=>providerResponse(reading)),rpc=vi.fn(),download=vi.fn(),log=vi.fn();
 let handler!:(r:Request)=>Promise<Response>;
 const env:Record<string,string|undefined>={SUPABASE_URL:'https://db.example.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',DELIVERY_RECEIPT_OCR_ADAPTER:'openai',OPENAI_API_KEY:key??undefined};
 vm.runInNewContext(js,{createClient:()=>({rpc,storage:{from:()=>({download})}}),corsHeaders:{},
  isCronRequest:async(r:Request)=>r.headers.get('x-agvlog-cron-secret')==='synthetic-cron',
  receiptOcrConfiguration:(get:(key:string)=>string|undefined)=>receiptOcrConfiguration(get,transport),processReceiptOcr,syntheticReceiptImages,
  Deno:{env:{get:(name:string)=>env[name]},serve:(fn:typeof handler)=>{handler=fn;}},Response,Request,Uint8Array,atob,console:{info:log}});
 const invoke=(body:Record<string,unknown>,authorized=true)=>handler(new Request('https://db.example.test/functions/v1/process-delivery-receipt-ocr',{
  method:'POST',headers:{'Content-Type':'application/json',...(authorized?{'x-agvlog-cron-secret':'synthetic-cron'}:{})},body:JSON.stringify(body)}));
 return {transport,rpc,download,log,invoke};
}
it('private authentication and absent key prevent all image/queue work',async()=>{
 const s=setup(null);expect((await s.invoke({mode:'health'},false)).status).toBe(401);
 expect(await (await s.invoke({mode:'health'})).json()).toEqual({adapter_available:false,error:'ocr_not_configured'});
 expect(await (await s.invoke({mode:'process'})).json()).toMatchObject({adapter_available:false,claimed:0});
 expect(s.rpc).not.toHaveBeenCalled();expect(s.download).not.toHaveBeenCalled();expect(s.transport).not.toHaveBeenCalled();
});
it('real handler completes the leased image using OpenAI provenance and aggregate-only usage logs',async()=>{
 const s=setup(),image=new Uint8Array([255,216,255,1,2,3]);
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',image))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const claim={status:'claimed',job_id:'job',tenant_id:'tenant',bucket:'receipts',path:'tenant/image.jpg',processed_hash:hash,lease_token:'lease'};
 s.rpc.mockImplementation(async(name:string)=>({data:name==='claim_delivery_receipt_ocr_v1'?claim:{applied:true},error:null}));
 s.download.mockResolvedValue({data:new Blob([image]),error:null});
 expect((await s.invoke({limit:1})).status).toBe(200);
 expect(s.rpc).toHaveBeenCalledWith('complete_delivery_receipt_ocr_v2',expect.objectContaining({_job_id:'job',_lease_token:'lease',_processed_hash:hash,
  _result:expect.objectContaining({provider:'openai',model:'gpt-6-luna'})}));
 const logged=JSON.parse(s.log.mock.calls[0][0]);expect(logged.usage).toEqual({requests:1,input_tokens:100,output_tokens:50});
 expect(s.log.mock.calls[0][0]).not.toContain('test-server-credential');expect(s.log.mock.calls[0][0]).not.toContain(reading.text);
});
it('private self-test uses two synthetic images and never claims production jobs',async()=>{
 const s=setup();s.transport.mockReset().mockResolvedValueOnce(providerResponse(reading)).mockResolvedValueOnce(providerResponse({...reading,text:'',date_text:null,delivery_date:null,signature_presence:'absent',needs_review:true}));
 expect(await (await s.invoke({mode:'self_test',address:'ignored'})).json()).toMatchObject({status:'passed',provider:'openai',synthetic:true,production_records_written:false,usage:{requests:2}});
 expect(s.rpc).not.toHaveBeenCalled();expect(s.download).not.toHaveBeenCalled();
});
