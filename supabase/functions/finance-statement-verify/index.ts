import { withFiscalCors } from '../_shared/fiscal-cors.ts';
import {createClient} from '@supabase/supabase-js';
import {corsHeaders} from '../_shared/cors.ts';
import {readStatementWorkbook} from './workbook.ts';
import {verifyStatementSource,type StatementSourceContext} from './worker.ts';
import {requireActiveTenant} from '../_shared/active-tenant.ts';
const headers={...corsHeaders,'Content-Type':'application/json'};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
const uuid=(value:unknown)=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
Deno.serve(withFiscalCors(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(req.method!=='POST')return reply(405,{error:'method_not_allowed'});
  const authorization=req.headers.get('Authorization');if(!authorization?.startsWith('Bearer '))return reply(401,{error:'unauthorized'});
  try{
    const text=await req.text();if(text.length>4096)return reply(413,{error:'request_too_large'});
    const body=JSON.parse(text);
    if(!body||typeof body!=='object'||!uuid(body.tenant_id)||!uuid(body.import_id)||!uuid(body.request_id)
      ||Object.keys(body).some(key=>!['tenant_id','import_id','request_id'].includes(key)))return reply(400,{error:'finance_invalid_request'});
    const caller=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{
      global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false},
    });
    const identity=await caller.auth.getUser();if(identity.error||!identity.data.user)return reply(401,{error:'unauthorized'});
    const tenantContextError=requireActiveTenant(req,body.tenant_id);if(tenantContextError)return tenantContextError;
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
    const result=await verifyStatementSource({tenant:body.tenant_id,importId:body.import_id,request:body.request_id,actor:identity.data.user.id},{
      inspect:async()=>{const response=await caller.rpc('inspect_finance_statement_source',{_tenant_id:body.tenant_id,_import_id:body.import_id});
        if(response.error||!response.data)throw new Error('finance_statement_access_denied');return response.data as StatementSourceContext;},
      download:async path=>{const response=await caller.storage.from('finance-statements').download(path);
        if(response.error||!response.data)throw new Error('finance_statement_source_unavailable');return new Uint8Array(await response.data.arrayBuffer());},
      downloadArtifact:async path=>{const response=await caller.storage.from('upload-validated').download(path);
        if(response.error||!response.data)throw new Error('finance_statement_source_unavailable');return new Uint8Array(await response.data.arrayBuffer());},
      workbook:async(bytes,sheet)=>readStatementWorkbook(bytes,sheet),
      authorize:async()=>{const response=await caller.rpc('get_finance_access',{_tenant_id:body.tenant_id});return !response.error&&response.data===true;},
      record:async payload=>{
        if(payload.reader_version==='statement-artifact-v2'){
          const permit=await caller.rpc('authorize_finance_statement_artifact_verification',{_tenant_id:body.tenant_id,_import_id:body.import_id});
          if(permit.error||!permit.data||!uuid(permit.data.authorization_id))throw new Error('finance_statement_access_denied');
          const response=await admin.rpc('record_finance_statement_artifact_verification',{_payload:payload,_authorization_id:permit.data.authorization_id});
          if(response.error)throw new Error('finance_statement_verification_unconfirmed');return response.data;
        }
        const response=await admin.rpc('record_finance_statement_verification',{_payload:payload});
        if(response.error)throw new Error('finance_statement_verification_unconfirmed');return response.data;},
    });
    return reply(200,result);
  }catch(error){const name=error instanceof Error?error.message:'';return reply(name.includes('access_denied')?403:503,{error:'finance_statement_verification_unconfirmed'});}
}));
