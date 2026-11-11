import type {OcrAdapterAvailability} from './adapter.ts';
import type {ReceiptRecognition} from './recognition.ts';
export interface OcrClaim{status:string;job_id?:string;tenant_id?:string;receipt_id?:string;bucket?:string;path?:string;processed_hash?:string;lease_token?:string}
export interface OcrWorkerIo {
 claim():Promise<OcrClaim>;
 download(bucket:string,path:string):Promise<Blob>;
 complete(claim:OcrClaim,status:'completed'|'failed',result:ReceiptRecognition|null,error:string|null):Promise<void>;
}
export async function processReceiptOcr(adapter:OcrAdapterAvailability,io:OcrWorkerIo,limit:number){
 if(!adapter.available)return {status:'unavailable',adapter_available:false,error:adapter.errorCode,claimed:0,completed:0,failed:0};
 let claimed=0,completed=0,failed=0;
 for(let i=0;i<limit;i++){
  const claim=await io.claim();if(claim.status==='empty')break;
  if(claim.status!=='claimed'||!claim.job_id||!claim.lease_token||!claim.tenant_id||!claim.processed_hash
   ||claim.bucket!=='receipts'||!claim.path?.startsWith(claim.tenant_id+'/')||claim.path.includes('..')||claim.path.includes('\\'))throw new Error('ocr_claim_invalid');
  claimed++;
  let result:ReceiptRecognition;
  try{
   const blob=await io.download(claim.bucket,claim.path);
   if(blob.size>3*1024*1024||!blob.size)throw new Error('ocr_image_unsupported');
   const bytes=new Uint8Array(await blob.arrayBuffer());
   const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
   if(hash!==claim.processed_hash)throw new Error('ocr_source_hash_mismatch');
   const mime=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff?'image/jpeg':
    bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47?'image/png':
    new TextDecoder().decode(bytes.subarray(0,4))==='RIFF'&&new TextDecoder().decode(bytes.subarray(8,12))==='WEBP'?'image/webp':null;
   if(!mime)throw new Error('ocr_image_unsupported');
   result=await adapter.read(bytes,mime);
  }catch(error){
   const allowed=['ocr_image_unsupported','ocr_source_hash_mismatch','ocr_provider_credits_exhausted','ocr_provider_rate_limited','ocr_provider_failed','ocr_provider_timeout','ocr_result_invalid'];
   const code=error instanceof Error&&allowed.includes(error.message)?error.message:'ocr_processing_failed';
   await io.complete(claim,'failed',null,code);failed++;continue;
  }
  await io.complete(claim,'completed',result,null);completed++;
 }
 return {status:'completed',adapter_available:true,claimed,completed,failed};
}
