import {createClient} from '@supabase/supabase-js';
import {corsHeaders} from '../_shared/cors.ts';
import {isCronRequest} from '../_shared/cron-auth.ts';
import {runSupplierPortalAdapter,type SupplierPortalJob} from './adapter.ts';

const headers={...corsHeaders,'Content-Type':'application/json'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers});

function allowedAdapters(){
  return new Set((Deno.env.get('DELIVERY_RECEIPT_PORTAL_ADAPTER_ALLOWLIST')??'').split(',').map(value=>value.trim()).filter(Boolean));
}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(request.method!=='POST')return json(405,{error:'method_not_allowed'});
  const url=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!serviceKey)return json(503,{error:'delivery_receipt_portal_worker_not_configured'});
  if(!await isCronRequest(request,url,serviceKey))return json(401,{error:'unauthorized'});
  if(Deno.env.get('DELIVERY_RECEIPT_PORTAL_WORKER_ENABLED')!=='true'){
    return json(503,{error:'delivery_receipt_portal_worker_disabled'});
  }
  let input:{job_id?:unknown;limit?:unknown}={};
  try{input=await request.json();}catch{return json(400,{error:'invalid_json'});}
  const jobId=input.job_id===undefined||input.job_id===null?null:String(input.job_id);
  const limit=input.limit===undefined?10:Number(input.limit);
  if(jobId!==null&&!uuid.test(jobId)||!Number.isInteger(limit)||limit<1||limit>25){
    return json(400,{error:'invalid_delivery_receipt_portal_request'});
  }
  const admin=createClient(url,serviceKey,{auth:{persistSession:false}});
  const claim=await admin.rpc('claim_delivery_receipt_channel_jobs_v1',{_limit:limit,_job_id:jobId});
  if(claim.error)return json(503,{error:'delivery_receipt_portal_claim_failed'});
  const jobs=Array.isArray(claim.data?.jobs)?claim.data.jobs as SupplierPortalJob[]:[];
  const allowlist=allowedAdapters();const results:Array<{job_id:string;status:'unavailable';error_code:string}>=[];
  for(const job of jobs){
    if(!uuid.test(job.job_id)||!uuid.test(job.tenant_id)||!uuid.test(job.lease_token)){
      console.error(JSON.stringify({event:'delivery_receipt_portal_claim_invalid',job_id:job.job_id??null}));
      continue;
    }
    const outcome=allowlist.has(job.adapter_key)
      ?await runSupplierPortalAdapter(job)
      :{status:'unavailable' as const,errorCode:'supplier_portal_adapter_not_allowlisted'};
    const failure=await admin.rpc('fail_delivery_receipt_channel_job_v1',{
      _tenant_id:job.tenant_id,_job_id:job.job_id,_lease_token:job.lease_token,
      _status:'unavailable',_error_code:outcome.errorCode,_retry_after_at:null,
    });
    if(failure.error){
      console.error(JSON.stringify({event:'delivery_receipt_portal_failure_not_persisted',job_id:job.job_id}));
      continue;
    }
    results.push({job_id:job.job_id,status:'unavailable',error_code:outcome.errorCode});
  }
  console.info(JSON.stringify({event:'delivery_receipt_portal_worker_completed',claimed:jobs.length,recorded:results.length}));
  return json(200,{claimed:jobs.length,results});
});
