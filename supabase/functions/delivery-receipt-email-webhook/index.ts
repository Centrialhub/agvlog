import {createClient} from '@supabase/supabase-js';

const json=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const encoder=new TextEncoder();

function decodeSecret(value:string){
  const encoded=value.startsWith('whsec_')?value.slice(6):value;
  try{return Uint8Array.from(atob(encoded),character=>character.charCodeAt(0));}catch{return null;}
}

function equal(left:Uint8Array,right:Uint8Array){
  if(left.length!==right.length)return false;let difference=0;
  for(let index=0;index<left.length;index+=1)difference|=left[index]^right[index];
  return difference===0;
}

async function verify(request:Request,payload:string,secret:string){
  const id=request.headers.get('svix-id'),timestamp=request.headers.get('svix-timestamp'),signature=request.headers.get('svix-signature');
  if(!id||!timestamp||!signature)return false;
  const seconds=Number(timestamp);if(!Number.isFinite(seconds)||Math.abs(Date.now()/1000-seconds)>300)return false;
  const keyBytes=decodeSecret(secret);if(!keyBytes)return false;
  const key=await crypto.subtle.importKey('raw',keyBytes,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const expected=new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(`${id}.${timestamp}.${payload}`)));
  return signature.split(' ').some(candidate=>{
    const [version,value]=candidate.split(',');if(version!=='v1'||!value)return false;
    try{return equal(expected,Uint8Array.from(atob(value),character=>character.charCodeAt(0)));}catch{return false;}
  });
}

Deno.serve(async request=>{
  if(request.method!=='POST')return json(405,{error:'method_not_allowed'});
  const secret=Deno.env.get('RESEND_WEBHOOK_SECRET'),url=Deno.env.get('SUPABASE_URL'),serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!secret||!url||!serviceKey)return json(503,{error:'delivery_email_webhook_not_configured'});
  const raw=await request.text();if(!await verify(request,raw,secret))return json(401,{error:'invalid_webhook_signature'});
  const svixId=request.headers.get('svix-id');if(!svixId||svixId.length>200)return json(400,{error:'invalid_webhook_id'});
  let event:{type?:unknown;created_at?:unknown;data?:{email_id?:unknown}};try{event=JSON.parse(raw);}catch{return json(400,{error:'invalid_json'});}
  const status=event.type==='email.delivered'?'delivered':
    event.type==='email.bounced'||event.type==='email.suppressed'?'bounced':event.type==='email.failed'?'failed':null;
  if(!status)return json(200,{accepted:true,ignored:true});
  const messageId=event.data?.email_id;if(typeof messageId!=='string'||messageId.length<5)return json(400,{error:'missing_email_id'});
  const occurredAt=typeof event.created_at==='string'&&!Number.isNaN(Date.parse(event.created_at))?event.created_at:new Date().toISOString();
  const admin=createClient(url,serviceKey,{auth:{persistSession:false}});
  const applied=await admin.rpc('apply_delivery_receipt_email_webhook_v1',{_svix_id:svixId,
    _provider_message_id:messageId,_status:status,_occurred_at:occurredAt});
  if(applied.error)return json(503,{error:'delivery_email_webhook_not_applied'});
  const result=applied.data as {matched?:unknown}|null;
  if(!result||result.matched!==true)return json(503,{error:'delivery_email_batch_not_ready'});
  console.info(JSON.stringify({event:'delivery_receipt_email_webhook_applied',svix_id:svixId,
    provider_message_id:messageId,status,result}));
  return json(200,{accepted:true,result:applied.data});
});
