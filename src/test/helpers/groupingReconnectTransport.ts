import { createClient, type Session, type AuthChangeEvent } from '@supabase/supabase-js';

export const scope={actor:'20000000-0000-4000-8000-000000000001',otherActor:'20000000-0000-4000-8000-000000000002',
 tenant:'10000000-0000-4000-8000-000000000001',otherTenant:'10000000-0000-4000-8000-000000000002'};
export const vehicle={id:'30000000-0000-4000-8000-000000000001',plate:'AAA1A11',max_pallets:10,current_driver_id:'40000000-0000-4000-8000-000000000001'};
export const driver={id:vehicle.current_driver_id,name:'Synthetic Driver',user_id:scope.actor};
type Row=Record<string,unknown>;
type Gate={promise:Promise<void>;release:()=>void};
type AuthListener=(event:AuthChangeEvent,session:Session|null)=>void;
export function deferred():Gate {let release!:()=>void;return {promise:new Promise(resolve=>{release=resolve;}),release:()=>release()};}
export function session(actor=scope.actor,tenant=scope.tenant,revision=0):Session{
 const token=`fixture.${btoa(JSON.stringify({sub:actor,role:'authenticated',active_tenant_id:tenant,revision}))}.signature`;
 return {access_token:token,refresh_token:'synthetic-only',token_type:'bearer',expires_in:3600,
  user:{id:actor,aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-10-06T00:00:00Z'}};
}
export const transport={online:true,session:session(),activeTenant:scope.tenant,tokenRevision:0,
 listeners:new Set<AuthListener>(),memberGate:null as Gate|null,docsGate:null as Gate|null,
 memberError:false,uncertain:false,role:'owner',
 reads:[] as {path:string;actor:string|undefined;tenant:string|null;signal:AbortSignal|null}[],
 attempts:[] as Row[],delivered:[] as Row[],committed:new Set<string>(),gates:[] as Gate[],
 authSubscriptions:0,authUnsubscriptions:0};
export function hold(kind:'membership'|'documents'){
 const gate=deferred();transport.gates.push(gate);
 if(kind==='membership')transport.memberGate=gate;else transport.docsGate=gate;
 return gate;
}
export function release(kind:'membership'|'documents',gate:Gate){
 if(kind==='membership')transport.memberGate=null;else transport.docsGate=null;gate.release();
}
export function authEvent(event:AuthChangeEvent,next:Session|null){
 transport.session=next as Session; if(next)transport.activeTenant=JSON.parse(atob(next.access_token.split('.')[1])).active_tenant_id;
 for(const listener of transport.listeners)listener(event,next);
}
export function resetTransport(){
 transport.online=true;transport.session=session();transport.activeTenant=scope.tenant;transport.tokenRevision=0;
 transport.memberGate=null;transport.docsGate=null;transport.memberError=false;transport.uncertain=false;transport.role='owner';
 transport.reads=[];transport.attempts=[];transport.delivered=[];transport.committed.clear();transport.gates=[];
 transport.authSubscriptions=0;transport.authUnsubscriptions=0;
}
async function waitGate(gate:Gate|null,signal:AbortSignal|null){
 if(signal?.aborted)throw new DOMException('Synthetic request aborted','AbortError');
 if(!gate)return;
 await new Promise<void>((resolve,reject)=>{
  const abort=()=>{signal?.removeEventListener('abort',abort);reject(new DOMException('Synthetic request aborted','AbortError'));};
  signal?.addEventListener('abort',abort,{once:true});
  gate.promise.then(()=>{signal?.removeEventListener('abort',abort);resolve();},reject);
 });
}
const membershipRows=()=>[scope.tenant,scope.otherTenant].map((tenant,index)=>({tenant_id:tenant,role:transport.role,
 tenant_name:`Synthetic company ${index+1}`,plan_key:'pro',timezone:'America/Sao_Paulo'}));
const documentRows=(tenant:string)=>['Brasília','Pirapora'].map((city,index)=>({
 id:`50000000-0000-4000-8000-00000000000${index+1}`,tenant_id:tenant,
 invoice_number:`SYNTHETIC-${index+1}`,recipient:'Synthetic recipient',recipient_city:city,recipient_state:'MG',
 status:'confirmed',document_type:'inbound',load_id:null,deleted_at:null,pallet_count:1,weight_kg:10,value:100,
 created_at:'2026-10-06T01:00:00Z',current_delivery_attempt_id:null,cte_emitted_at:null,cte_emitted_outbound_id:null,nfse_emitted_at:null,
}));
async function fetchFixture(input:RequestInfo|URL,init?:RequestInit){
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.toString():input.url);
 const signal=init?.signal??(input instanceof Request?input.signal:null);
 const actor=transport.session?.user.id;
 const tenant=url.searchParams.get('tenant_id')?.replace(/^eq\./,'')??null;
 transport.reads.push({path:url.pathname,actor,tenant,signal});
 const payload=init?.body?JSON.parse(String(init.body)):{};
 if(url.pathname.endsWith('/rpc/create_grouped_load_v1'))transport.attempts.push(structuredClone(payload._payload));
 if(!transport.online)throw new TypeError('Synthetic network offline');
 if(url.pathname.endsWith('/rpc/get_current_memberships_v1')){
  await waitGate(transport.memberGate,signal);
  if(transport.memberError)return new Response(JSON.stringify({code:'42501',message:'synthetic_membership_revalidation_failed'}),{status:403});
  return new Response(JSON.stringify(membershipRows()),{status:200});
 }
 if(url.pathname.endsWith('/rpc/get_user_portal_tenants'))return new Response('[]',{status:200});
 if(url.pathname.endsWith('/rpc/set_active_tenant_context_v1')){
  transport.activeTenant=payload._tenant_id;return new Response(JSON.stringify({tenant_id:transport.activeTenant}),{status:200});
 }
 if(url.pathname.endsWith('/fiscal_documents')){
  await waitGate(transport.docsGate,signal);
  const fields=(url.searchParams.get('select')??'').split(',').filter(field=>/^[a-z_]+$/.test(field));
  const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??500);
  return new Response(JSON.stringify(documentRows(tenant??scope.tenant).slice(offset,offset+limit)
    .map(row=>Object.fromEntries(fields.map(field=>[field,(row as Row)[field]??null])))),{status:200});
 }
 if(url.pathname.endsWith('/rpc/create_grouped_load_v1')){
  const command=structuredClone(payload._payload) as Row;transport.delivered.push(command);
  const replayed=transport.committed.has(String(command.request_id));transport.committed.add(String(command.request_id));
  if(transport.uncertain)return new Response(JSON.stringify({ok:false}),{status:200});
  const ids=command.document_ids as string[];
  return new Response(JSON.stringify({ok:true,load_id:'60000000-0000-4000-8000-000000000001',
   load:{id:'60000000-0000-4000-8000-000000000001',load_number:'SYNTHETIC-1031'},request_id:command.request_id,
   tenant_id:command.tenant_id,document_count:ids.length,document_ids:ids,replayed}),{status:200});
 }
 throw new Error(`Unexpected synthetic Supabase transport: ${url.pathname}`);
}
export function fixtureSupabase(){
 const sdk=createClient('https://fixture.invalid','synthetic-public-key',{
  auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetchFixture},
 });
 // Only Auth transport lifecycle is synthetic. Providers, queries, SDK builders,
 // fetch pagination, React boundary, UI and load-creation/outbox stay real.
 return {from:sdk.from.bind(sdk),rpc:sdk.rpc.bind(sdk),removeAllChannels:async()=>[],auth:{
  onAuthStateChange:(listener:AuthListener)=>{transport.listeners.add(listener);transport.authSubscriptions++;
   return {data:{subscription:{unsubscribe:()=>{transport.listeners.delete(listener);transport.authUnsubscriptions++;}}}};},
  getSession:async()=>({data:{session:transport.session},error:null}),
  refreshSession:async()=>{const next=session(transport.session.user.id,transport.activeTenant,++transport.tokenRevision);
   authEvent('TOKEN_REFRESHED',next);return {data:{session:next},error:null};},
  signOut:async()=>{authEvent('SIGNED_OUT',null);return {error:null};},
 }};
}
