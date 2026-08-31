import {Buffer} from 'node:buffer';
import {type Factor, type User} from '@supabase/supabase-js';
import {createAppClient} from '@/integrations/supabase/createAppClient';
import type {PGlite} from '@electric-sql/pglite';
import {adjustmentActor} from './settlementAdjustmentDatabase';
import {operationIds as i, operationRpc} from './operationOutcomeDatabase';

interface Claims {sub:string;aal:string;exp:number;nonce:number}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json','x-supabase-api-version':'2024-01-01'}});
let sequence=0;
// Real Supabase JS/Auth/PostgREST SDK, with an in-process, closed HTTP gateway.
// Auth is synthetic, not a GoTrue server; business readers and role checks are
// the repository's actual SQL executed as authenticated in rollback-only tests.
export function mfaSdkDatabaseGateway(db:PGlite){
 const tokens=new Map<string,Claims>(),factors=new Map<string,Factor[]>();
 const requests:Array<{path:string;method:string;actor?:string;aal?:string}>=[];
 const faults={denyUser:false,rejectPassword:false,invalidCode:false,passwordActor:i.user,beforeVerify:undefined as (()=>Promise<void>)|undefined};
 let transport:Promise<unknown>=Promise.resolve();
 const getUser=(actor:string):User=>({id:actor,aud:'authenticated',role:'authenticated',email:'qa@example.invalid',created_at:'2026-08-30T00:00:00Z',app_metadata:{},user_metadata:{aal:'aal2',role:'owner'},factors:factors.get(actor)??[]});
 const issue=(actor:string,aal:string)=>{
  const claims={sub:actor,aal,exp:Math.floor(Date.now()/1000)+3600,nonce:++sequence};
  const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const token=[encode({alg:'HS256',typ:'JWT'}),encode(claims),Buffer.from('synthetic-not-a-signature').toString('base64url')].join('.');tokens.set(token,claims);
  return {access_token:token,refresh_token:'synthetic-refresh',expires_in:3600,expires_at:claims.exp,token_type:'bearer' as const,user:getUser(actor)};
 };
 const fetcher:typeof fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.origin!=='https://mfa-qa.invalid')throw new Error('External network prohibited in MFA fixture');
  const path=url.pathname,method=init?.method??'GET';
  const token=new Headers(init?.headers).get('authorization')?.replace(/^Bearer /,'')??'',claims=tokens.get(token);
  requests.push({path,method,actor:claims?.sub,aal:claims?.aal});
  if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError');
  if(path==='/auth/v1/token'&&url.searchParams.get('grant_type')==='password')return faults.rejectPassword?json({code:'invalid_credentials',message:'Credenciais inválidas'},400):json(issue(faults.passwordActor,'aal1'));
  if(!claims||claims.exp*1000<=Date.now())return json({code:'bad_jwt',message:'Invalid synthetic token'},401);
  const body=init?.body?JSON.parse(String(init.body)) as Record<string,unknown>:{};
  if(path==='/auth/v1/user'&&method==='GET')return faults.denyUser?json({code:'bad_jwt',message:'User validation refused'},401):json(getUser(claims.sub));
  if(path==='/auth/v1/logout'&&method==='POST')return json({});
  if(path==='/auth/v1/factors'&&method==='POST'){
   if(body.factor_type!=='totp'||body.friendly_name!=='AGVLog')throw new Error('Unexpected factor enrollment');
   const current=factors.get(claims.sub)??[];
   if(current.some(f=>f.friendly_name===body.friendly_name))return json({code:'mfa_factor_name_conflict',message:'Conflict'},422);
   const factor={id:'95000000-0000-4000-8000-000000000001',factor_type:'totp',status:'unverified',friendly_name:'AGVLog',created_at:new Date().toISOString(),updated_at:new Date().toISOString()} as Factor;
   factors.set(claims.sub,[...current,factor]);
   return json({id:factor.id,type:'totp',totp:{qr_code:'<svg xmlns="http://www.w3.org/2000/svg"/>',secret:'SYNTHETIC_QA_SECRET',uri:'otpauth://totp/QA'}});
  }
  const factorPath=path.match(/^\/auth\/v1\/factors\/([^/]+)(?:\/(challenge|verify))?$/);
  if(factorPath){
   const target=(factors.get(claims.sub)??[]).find(f=>f.id===factorPath[1]);
   if(!target)return json({code:'mfa_factor_not_found',message:'No factor'},404);
   if(factorPath[2]==='challenge'&&method==='POST')return json({id:'challenge-qa',type:'totp',expires_at:claims.exp});
   if(factorPath[2]==='verify'&&method==='POST'){
    if(faults.invalidCode||body.code!=='123456'||body.challenge_id!=='challenge-qa')return json({code:'mfa_verification_failed',message:'Invalid code'},422);
    target.status='verified';const next=issue(claims.sub,'aal2');
    await faults.beforeVerify?.();
    return json(next);
   }
   if(!factorPath[2]&&method==='DELETE'){
    if(target.status==='verified')return json({code:'insufficient_aal',message:'Verified factor cannot be removed in this fixture'},403);
    factors.set(claims.sub,(factors.get(claims.sub)??[]).filter(f=>f.id!==target.id));return json({id:target.id});
   }
  }
  if(path.startsWith('/rest/v1/rpc/')&&method==='POST'){
   const request=transport.then(async()=>{
    if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError');
    try{
     await adjustmentActor(db,claims.sub,claims.aal,{user_metadata:{role:'owner',aal:'aal2'}});
     const name=path.split('/').pop();let data:unknown;
     if(name==='get_current_memberships_v1'||name==='get_user_portal_tenants')data=(await operationRpc(db,'select * from '+name+'()')).rows;
     else if(name==='list_driver_settlements'){
      const keys=['_tenant_id','_search','_driver_id','_vehicle_id','_status','_date_from','_date_to','_only_km_pending','_only_expense_pending','_only_no_freight','_only_needs_recalculation','_page','_page_size'];
      // Missing fields must retain SQL defaults, as PostgREST does.
      const supplied=keys.filter(key=>key in body);
      data=(await operationRpc(db,'select list_driver_settlements('+supplied.map((key,n)=>key+'=> $'+(n+1)).join(',')+') result',supplied.map(key=>body[key]))).rows[0].result;
     }else if(name==='list_driver_settlement_filter_options')data=(await operationRpc(db,'select list_driver_settlement_filter_options($1) result',[body._tenant_id])).rows[0].result;
     else throw new Error('Unexpected SQL endpoint '+name);
     return json(data);
    }catch(error){return json({code:'42501',message:error instanceof Error?error.message:'Database refused'},403);}
   });transport=request.catch(()=>undefined);return request;
  }
  throw new Error('Unexpected in-process request '+method+' '+path);
 };
 const stored=new Map<string,string>(),storage={getItem:(key:string)=>stored.get(key)??null,setItem:(key:string,value:string)=>{stored.set(key,value);},removeItem:(key:string)=>{stored.delete(key);}};
 const storageKey='mfa-qa-'+(++sequence);
 const newClient=()=>createAppClient('https://mfa-qa.invalid','synthetic-publishable-key',{storage,storageKey,fetch:fetcher,autoRefreshToken:false,detectSessionInUrl:false});
 const client=newClient();
 return {client,newClient,storageKey,stored,requests,faults,factors,drain:()=>transport,signIn:async(actor=i.operator,aal='aal1')=>{
  const session=issue(actor,aal);const result=await client.auth.setSession(session);if(result.error)throw result.error;return result;
 }};
}
