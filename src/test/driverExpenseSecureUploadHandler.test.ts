// @vitest-environment node
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {webcrypto} from 'node:crypto';
import {UNSCANNED_UPLOAD_PROVENANCE} from '../../supabase/functions/secure-upload/scan-policy';
const tenant='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000001',requestId='30000000-0000-4000-8000-000000000001',trip='40000000-0000-4000-8000-000000000001';
const bytes=Buffer.from('%PDF-1.4\nfixture-own-expense');
let handler:(req:Request)=>Promise<Response>,uploaded:boolean,authorized:boolean,revokedAfterScan:boolean,scan:boolean;
let calls:{path:string;method:string;body:Record<string,unknown>}[];
const fetchFixture=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
 const url=new URL(String(input));let result:unknown={};let status=200;
 if(url.hostname==='scanner.invalid'){scan=true;return new Response(JSON.stringify({clean:true}));}
 const body=init?.body&&typeof init.body==='string'?JSON.parse(init.body):{};const method=init?.method??'GET';calls.push({path:url.pathname,method,body});
 if(url.pathname==='/auth/v1/user')result={id:actor};
 else if(url.pathname==='/rest/v1/tenant_memberships')result={role:'driver'};
 else if(url.pathname.endsWith('/get_finance_access'))result=false;
 else if(url.pathname.endsWith('/consume_secure_upload_quota_v1'))result=true;
 else if(url.pathname.endsWith('/inspect_expense_receipt_upload')){
  if(!authorized||(revokedAfterScan&&calls.filter(c=>c.path.endsWith('/inspect_expense_receipt_upload')).length>1)){status=403;result={code:'42501',message:'expense_receipt_not_authorized'};}
  else {const receipt=body._receipt as Record<string,unknown>;result={version:1,tenant_id:tenant,actor_id:actor,request_id:requestId,source_type:'trip',source_id:trip,path:`${tenant}/expense-receipts/${actor}/${requestId}/receipt.pdf`,uploaded,receipt,metadata:{version:1,tenant_id:tenant,actor_id:actor,request_id:requestId,source_type:'trip',source_id:trip,...receipt,...UNSCANNED_UPLOAD_PROVENANCE}};}
 }else if(url.pathname.startsWith('/storage/v1/object/receipts/')){uploaded=true;result={Key:'fixture'};}
 else throw new Error('Unexpected fixture request '+url.pathname);
 return new Response(JSON.stringify(result),{status,headers:{'Content-Type':'application/json'}});
});
vi.mock('@supabase/supabase-js',async original=>{const module=await original<typeof import('@supabase/supabase-js')>();return {...module,createClient:(url:string,key:string,options:Parameters<typeof createClient>[2])=>module.createClient(url,key,{...options,auth:{...options?.auth,persistSession:false,autoRefreshToken:false},global:{...options?.global,fetch:fetchFixture}})};});
beforeAll(async()=>{
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',fetchFixture);vi.stubGlobal('Deno',{env:{get:(name:string)=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',MALWARE_SCANNER_URL:'https://scanner.invalid',MALWARE_SCANNER_TOKEN:'synthetic-scanner-token'} as Record<string,string>)[name]},serve:(fn:typeof handler)=>{handler=fn;}});
 // Load the actual Deno entrypoint through Vitest's runtime module loader.
 // Its Deno/npm runtime types belong to Edge validation, not tsconfig.app.
 const entrypoint='../../supabase/functions/secure-upload/index.ts';await import(entrypoint);
});
afterAll(()=>vi.unstubAllGlobals());beforeEach(()=>{calls=[];uploaded=false;authorized=true;revokedAfterScan=false;scan=false;fetchFixture.mockClear();});
async function upload(changes:Record<string,string>={}){
 const form=new FormData();for(const [k,v] of Object.entries({tenant_id:tenant,bucket:'receipts',folder:'expense-receipts',kind:'proof',action:'expense_receipt',request_id:requestId,source_type:'trip',source_id:trip,sha256:Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex'),...changes}))form.set(k,v);
 form.set('file',new File([bytes],'fixture.pdf',{type:'application/pdf'}));const token='fixture.'+Buffer.from(JSON.stringify({active_tenant_id:tenant})).toString('base64url')+'.fixture';
 return handler(new Request('https://fixture.invalid/secure-upload',{method:'POST',headers:{Authorization:'Bearer '+token,'x-agvlog-tenant-id':tenant},body:form}));
}
describe('full secure-upload handler for the driver own expense path',()=>{
 it('allows an own-trip receipt without granting general finance access',async()=>{
  const result=await upload();expect(result.status).toBe(200);expect(await result.json()).toMatchObject({actor_id:actor,source_id:trip,uploaded:true});
  expect(calls.filter(c=>c.path.endsWith('/inspect_expense_receipt_upload'))).toHaveLength(3);expect(scan).toBe(false);expect(uploaded).toBe(true);expect(calls.some(c=>c.path.endsWith('/get_finance_access'))).toBe(false);
 });
 it('still rejects another driver source before scan or storage',async()=>{authorized=false;expect((await upload()).status).toBe(403);expect(scan).toBe(false);expect(uploaded).toBe(false);});
 it('rechecks revoked permission between caller inspections and stores no object',async()=>{revokedAfterScan=true;expect((await upload()).status).toBe(403);expect(scan).toBe(false);expect(uploaded).toBe(false);});
 it('still denies a generic financial receipt to the driver',async()=>{expect((await upload({folder:'payable-payments',action:'upload'})).status).toBe(403);expect(calls.some(c=>c.path.endsWith('/get_finance_access'))).toBe(true);expect(scan).toBe(false);expect(uploaded).toBe(false);});
 it.each<Record<string,string>>([{action:'upload'},{folder:'payable-payments'},{kind:'financial'}])('cannot disguise a generic upload as a canonical expense receipt %j',async changes=>{expect((await upload(changes)).status).toBe(400);expect(scan).toBe(false);expect(uploaded).toBe(false);});
});
