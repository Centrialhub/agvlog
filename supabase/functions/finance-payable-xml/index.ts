import {createClient} from '@supabase/supabase-js';
import {SaxesParser} from 'saxes';
import {withFiscalCors} from '../_shared/fiscal-cors.ts';
import {corsHeaders} from '../_shared/cors.ts';
import {requireActiveTenant} from '../_shared/active-tenant.ts';
import {readBoundedBody} from '../secure-upload/bounded-request.ts';
import {MAX_PAYABLE_XML_BYTES,type PayableXmlReader} from './xml.ts';
import {preservePayableXml} from './workflow.ts';
const reply=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(withFiscalCors(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(req.method!=='POST')return reply(405,{error:'method_not_allowed'});
 try{
  const auth=req.headers.get('authorization'),url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!auth)return reply(401,{error:'invalid_token'});if(!url||!anon||!key)return reply(503,{error:'payable_xml_unavailable'});
  const caller=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});const {data:{user},error}=await caller.auth.getUser();if(error||!user)return reply(401,{error:'invalid_token'});
  const body=await readBoundedBody(req,MAX_PAYABLE_XML_BYTES+64*1024),form=await new Response(Uint8Array.from(body).buffer,{headers:{'Content-Type':req.headers.get('content-type')||''}}).formData();const tenant=String(form.get('tenant_id')||''),request=String(form.get('request_id')||''),file=form.get('file');const mismatch=requireActiveTenant(req,tenant);if(mismatch)return mismatch;if(!(file instanceof File)||!file.size||file.size>MAX_PAYABLE_XML_BYTES)return reply(400,{error:'payable_xml_size_limit'});
  const access=await caller.rpc('get_finance_access',{_tenant_id:tenant});if(access.error||access.data!==true)return reply(403,{error:'finance_access_denied'});
  const service=createClient(url,key,{auth:{persistSession:false}}),bytes=new Uint8Array(await file.arrayBuffer());
  const result=await preservePayableXml({tenant,actor:user.id,request,bytes},{caller:(name,args)=>caller.rpc(name,args),service:(name,args)=>service.rpc(name,args),parser:()=>new SaxesParser({xmlns:true}) as unknown as PayableXmlReader,
   put:async(path,content,metadata)=>{const bucket=service.storage.from('payable-xml-quarantine');const uploaded=await bucket.upload(path,content,{contentType:'application/octet-stream',upsert:false,metadata});if(!uploaded.error)return;
    const existing=await bucket.download(path);if(existing.error||!existing.data)throw Error('payable_xml_storage_unavailable');const previous=new Uint8Array(await existing.data.arrayBuffer());if(previous.length!==content.length||previous.some((v,i)=>v!==content[i]))throw Error('payable_xml_storage_conflict');}
  });return reply(200,result);
 }catch(error){const code=error instanceof Error?error.message:typeof error==='object'&&error!==null&&'message' in error?String(error.message):'';return reply(400,{error:/^(payable_xml_|finance_access_denied)[a-z_]*$/.test(code)?code:'payable_xml_failed'});}
}));
