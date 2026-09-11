import {readBoundedBody} from '../secure-upload/bounded-request.ts';
import {createClient} from '@supabase/supabase-js';
import {SaxesParser} from 'saxes';
import {withFiscalCors} from '../_shared/fiscal-cors.ts';
import {corsHeaders} from '../_shared/cors.ts';
import {requireActiveTenant} from '../_shared/active-tenant.ts';
import {resolveHubFiscalToken} from '../_shared/fiscal-poll.ts';
import {fiscalHubBaseUrl} from '../_shared/fiscal-transport.ts';
import {downloadExistingXml,inspectExistingXml,type EmissionIdentity,type XmlReader} from './preview.ts';
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}});
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
Deno.serve(withFiscalCors(async req=>{
 if(req.method==='OPTIONS')return reply(200,{});if(req.method!=='POST')return reply(405,{error:'method_not_allowed'});
 try{
  const raw=await readBoundedBody(req,2048);const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if(!body||!uuid(body.tenant_id)||(uuid(body.emission_id)===uuid(body.observation_id))||(body.emission_id!==undefined&&!uuid(body.emission_id))||(body.observation_id!==undefined&&!uuid(body.observation_id))||Object.keys(body).some(k=>!['tenant_id','emission_id','observation_id'].includes(k)))return reply(400,{error:'invalid_request'});
  const authorization=req.headers.get('Authorization')||'';if(!authorization.startsWith('Bearer '))return reply(401,{error:'unauthorized'});
  const url=Deno.env.get('SUPABASE_URL')!,caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}});
  const identity=await caller.auth.getUser();if(identity.error||!identity.data.user)return reply(401,{error:'unauthorized'});
  const context=requireActiveTenant(req,body.tenant_id);if(context)return context;
  const allowed=async()=>{const r=await caller.rpc('get_finance_access',{_tenant_id:body.tenant_id});return !r.error&&r.data===true;};
  if(!await allowed())return reply(403,{error:'finance_access_denied'});
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  let emissionId=body.emission_id;
  if(body.observation_id){const o=await admin.from('finance_fiscal_observations').select('emission_id').eq('tenant_id',body.tenant_id).eq('id',body.observation_id).single();if(o.error||!o.data)return reply(404,{error:'fiscal_observation_not_found'});emissionId=o.data.emission_id;}
  const readEmission=()=>admin.from('hub_fiscal_emissions').select('id,tenant_id,doc_type,environment,status,dispatch_state,hub_document_id,access_key,emitter_cnpj,emitter_id,number,series,authorization_protocol').eq('tenant_id',body.tenant_id).eq('id',emissionId).single();
  const row=await readEmission();
  if(row.error||!row.data||!['cte','nfse'].includes(row.data.doc_type)||row.data.environment!=='production'||row.data.dispatch_state!=='recorded'||!row.data.hub_document_id)return reply(409,{error:'fiscal_existing_reference_unavailable'});
  const token=await resolveHubFiscalToken(admin,{tenantId:body.tenant_id,emitterId:row.data.emitter_id,environment:row.data.environment,scope:row.data.doc_type,encryptionKey:Deno.env.get('AGVLOG_ENCRYPTION_KEY')||'',getSecret:name=>Deno.env.get(name)});
  if(!token)return reply(409,{error:'fiscal_existing_reference_unavailable'});
  if(!await allowed())return reply(403,{error:'finance_access_denied'});
  const bytes=await downloadExistingXml(fiscalHubBaseUrl(Deno.env.get('HUB_FISCAL_BASE_URL')),token,row.data.hub_document_id);
  const result=await inspectExistingXml(bytes,row.data as EmissionIdentity,()=>new SaxesParser({xmlns:true}) as unknown as XmlReader);
  if(!await allowed())return reply(403,{error:'finance_access_denied'});
  const current=await readEmission();if(current.error||JSON.stringify(current.data)!==JSON.stringify(row.data))return reply(409,{error:'fiscal_evidence_source_changed'});
  return reply(200,{...result,observation_id:body.observation_id||null});
 }catch(error){const code=error instanceof Error&&/^fiscal_[a-z_]+$/.test(error.message)?error.message:'fiscal_evidence_preview_failed';return reply(422,{error:code});}
}));
