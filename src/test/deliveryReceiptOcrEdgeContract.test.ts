// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import {resolveDeliveryReceiptOcrAdapter} from '../../supabase/functions/process-delivery-receipt-ocr/adapter';
import {processReceiptOcr,type OcrClaim} from '../../supabase/functions/process-delivery-receipt-ocr/worker';
import {parseReceiptRecognition,dateFromWrittenText} from '../../supabase/functions/process-delivery-receipt-ocr/recognition';
const result={text:'Recebido em 09/11/2026',date_text:'09/11/2026',delivery_date:'2026-11-09',date_confidence:0.95,
 signature_presence:'present',signature_confidence:0.96,needs_review:false};
const bytes=new Uint8Array([0xff,0xd8,0xff,1,2,3]);
const hash=async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const claim=async():Promise<OcrClaim>=>({status:'claimed',job_id:'job',tenant_id:'tenant',bucket:'receipts',path:'tenant/receipt.jpg',processed_hash:await hash(),lease_token:'lease'});
const response=()=>new Response(JSON.stringify({choices:[{message:{tool_calls:[{function:{name:'read_delivery_receipt',arguments:JSON.stringify(result)}}]}}]}));
describe('receipt reading with isolated image/provider transport',()=>{
 it('disabled, missing or unsupported provider never claims, downloads or transmits PII',async()=>{
  for(const adapter of [resolveDeliveryReceiptOcrAdapter(undefined),resolveDeliveryReceiptOcrAdapter('disabled'),resolveDeliveryReceiptOcrAdapter('lovable'),resolveDeliveryReceiptOcrAdapter('unrecognized','key')]){
   const io={claim:vi.fn(),download:vi.fn(),complete:vi.fn()};expect(await processReceiptOcr(adapter,io,3)).toMatchObject({adapter_available:false,claimed:0});
   expect(io.claim).not.toHaveBeenCalled();expect(io.download).not.toHaveBeenCalled();expect(io.complete).not.toHaveBeenCalled();
  }
 });
 it('uses the fixed existing gateway and forced tool without public image URLs',async()=>{
  const request=vi.fn<typeof fetch>().mockResolvedValue(response());const adapter=resolveDeliveryReceiptOcrAdapter('lovable','server-only-test',undefined,request);
  if(!adapter.available)throw new Error('fixture');expect(await adapter.read(bytes,'image/jpeg')).toMatchObject(result);
  expect(request.mock.calls[0][0]).toBe('https://ai.gateway.lovable.dev/v1/chat/completions');
  const body=JSON.parse(request.mock.calls[0][1]!.body as string);expect(body.messages[1].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
  expect(body.tool_choice.function.name).toBe('read_delivery_receipt');
 });
 it('downloads the claimed private image and completes the same lease/hash',async()=>{
  const owned=await claim(),request=vi.fn<typeof fetch>().mockResolvedValue(response());
  const io={claim:vi.fn().mockResolvedValueOnce(owned).mockResolvedValue({status:'empty'}),download:vi.fn().mockResolvedValue(new Blob([bytes])),complete:vi.fn().mockResolvedValue(undefined)};
  expect(await processReceiptOcr(resolveDeliveryReceiptOcrAdapter('lovable','test',undefined,request),io,3)).toMatchObject({claimed:1,completed:1,failed:0});
  expect(io.download).toHaveBeenCalledWith('receipts','tenant/receipt.jpg');expect(io.complete).toHaveBeenCalledWith(owned,'completed',expect.objectContaining(result),null);
 });
 it('hash mismatch never sends the image to the provider',async()=>{
  const owned={...await claim(),processed_hash:'a'.repeat(64)},request=vi.fn<typeof fetch>();
  const io={claim:vi.fn().mockResolvedValue(owned),download:vi.fn().mockResolvedValue(new Blob([bytes])),complete:vi.fn().mockResolvedValue(undefined)};
  await processReceiptOcr(resolveDeliveryReceiptOcrAdapter('lovable','test',undefined,request),io,1);
  expect(request).not.toHaveBeenCalled();expect(io.complete).toHaveBeenCalledWith(owned,'failed',null,'ocr_source_hash_mismatch');
 });
 it('path outside tenant is rejected before Storage access',async()=>{
  const io={claim:async()=>({...await claim(),path:'other/receipt.jpg'}),download:vi.fn(),complete:vi.fn()};
  await expect(processReceiptOcr(resolveDeliveryReceiptOcrAdapter('lovable','test'),io,1)).rejects.toThrow('ocr_claim_invalid');expect(io.download).not.toHaveBeenCalled();
 });
 it('reports credits, throttling and provider failures without inventing results',async()=>{
  for(const [status,code] of [[402,'ocr_provider_credits_exhausted'],[429,'ocr_provider_rate_limited'],[503,'ocr_provider_failed']] as const){
   const adapter=resolveDeliveryReceiptOcrAdapter('lovable','test',undefined,vi.fn<typeof fetch>().mockResolvedValue(new Response('private error',{status})));
   if(!adapter.available)throw new Error('fixture');await expect(adapter.read(bytes,'image/jpeg')).rejects.toThrow(code);
  }
  const adapter=resolveDeliveryReceiptOcrAdapter('lovable','test',undefined,vi.fn<typeof fetch>().mockResolvedValue(new Response('{}')));
  if(!adapter.available)throw new Error('fixture');await expect(adapter.read(bytes,'image/jpeg')).rejects.toThrow('ocr_result_invalid');
 });
 it('does not infer missing years, invalid days or contradict written evidence',()=>{
  expect(dateFromWrittenText('10/11')).toBeNull();expect(dateFromWrittenText('31/02/2026')).toBeNull();expect(dateFromWrittenText('9/11/26')).toBe('2026-11-09');
  expect(parseReceiptRecognition({...result,date_text:'10/11'},new Date('2026-11-10'))).toMatchObject({delivery_date:null,needs_review:true,date_confidence:0});
  expect(parseReceiptRecognition({...result,delivery_date:'2026-10-09'},new Date('2026-11-10'))).toMatchObject({delivery_date:null,needs_review:true});
 });
 it('future dates, weak reads and uncertain/absent signatures require review',()=>{
  for(const input of [{...result,signature_presence:'uncertain'},{...result,signature_presence:'absent'},{...result,date_confidence:0.6},{...result,signature_confidence:0.7}])
   expect(parseReceiptRecognition(input,new Date('2026-11-10')).needs_review).toBe(true);
  expect(parseReceiptRecognition(result,new Date('2026-01-01')).needs_review).toBe(true);
 });
 it('rejects extra instructions and malformed scores',()=>{
  expect(()=>parseReceiptRecognition({...result,action:'send documents'})).toThrow('ocr_result_invalid');
  expect(()=>parseReceiptRecognition({...result,signature_confidence:2})).toThrow('ocr_result_invalid');
 });
});
