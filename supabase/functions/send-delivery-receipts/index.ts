import {createClient} from '@supabase/supabase-js';
import {corsHeaders} from '../_shared/cors.ts';
import {requireActiveTenant} from '../_shared/active-tenant.ts';
import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';

const jsonHeaders={...corsHeaders,'Content-Type':'application/json'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ATTACHMENTS=5;
const MAX_RECIPIENTS=10;
const MAX_ATTACHMENT_BYTES=5*1024*1024;
const MAX_TOTAL_PROVIDER_BYTES=25*1024*1024;
const PROVIDER_TIMEOUT_MS=30_000;
const response=(status:number,body:Record<string,unknown>,headers:Record<string,string>={})=>
  new Response(JSON.stringify(body),{status,headers:{...jsonHeaders,...headers}});
const base64=(bytes:Uint8Array)=>{let value='';for(let offset=0;offset<bytes.length;offset+=0x8000){
  value+=String.fromCharCode(...bytes.subarray(offset,Math.min(offset+0x8000,bytes.length)));}return btoa(value);};

interface CoverSnapshot{config?:{enabled?:boolean;title?:string;subtitle?:string|null;footer?:string|null;fields?:string[]};supplier_name?:string;
  delivered_at?:string;destination?:string|null;driver_name?:string|null;vehicle_plate?:string|null;receiver_name?:string|null;
  documents?:Array<{kind?:string;number?:string|null}>}
interface ClaimedItem{receipt_id:string;path:string;file_name:string;documents:Array<{kind?:string;number?:string|null}>;cover?:CoverSnapshot}
interface ClaimedBatch{tenant_id:string;actor_id:string;batch_id:string;supplier_name?:string;recipients?:string[];subject?:string;body_text?:string;
  status:string;provider_message_id:string|null;lease_token:string|null;retry_after_at:string|null;items:ClaimedItem[]}

class SendError extends Error{
  constructor(message:string,readonly httpStatus=503,readonly retryAfterAt:string|null=null){super(message);}
}

function providerRetryAfter(value:string|null){
  const fallbackSeconds=5;
  if(!value)return {seconds:fallbackSeconds,at:new Date(Date.now()+fallbackSeconds*1000).toISOString()};
  const numeric=Number(value);
  const seconds=Number.isFinite(numeric)?Math.ceil(numeric):Math.ceil((Date.parse(value)-Date.now())/1000);
  const bounded=Math.min(3600,Math.max(1,Number.isFinite(seconds)?seconds:fallbackSeconds));
  return {seconds:bounded,at:new Date(Date.now()+bounded*1000).toISOString()};
}

const coverFields=new Set(['delivery_date','destination','driver','vehicle','receiver','documents']);
const safeText=(value:unknown,max:number)=>typeof value==='string'?[...value].map(character=>{
  const code=character.charCodeAt(0);return code<=31||code===127?' ':character;
}).join('').trim().slice(0,max):'';
function wrapped(value:string,width=78){const words=value.split(/\s+/);const lines:string[]=[];let line='';for(const word of words){
  if((line+' '+word).trim().length>width){if(line)lines.push(line);line=word;}else line=(line+' '+word).trim();}if(line)lines.push(line);return lines;}
async function addCover(bytes:Uint8Array,snapshot:CoverSnapshot|undefined){
  const config=snapshot?.config;if(!config?.enabled)return bytes;
  const fields=Array.isArray(config.fields)?config.fields.filter(field=>coverFields.has(field)):[];
  const title=safeText(config.title,120);if(title.length<3||fields.length<1||new Set(fields).size!==fields.length)throw new SendError('invalid_cover_snapshot',409);
  const source=await PDFDocument.load(bytes,{ignoreEncryption:false});const output=await PDFDocument.create();const regular=await output.embedFont(StandardFonts.Helvetica);
  const bold=await output.embedFont(StandardFonts.HelveticaBold);const page=output.addPage([595.28,841.89]);let y=770;
  page.drawText(title,{x:54,y,size:22,font:bold,color:rgb(.08,.18,.3)});y-=32;
  const subtitle=safeText(config.subtitle,240);if(subtitle){for(const line of wrapped(subtitle)){page.drawText(line,{x:54,y,size:11,font:regular});y-=15;}y-=10;}
  page.drawText(`Fornecedor: ${safeText(snapshot?.supplier_name,200)||'Nao identificado'}`,{x:54,y,size:12,font:bold});y-=28;
  const entries:Array<[string,string,string]>=[['delivery_date','Entrega',safeText(snapshot?.delivered_at,40)],['destination','Destino',safeText(snapshot?.destination,300)],
    ['driver','Motorista',safeText(snapshot?.driver_name,160)],['vehicle','Veiculo',safeText(snapshot?.vehicle_plate,20)],['receiver','Recebedor',safeText(snapshot?.receiver_name,160)]];
  for(const [field,label,value] of entries)if(fields.includes(field)&&value){page.drawText(`${label}:`,{x:54,y,size:10,font:bold});
    for(const line of wrapped(value,72)){page.drawText(line,{x:132,y,size:10,font:regular});y-=14;}y-=5;}
  if(fields.includes('documents')){page.drawText('Documentos:',{x:54,y,size:10,font:bold});y-=18;for(const document of snapshot?.documents??[]){
    const line=`- ${safeText(document.kind,30).toUpperCase()||'DOCUMENTO'} ${safeText(document.number,100)||'sem numero'}`;
    page.drawText(line,{x:68,y,size:9,font:regular});y-=13;if(y<90)break;}}
  const footer=safeText(config.footer,500);if(footer){let footerY=54;for(const line of wrapped(footer,90).slice(0,4)){page.drawText(line,{x:54,y:footerY,size:8,font:regular,color:rgb(.35,.35,.35)});footerY+=11;}}
  const pages=await output.copyPages(source,source.getPageIndices());pages.forEach(item=>output.addPage(item));return output.save({useObjectStreams:true});
}

Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(request.method!=='POST')return response(405,{error:'method_not_allowed'});
  const authorization=request.headers.get('authorization');if(!authorization)return response(401,{error:'missing_authorization'});
  const supabaseUrl=Deno.env.get('SUPABASE_URL'),anonKey=Deno.env.get('SUPABASE_ANON_KEY'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendKey=Deno.env.get('RESEND_API_KEY'),sender=Deno.env.get('DELIVERY_RECEIPT_EMAIL_FROM');
  if(!supabaseUrl||!anonKey||!serviceKey||!resendKey||!sender)return response(503,{error:'delivery_email_not_configured'});
  let input:{tenant_id?:unknown;batch_id?:unknown};try{input=await request.json();}catch{return response(400,{error:'invalid_json'});}
  const tenantId=String(input.tenant_id??''),batchId=String(input.batch_id??'');
  if(!uuid.test(tenantId)||!uuid.test(batchId))return response(400,{error:'invalid_delivery_email_request'});
  const tenantError=requireActiveTenant(request,tenantId);if(tenantError)return tenantError;
  const caller=createClient(supabaseUrl,anonKey,{global:{headers:{Authorization:authorization}}});
  const {data:{user},error:userError}=await caller.auth.getUser();if(userError||!user)return response(401,{error:'invalid_token'});
  const claim=await caller.rpc('claim_delivery_receipt_email_v1',{_tenant_id:tenantId,_batch_id:batchId});
  if(claim.error||!claim.data)return response(403,{error:'delivery_email_claim_denied'});
  const batch=claim.data as ClaimedBatch;
  if(batch.tenant_id!==tenantId||batch.actor_id!==user.id||batch.batch_id!==batchId||!Array.isArray(batch.items)){
    return response(409,{error:'delivery_email_claim_invalid'});
  }
  if(['sent','delivered','bounced'].includes(batch.status)&&batch.provider_message_id){
    return response(200,{batch_id:batchId,status:'sent',provider_message_id:batch.provider_message_id,replayed:true});
  }
  if(batch.status==='busy')return response(409,{error:'delivery_email_busy',retry_after_at:batch.retry_after_at});
  if(batch.status==='rate_limited')return response(429,{error:'provider_rate_limited',retry_after_at:batch.retry_after_at});
  if(batch.status!=='sending'||!batch.lease_token||!uuid.test(batch.lease_token)
    ||batch.items.length<1||batch.items.length>MAX_ATTACHMENTS||!Array.isArray(batch.recipients)
    ||batch.recipients.length<1||batch.recipients.length>MAX_RECIPIENTS||!batch.subject||!batch.body_text){
    return response(409,{error:'delivery_email_claim_invalid'});
  }

  const leaseToken=batch.lease_token;
  console.info(JSON.stringify({event:'delivery_receipt_email_send_started',tenant_id:tenantId,batch_id:batchId,
    attachment_count:batch.items.length}));
  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}});
  try{
    const attachments:Array<{filename:string;content:string}>=[];let totalProviderBytes=0;const documentLines:string[]=[];
    for(const item of batch.items){
      if(!uuid.test(item.receipt_id)||typeof item.path!=='string'||!item.path.startsWith(`${tenantId}/delivery-pdfs/`)
        ||typeof item.file_name!=='string'||item.file_name.length>180||!item.file_name.toLowerCase().endsWith('.pdf')){
        throw new SendError('invalid_item',409);
      }
      const download=await admin.storage.from('receipts').download(item.path);
      if(download.error||!download.data)throw new SendError('pdf_unavailable');
      const sourceBytes=new Uint8Array(await download.data.arrayBuffer());const bytes=await addCover(sourceBytes,item.cover);
      if(bytes.length>MAX_ATTACHMENT_BYTES)throw new SendError('attachment_too_large',413);
      const content=base64(bytes);totalProviderBytes+=content.length;
      if(totalProviderBytes>MAX_TOTAL_PROVIDER_BYTES)throw new SendError('attachments_too_large',413);
      attachments.push({filename:item.file_name,content});
      const docs=(item.documents??[]).map(doc=>`${String(doc.kind??'documento').toUpperCase()} ${doc.number??'sem número'}`).join(', ');
      documentLines.push(`- ${item.file_name}: ${docs}`);
    }

    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),PROVIDER_TIMEOUT_MS);
    let sent:Response;
    try{
      sent=await fetch('https://api.resend.com/emails',{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${resendKey}`,
        'Content-Type':'application/json','Idempotency-Key':`delivery-receipts-${batchId}`},body:JSON.stringify({from:sender,to:batch.recipients,
        subject:batch.subject,text:`${batch.body_text}\n\nDocumentos enviados:\n${documentLines.join('\n')}`,attachments,
        tags:[{name:'category',value:'delivery_receipts'},{name:'batch_id',value:batchId}]})});
    }catch(cause){
      if(cause instanceof DOMException&&cause.name==='AbortError')throw new SendError('provider_timeout');
      throw new SendError('provider_unavailable');
    }finally{clearTimeout(timeout);}
    const payload=await sent.json().catch(()=>({})) as {id?:unknown;message?:unknown};
    if(sent.status===429){const retry=providerRetryAfter(sent.headers.get('retry-after'));
      throw new SendError('provider_rate_limited',429,retry.at);}
    if(!sent.ok||typeof payload.id!=='string')throw new SendError(`provider_${sent.status}`);
    const completion=await caller.rpc('complete_delivery_receipt_email_v1',{_tenant_id:tenantId,_batch_id:batchId,
      _lease_token:leaseToken,_provider_message_id:payload.id});
    if(completion.error)return response(503,{error:'delivery_email_completion_unconfirmed',provider_message_id:payload.id});
    console.info(JSON.stringify({event:'delivery_receipt_email_send_confirmed',tenant_id:tenantId,batch_id:batchId}));
    return response(200,{batch_id:batchId,status:'sent',provider_message_id:payload.id,replayed:false});
  }catch(cause){
    const failure=cause instanceof SendError?cause:new SendError('delivery_email_failed');
    console.error(JSON.stringify({event:'delivery_receipt_email_send_failed',tenant_id:tenantId,batch_id:batchId,
      code:failure.message,retry_after_at:failure.retryAfterAt}));
    await caller.rpc('fail_delivery_receipt_email_v1',{_tenant_id:tenantId,_batch_id:batchId,_lease_token:leaseToken,
      _error_code:failure.message,_retry_after_at:failure.retryAfterAt});
    const retry=failure.retryAfterAt?providerRetryAfter(failure.retryAfterAt):null;
    return response(failure.httpStatus,{error:failure.message,retry_after_at:failure.retryAfterAt},
      retry?{'Retry-After':String(retry.seconds)}:{});
  }
});
