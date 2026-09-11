import {createClient} from '@supabase/supabase-js';
import {corsHeaders} from '../_shared/cors.ts';
import {isCronRequest} from '../_shared/cron-auth.ts';
import {resolveDeliveryReceiptOcrAdapter} from './adapter.ts';

const headers={...corsHeaders,'Content-Type':'application/json'};
const json=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});
interface Claim{status:string;job_id?:string;processed_hash?:string;lease_token?:string}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(request.method!=='POST')return json(405,{error:'method_not_allowed'});
  const url=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!serviceKey)return json(503,{error:'ocr_worker_not_configured'});
  if(!await isCronRequest(request,url,serviceKey))return json(401,{error:'unauthorized'});
  let limit=10;try{const body=await request.json();if(body?.limit!==undefined){limit=Number(body.limit);
    if(!Number.isInteger(limit)||limit<1||limit>25)return json(400,{error:'invalid_limit'});}}catch{return json(400,{error:'invalid_json'});}
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const adapter=resolveDeliveryReceiptOcrAdapter(Deno.env.get('DELIVERY_RECEIPT_OCR_ADAPTER'));
  let claimed=0,unavailable=0;
  for(let index=0;index<limit;index++){
    const response=await admin.rpc('claim_delivery_receipt_ocr_v1');if(response.error)return json(503,{error:'ocr_claim_failed'});
    const claim=response.data as Claim;if(claim?.status==='empty')break;
    if(claim?.status!=='claimed'||!claim.job_id||!claim.processed_hash||!claim.lease_token)return json(503,{error:'ocr_claim_invalid'});
    claimed++;
    // Deliberately complete before reading Storage: an unavailable adapter must
    // never download or transmit the canhoto's image/PII.
    const completed=await admin.rpc('complete_delivery_receipt_ocr_v1',{_job_id:claim.job_id,_lease_token:claim.lease_token,
      _processed_hash:claim.processed_hash,_status:'unavailable',_confidence:null,_text:null,_error_code:adapter.errorCode});
    if(completed.error)return json(503,{error:'ocr_completion_failed'});unavailable++;
  }
  console.info(JSON.stringify({event:'delivery_receipt_ocr_worker_completed',claimed,unavailable,adapter_available:adapter.available}));
  return json(200,{status:'completed',claimed,unavailable,adapter_available:adapter.available});
});
