import {createClient} from '@supabase/supabase-js';
import {corsHeaders} from '../_shared/cors.ts';
import {isCronRequest} from '../_shared/cron-auth.ts';
import {resolveDeliveryReceiptOcrAdapter} from './adapter.ts';
import {processReceiptOcr,type OcrClaim} from './worker.ts';
import {syntheticReceiptImages} from './synthetic-fixtures.ts';

const headers={...corsHeaders,'Content-Type':'application/json'};
const json=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(request.method!=='POST')return json(405,{error:'method_not_allowed'});
  const url=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!serviceKey)return json(503,{error:'ocr_worker_not_configured'});
  if(!await isCronRequest(request,url,serviceKey))return json(401,{error:'unauthorized'});
  let limit=3,mode='process';try{const body=await request.json();if(body?.limit!==undefined){limit=Number(body.limit);
    if(!Number.isInteger(limit)||limit<1||limit>5)return json(400,{error:'invalid_limit'});}if(body?.mode!==undefined){
      if(!['process','health','self_test'].includes(body.mode))return json(400,{error:'invalid_mode'});mode=body.mode;}}catch{return json(400,{error:'invalid_json'});}
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const model=Deno.env.get('DELIVERY_RECEIPT_OCR_MODEL')||'google/gemini-3-flash-preview';
  const adapter=resolveDeliveryReceiptOcrAdapter(Deno.env.get('DELIVERY_RECEIPT_OCR_ADAPTER'),Deno.env.get('LOVABLE_API_KEY'),model);
  if(mode==='health')return json(200,adapter.available?{adapter_available:true,provider:adapter.provider,model:adapter.model}:{adapter_available:false,error:adapter.errorCode});
  if(mode==='self_test'){
    if(!adapter.available)return json(503,{error:adapter.errorCode});
    try{
      const results=[];for(const encoded of syntheticReceiptImages){const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
        results.push(await adapter.read(bytes,'image/png'));}
      const passed=results[0].delivery_date==='2026-11-09'&&results[0].signature_presence==='present'
        &&results[1].delivery_date===null&&results[1].signature_presence!=='present';
      return json(passed?200:422,{status:passed?'passed':'review_required',synthetic:true,production_records_written:false,
        results:results.map(r=>({delivery_date:r.delivery_date,signature_presence:r.signature_presence,needs_review:r.needs_review}))});
    }catch(error){const allowed=['ocr_provider_credits_exhausted','ocr_provider_rate_limited','ocr_provider_timeout','ocr_result_invalid'];
      return json(503,{error:error instanceof Error&&allowed.includes(error.message)?error.message:'ocr_self_test_failed',synthetic:true});}
  }
  try{
    const result=await processReceiptOcr(adapter,{
      claim:async()=>{const response=await admin.rpc('claim_delivery_receipt_ocr_v1');if(response.error)throw new Error('ocr_claim_failed');return response.data as OcrClaim;},
      download:async(bucket,path)=>{const {data,error}=await admin.storage.from(bucket).download(path);if(error||!data)throw new Error('ocr_download_failed');return data;},
      complete:async(claim,status,result,error)=>{const response=await admin.rpc('complete_delivery_receipt_ocr_v2',{
        _job_id:claim.job_id,_lease_token:claim.lease_token,_processed_hash:claim.processed_hash,_status:status,
        _result:result?{...result,provider:'lovable',model}:null,_error_code:error});
        if(response.error)throw new Error('ocr_completion_failed');},
    },limit);
    console.info(JSON.stringify({event:'delivery_receipt_ocr_worker_completed',...result}));
    return json(200,result);
  }catch{return json(503,{error:'ocr_worker_failed'});}
});
