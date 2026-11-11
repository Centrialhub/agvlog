// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {resolveDeliveryReceiptOcrAdapter} from '../../supabase/functions/process-delivery-receipt-ocr/adapter';
import {receiptOcrConfiguration} from '../../supabase/functions/process-delivery-receipt-ocr/configuration';
import {processReceiptOcr} from '../../supabase/functions/process-delivery-receipt-ocr/worker';
const reading={text:'Recebido em 09/11/2026',date_text:'09/11/2026',delivery_date:'2026-11-09',date_confidence:0.95,
 signature_presence:'present',signature_confidence:0.96,needs_review:false};
const bytes=new Uint8Array([0xff,0xd8,0xff,1,2,3]);
const payload=()=>({status:'completed',output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(reading)}]}],usage:{input_tokens:1500,output_tokens:100}});
const response=(value:unknown=payload(),status=200)=>new Response(JSON.stringify(value),{status});
function configured(request:typeof fetch){const a=resolveDeliveryReceiptOcrAdapter('openai','test-server-credential',undefined,request);if(!a.available)throw Error('fixture');return a;}
describe('OpenAI receipt adapter, isolated transport only',()=>{
 it('uses fixed Responses endpoint, strict output, private image bytes and bounded request',async()=>{
  const request=vi.fn<typeof fetch>().mockResolvedValue(response()),adapter=configured(request);
  expect(await adapter.read(bytes,'image/jpeg')).toMatchObject(reading);
  const [url,options]=request.mock.calls[0],body=JSON.parse(options!.body as string);
  expect(url).toBe('https://api.openai.com/v1/responses');expect(options!.redirect).toBe('error');
  expect(body).toMatchObject({model:'gpt-6-luna',store:false,stream:false,max_output_tokens:2500,reasoning:{effort:'none'},text:{format:{type:'json_schema',strict:true}}});
  expect(body.input[0].content[1]).toMatchObject({type:'input_image',detail:'high'});
  expect(body.input[0].content[1].image_url).toMatch(/^data:image\/jpeg;base64,/);
  expect(body).not.toHaveProperty('previous_response_id');expect(body).not.toHaveProperty('tools');
  expect(adapter.usage).toEqual({requests:1,input_tokens:1500,output_tokens:100});
 });
 it('selects only the selected server credential and does not claim anything without it',async()=>{
  const env=vi.fn((key:string)=>({DELIVERY_RECEIPT_OCR_ADAPTER:'openai',LOVABLE_API_KEY:'must-not-use'} as Record<string,string>)[key]);
  const request=vi.fn<typeof fetch>(),adapter=receiptOcrConfiguration(env,request),io={claim:vi.fn(),download:vi.fn(),complete:vi.fn()};
  expect(await processReceiptOcr(adapter,io,3)).toMatchObject({claimed:0,adapter_available:false});
  expect(env).not.toHaveBeenCalledWith('LOVABLE_API_KEY');expect(io.claim).not.toHaveBeenCalled();expect(request).not.toHaveBeenCalled();
 });
 it('rejects empty, oversized or unsupported media before transmission',async()=>{
  const request=vi.fn<typeof fetch>(),adapter=configured(request);
  for(const [image,mime] of [[new Uint8Array(),'image/jpeg'],[new Uint8Array(3*1024*1024+1),'image/png'],[bytes,'application/pdf']] as const)
   await expect(adapter.read(image,mime)).rejects.toThrow('ocr_image_unsupported');
  expect(request).not.toHaveBeenCalled();
 });
 it('contains refusals, partial output, malformed JSON and invented fields',async()=>{
  const incomplete={...payload(),status:'incomplete'};
  const refusal={...payload(),output:[{type:'message',role:'assistant',status:'completed',content:[{type:'refusal',refusal:'no'}]}]};
  const extra=payload();extra.output[0].content[0].text=JSON.stringify({...reading,action:'approve_delivery'});
  for(const value of [incomplete,refusal,extra,{}, {...payload(),output:[]}])
   await expect(configured(vi.fn<typeof fetch>().mockResolvedValue(response(value))).read(bytes,'image/jpeg')).rejects.toThrow('ocr_result_invalid');
  await expect(configured(vi.fn<typeof fetch>().mockResolvedValue(new Response('not json'))).read(bytes,'image/jpeg')).rejects.toThrow('ocr_result_invalid');
 });
 it('reports quota separately from rate limit and never echoes upstream secrets',async()=>{
  for(const [status,code,expected] of [[429,'insufficient_quota','ocr_provider_credits_exhausted'],[429,'rate_limit_exceeded','ocr_provider_rate_limited'],[401,'bad_key','ocr_provider_failed'],[503,'unavailable','ocr_provider_failed']] as const){
   const request=vi.fn<typeof fetch>().mockResolvedValue(response({error:{code,message:'private credential/image'}},status));
   await expect(configured(request).read(bytes,'image/jpeg')).rejects.toThrow(new Error(expected));expect(request).toHaveBeenCalledTimes(1);
  }
  await expect(configured(vi.fn<typeof fetch>().mockRejectedValue(new Error('private key in URL'))).read(bytes,'image/jpeg')).rejects.toThrow(new Error('ocr_provider_failed'));
 });
 it('times out once without retrying a paid request',async()=>{
  vi.useFakeTimers();try{
   const request=vi.fn<typeof fetch>().mockImplementation((_url,options)=>new Promise((_resolve,reject)=>options!.signal!.addEventListener('abort',()=>reject(new Error('private diagnostic')))));
   const assertion=expect(configured(request).read(bytes,'image/jpeg')).rejects.toThrow('ocr_provider_timeout');
   await vi.advanceTimersByTimeAsync(25000);await assertion;expect(request).toHaveBeenCalledTimes(1);
  }finally{vi.useRealTimers();}
 });
 it('keeps unknown dates/signatures for review and ignores invalid usage metrics',async()=>{
  const value=payload();value.output[0].content[0].text=JSON.stringify({...reading,date_text:'09/11',signature_presence:'uncertain',needs_review:false});
  value.usage.input_tokens=-1;const adapter=configured(vi.fn<typeof fetch>().mockResolvedValue(response(value)));
  expect(await adapter.read(bytes,'image/jpeg')).toMatchObject({delivery_date:null,signature_presence:'uncertain',needs_review:true});
  expect(adapter.usage).toEqual({requests:1,input_tokens:0,output_tokens:0});
 });
 it('uses the existing worker lease and image hash for OpenAI results',async()=>{
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const owned={status:'claimed',job_id:'job',tenant_id:'tenant',bucket:'receipts',path:'tenant/receipt.jpg',processed_hash:hash,lease_token:'lease'};
  const io={claim:vi.fn().mockResolvedValueOnce(owned).mockResolvedValue({status:'empty'}),download:vi.fn().mockResolvedValue(new Blob([bytes])),complete:vi.fn()};
  expect(await processReceiptOcr(configured(vi.fn<typeof fetch>().mockResolvedValue(response())),io,3)).toMatchObject({claimed:1,completed:1,failed:0});
  expect(io.complete).toHaveBeenCalledWith(owned,'completed',expect.objectContaining(reading),null);
 });
});
