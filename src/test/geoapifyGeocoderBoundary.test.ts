// @vitest-environment node
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {beforeEach,it,expect,vi} from 'vitest';
vi.mock('../../supabase/functions/_shared/cors.ts',()=>({corsHeaders:{}}));
import {requireActiveTenant} from '../../supabase/functions/_shared/active-tenant';
import {assessNominatimCandidate} from '../../supabase/functions/_shared/geocoding-quality';
import {candidatesFromCache,GEOCODING_PROVIDER_LIMIT} from '../../supabase/functions/_shared/geocoding-cache';
import {GeoapifyError,queryGeoapify} from '../../supabase/functions/geocode-address/geoapify';
const tenant='10000000-0000-4000-8000-000000000001';
const address='Rua Exemplo, 10, Cidade, MG, Brasil';
const source=readFileSync('supabase/functions/geocode-address/index.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}})
 .outputText.replace(/^import .*;\r?\n/gm,'').replace(/^export \{\};?\r?\n?/gm,'');
const m={authenticated:true,role:'operator',key:'synthetic-server-key' as string|undefined,allowed:true,cached:null as unknown,
 request:vi.fn<typeof fetch>(),rpc:vi.fn(),writes:vi.fn(),filters:vi.fn()};
const makeHandler=()=>{
 let handler!: (r:Request)=>Promise<Response>;
 const admin={auth:{getUser:async()=>({data:{user:m.authenticated?{id:'actor'}:null},error:null})},
  rpc:async(name:string,args:unknown)=>{m.rpc(name,args);return {data:{allowed:m.allowed,retry_after_ms:1000},error:null};},
  from:(table:string)=>{const q={select:()=>q,eq:(name:string,value:unknown)=>{m.filters(table,name,value);return q;},gt:()=>q,
   maybeSingle:async()=>({data:table==='tenant_memberships'?{role:m.role}:m.cached,error:null}),
   update:(values:unknown)=>{m.writes(table,values);return q;},upsert:async(values:unknown)=>{m.writes(table,values);return {error:null};},
   then:(resolve:(r:unknown)=>unknown)=>Promise.resolve({error:null}).then(resolve)};return q;}};
 const env:Record<string,string|undefined>={SUPABASE_URL:'https://db.example.test',SUPABASE_ANON_KEY:'synthetic-anon',
  SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',GEOCODING_PROVIDER:'geoapify',GEOAPIFY_API_KEY:m.key};
 vm.runInNewContext(js,{createClient:()=>admin,corsHeaders:{},requireActiveTenant,
  isCronRequest:async(r:Request)=>r.headers.get('x-agvlog-cron-secret')==='synthetic-cron',
  queryGeoapify:(a:string,k:string|undefined,n:number)=>queryGeoapify(a,k,n,m.request),GeoapifyError,
  assessNominatimCandidate,candidatesFromCache,GEOCODING_PROVIDER_LIMIT,
  Deno:{env:{get:(key:string)=>env[key]},serve:(fn:typeof handler)=>{handler=fn;}},
  Response,Request,URL,crypto,TextEncoder,AbortController,DOMException,setTimeout,clearTimeout,console:{error:()=>{}}});
 return handler;
};
const invoke=(body:Record<string,unknown>={},options:{cron?:boolean;auth?:boolean;headerTenant?:string}={})=>{
 const headers=new Headers({'Content-Type':'application/json'});
 if(options.cron)headers.set('x-agvlog-cron-secret','synthetic-cron');
 else if(options.auth!==false){headers.set('Authorization','Bearer fixture.'+btoa(JSON.stringify({active_tenant_id:tenant}))+'.fixture');
  headers.set('x-agvlog-tenant-id',options.headerTenant??tenant);}
 return makeHandler()(new Request('https://db.example.test/functions/v1/geocode-address',{method:'POST',headers,
  body:JSON.stringify({tenant_id:tenant,address,...body})}));
};
beforeEach(()=>{vi.clearAllMocks();m.authenticated=true;m.role='operator';m.key='synthetic-server-key';m.allowed=true;m.cached=null;
 m.request.mockResolvedValue(new Response(JSON.stringify({results:[{country_code:'br',lat:-16,lon:-44,formatted:address,
  result_type:'building',street:'Rua Exemplo',housenumber:'10',rank:{confidence:1}}]})));
});
it('normal operator requests retain session, tenant, membership and quota boundaries',async()=>{
 expect((await invoke({}, {auth:false})).status).toBe(401);
 m.authenticated=false;expect((await invoke()).status).toBe(401);m.authenticated=true;
 expect((await invoke({}, {headerTenant:'other'})).status).toBe(409);
 m.role='driver';expect((await invoke()).status).toBe(403);m.role='operator';
 m.allowed=false;expect((await invoke()).status).toBe(429);expect(m.request).not.toHaveBeenCalled();
});
it('queries Geoapify once and caches only normalized candidates in the tenant/provider namespace',async()=>{
 const response=await invoke();expect(response.status).toBe(200);
 const data=await response.json();expect(data).toMatchObject({provider:'geoapify',cache:'miss',candidates:[{provider:'geoapify',quality:'address_exact'}]});
 expect(JSON.stringify(data)).not.toContain(m.key);expect(m.request).toHaveBeenCalledOnce();
 expect(m.rpc).toHaveBeenCalledWith('consume_geocoding_quota_v1',{_tenant_id:tenant,_provider:'geoapify'});
 expect(m.writes).toHaveBeenCalledWith('address_geocoding_cache',expect.objectContaining({tenant_id:tenant,provider:'geoapify',normalized_address:address}));
});
it('reuses provider-scoped cached coordinates without consuming another provider credit',async()=>{
 m.cached={id:'cached',hit_count:1,candidates:[{label:address,latitude:-16,longitude:-44,provider:'geoapify'}]};
 expect((await (await invoke()).json()).cache).toBe('hit');expect(m.request).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();
 expect(m.filters).toHaveBeenCalledWith('address_geocoding_cache','provider','geoapify');
});
it('fails closed without credentials and returns sanitized provider errors without writes',async()=>{
 m.key=undefined;expect((await invoke()).status).toBe(503);expect(m.request).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();
 m.key='synthetic-server-key';m.request.mockRejectedValueOnce(new Error('private url apiKey='+m.key));
 const response=await invoke();expect(response.status).toBe(502);expect(await response.json()).toEqual({error:'geocoding_provider_unavailable'});
 expect(m.writes).not.toHaveBeenCalled();
});
it('private self-test cannot be invoked by anonymous or operator callers',async()=>{
 expect((await invoke({mode:'geoapify_self_test'}, {auth:false})).status).toBe(401);
 expect((await invoke({mode:'geoapify_self_test'})).status).toBe(403);expect(m.request).not.toHaveBeenCalled();
});
it('cron-authenticated self-test uses a fixed public place and creates no operational/cache records',async()=>{
 const response=await invoke({mode:'geoapify_self_test',address:'DO NOT TRANSMIT THIS PRIVATE BODY'}, {cron:true});
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({status:'passed',production_records_written:false,candidate_count:1});
 expect(new URL(String(m.request.mock.calls[0][0])).searchParams.get('text')).toBe('Praça da Sé, São Paulo, SP, Brasil');
 expect(m.rpc).not.toHaveBeenCalled();expect(m.writes).not.toHaveBeenCalled();
});
