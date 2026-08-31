// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fiscalHubBaseUrl, inspectFiscalTransport, requireFiscalTransport, lookupFiscalOperation } from '../../supabase/functions/_shared/fiscal-transport';
const state=vi.hoisted(()=>({handler:null as null|((req:Request)=>Promise<Response>),role:'operator',writes:0,claims:0}));
vi.mock('../../supabase/functions/_shared/capabilities.ts',()=>({requireIntegrationCapability:vi.fn().mockResolvedValue(null)}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({
  auth:{getUser:async()=>({data:{user:{id:'user'}},error:null})},
  rpc:async(name:string,args:Record<string,unknown>)=>{if(name==='verify_agvlog_cron_secret')return{data:args.p_secret==='verified-cron-secret-for-test-only',error:null};state.claims++;throw Error('Unexpected mutation RPC');},
  from:(table:string)=>{
    const filters:[string,unknown][]=[];let single=false;
    const q={select:()=>q,eq:(key:string,value:unknown)=>{filters.push([key,value]);return q;},in:()=>q,order:()=>q,limit:()=>q,
      maybeSingle:()=>{single=true;return q;},single:()=>{single=true;return q;},
      update:()=>{state.writes++;throw Error('Unexpected write');},insert:()=>{state.writes++;throw Error('Unexpected write');},
      then:(resolve:(v:unknown)=>unknown)=>{
        const rows:Record<string,unknown>[]=table==='fiscal_documents'?[{id:'document',tenant_id:'tenant'}]:table==='tenant_emitters'?[{id:'emitter',tenant_id:'tenant',active:true,cnpj:'12345678000199'}]:table==='tenant_memberships'?[{tenant_id:'tenant',user_id:'user',active:true,role:state.role}]:table==='hub_fiscal_emissions'?[{id:'operation',tenant_id:'tenant',fiscal_document_id:'document',emitter_id:'emitter',environment:'production',dispatch_state:'uncertain',hub_document_id:null}]:[{tenant_id:'tenant',emitter_id:'emitter',doc_scope:'all',environment:'production',enabled:true,secret_name:'PROD_TOKEN',secret_ciphertext:null}];
        const found=rows.filter(row=>filters.every(([k,v])=>row[k]===v));return Promise.resolve({data:single?found[0]||null:found,error:null}).then(resolve);
      }};return q;
  },
})}));
let poll:(req:Request)=>Promise<Response>;let proxy:(req:Request)=>Promise<Response>;
const fetcher=vi.fn();
const request=(body:Record<string,unknown>,headers:Record<string,string>={Authorization:'Bearer test-user'})=>new Request('https://edge.test',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
beforeAll(async()=>{
  const env:Record<string,string>={SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',PROD_TOKEN:'test-only-token',HUB_FISCAL_BASE_URL:'http://invalid.test'};
  vi.stubGlobal('Deno',{env:{get:(key:string)=>env[key]},serve:(h:typeof state.handler)=>{state.handler=h;}});
  const pollPath='../../supabase/functions/cte-status-poll/index.ts';await import(pollPath);poll=state.handler!;
  const proxyPath='../../supabase/functions/hub-fiscal-proxy/index.ts';await import(proxyPath);proxy=state.handler!;
});
beforeEach(()=>{state.role='operator';state.writes=0;state.claims=0;fetcher.mockReset();vi.stubGlobal('fetch',fetcher);});
afterAll(()=>vi.unstubAllGlobals());
describe('fiscal transport preflight',()=>{
  it.each(['','http://hub.test','not-a-url','https://user:secret@hub.test','https://hub.test?token=secret','https://hub.test/#fragment'])('blocks unsafe or missing base %s',base=>{expect(()=>requireFiscalTransport(base,'token')).toThrow();});
  it('accepts HTTPS paths and rejects invalid token headers without exposing the token',()=>{
    expect(requireFiscalTransport('https://hub.test/functions/v1/','token')).toBe('https://hub.test/functions/v1');
    expect(()=>requireFiscalTransport('https://hub.test','secret\r\nInjected: yes')).toThrow('caracteres inválidos');
    expect(inspectFiscalTransport('https://hub.test','secret\nvalue').credentialHeaderValid).toBe(false);
  });
  it('returns a clear configuration error BEFORE creating an emission intent',async()=>{
    const response=await proxy(request({action:'emit',type:'cte',emitterId:'emitter',body:{environment:'production',emitterCnpj:'12345678000199',externalId:'stable',payload:{}}}));
    expect(response.status).toBe(400);expect((await response.json()).error.code).toBe('HUB_BASE_URL_INVALID');
    expect(state.claims).toBe(0);expect(state.writes).toBe(0);expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('read-only diagnostics with existing authorization',()=>{
  it.each<Record<string,string>>([{Authorization:'Bearer test-user'},{'x-agvlog-cron-secret':'verified-cron-secret-for-test-only'}])('allows an existing authorized user or verified cron without writes',async headers=>{
    const response=await poll(request({action:'diagnose',document_id:'document'},headers));
    expect(response.status).toBe(200);const body=await response.json();expect(body).toMatchObject({emissionId:'operation',dispatchState:'uncertain',hasProviderReference:false,transport:{baseConfigured:true,baseValid:false,credentialReadable:true,credentialHeaderValid:true}});
    expect(JSON.stringify(body)).not.toContain('test-only-token');expect(state.claims).toBe(0);expect(state.writes).toBe(0);expect(fetcher).not.toHaveBeenCalled();
  });
  it.each<Record<string,string>>([{}, {'x-agvlog-cron-secret':'wrong-secret'}])('rejects anonymous or unverified cron diagnostics',async headers=>{
    expect((await poll(request({action:'diagnose',document_id:'document'},headers))).status).toBe(401);expect(state.writes).toBe(0);
  });
  it('rejects a viewer and a tenant mismatch',async()=>{
    state.role='viewer';expect((await poll(request({action:'diagnose',document_id:'document'}))).status).toBe(403);
    expect((await poll(request({action:'diagnose',document_id:'document',tenant_id:'other'}))).status).toBe(400);
    expect(state.writes).toBe(0);expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('read-only Hub operation lookup',()=>{
  it('uses the operator-supplied default while preserving an explicit server override',()=>{
    expect(fiscalHubBaseUrl(undefined)).toBe('https://rvgcsmuyvesusbxsqevr.supabase.co/functions/v1');
    expect(fiscalHubBaseUrl('https://override.test/api/')).toBe('https://override.test/api');
  });
  it('only GETs the persisted reference and returns no unrelated document or secret',async()=>{
    fetcher.mockResolvedValue(new Response(JSON.stringify({success:true,documents:[{id:'ours',idIntegracao:'agvlog-operation',status:'processing',environment:'production',customer:{secret:'hidden'}},{id:'unrelated',idIntegracao:'other'}]})));
    const result=await lookupFiscalOperation('https://hub.test','test-token','agvlog-operation','production');
    expect(fetcher).toHaveBeenCalledOnce();const [url,init]=fetcher.mock.calls[0];expect(init.method).toBe('GET');expect(url.searchParams.get('idIntegracao')).toBe('agvlog-operation');expect(url.searchParams.get('environment')).toBe('production');expect(url.searchParams.get('type')).toBe('cte');
    expect(result.recordsReturned).toBe(2);expect(result.matches).toHaveLength(1);expect(result.matches[0].id).toBe('ours');expect(JSON.stringify(result)).not.toMatch(/test-token|customer|hidden|unrelated/);
  });
  it('reports authentication rejection without exposing provider messages or retrying',async()=>{
    fetcher.mockResolvedValue(new Response(JSON.stringify({success:false,error:{code:'UNAUTHORIZED',message:'Bearer test-token'}}),{status:401}));
    const result=await lookupFiscalOperation('https://hub.test','test-token','agvlog-operation','production');
    expect(result).toMatchObject({httpStatus:401,errorCode:'UNAUTHORIZED',matches:[]});expect(JSON.stringify(result)).not.toContain('test-token');expect(fetcher).toHaveBeenCalledOnce();
  });
});
