// @vitest-environment node
import {webcrypto} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {UNSCANNED_UPLOAD_PROVENANCE,hasReceiptScanProvenance} from '../../supabase/functions/secure-upload/scan-policy';
const tenant='10000000-0000-4000-8000-000000000001',actor='20000000-0000-4000-8000-000000000001';
let handler:(request:Request)=>Promise<Response>,role:string,quota:boolean,finance:boolean,storageCalls:number;
let metadata:Record<string,unknown>,settings:Record<string,string|undefined>,envReads:string[];
const transport=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
 const url=new URL(String(input));let body:unknown;
 if(url.hostname!=='fixture.invalid')throw Error('Unexpected external destination');
 if(url.pathname==='/auth/v1/user')body={id:actor};
 else if(url.pathname==='/rest/v1/tenant_memberships')body={role};
 else if(url.pathname.endsWith('/consume_secure_upload_quota_v1'))body=quota;
 else if(url.pathname.endsWith('/get_finance_access'))body=finance;
 else if(url.pathname.startsWith('/storage/v1/object/')){
  storageCalls++;const encoded=new Headers(init?.headers).get('x-metadata');
  if(!encoded)throw Error('Missing actual Storage metadata header');metadata=JSON.parse(Buffer.from(encoded,'base64').toString());
  expect(new Headers(init?.headers).get('x-upsert')).toBe('false');body={Key:'synthetic'};
 }else throw Error('Unexpected synthetic route '+url.pathname);
 return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
});
vi.mock('@supabase/supabase-js',async original=>{const sdk=await original<typeof import('@supabase/supabase-js')>();return {...sdk,createClient:(url:string,key:string,options:Parameters<typeof sdk.createClient>[2])=>sdk.createClient(url,key,{...options,auth:{...options?.auth,persistSession:false,autoRefreshToken:false},global:{...options?.global,fetch:transport}})};});
beforeAll(async()=>{
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',transport);
 vi.stubGlobal('Deno',{env:{get:(name:string)=>{envReads?.push(name);return ({SUPABASE_URL:'https://fixture.invalid',SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',...settings} as Record<string,string>)[name];}},serve:(fn:typeof handler)=>{handler=fn;}});
 const entrypoint='../../supabase/functions/secure-upload/index.ts';await import(entrypoint);
});
afterAll(()=>vi.unstubAllGlobals());
beforeEach(()=>{role='driver';quota=true;finance=false;storageCalls=0;metadata={};settings={};envReads=[];transport.mockClear();});
async function submit(bytes:Uint8Array=new Uint8Array([137,80,78,71,13,10,26,10,0]),changes:Record<string,string>={},headerTenant=tenant){
 const form=new FormData();for(const [k,v] of Object.entries({tenant_id:tenant,bucket:'receipts',folder:'deliveries/trip/stop/signatures',kind:'image',...changes}))form.set(k,v);
 form.set('file',new File([bytes as Uint8Array<ArrayBuffer>],'fixture.bin',{type:'application/octet-stream'}));
 const token='fixture.'+Buffer.from(JSON.stringify({active_tenant_id:tenant})).toString('base64url')+'.fixture';
 return handler(new Request('https://fixture.invalid/secure-upload',{method:'POST',headers:{Authorization:'Bearer '+token,'x-agvlog-tenant-id':headerTenant},body:form}));
}
describe('actual gateway under the explicitly approved no-scanner policy',()=>{
 it.each([{}, {MALWARE_SCANNER_URL:'https://scanner.invalid/scan',MALWARE_SCANNER_TOKEN:'synthetic'}, {MALWARE_SCANNER_URL:'http://unavailable.invalid'}])('uploads without contacting or requiring scanner configuration %j',async config=>{
  settings=config;const response=await submit();expect(response.status).toBe(201);expect(storageCalls).toBe(1);
  expect(metadata).toEqual(UNSCANNED_UPLOAD_PROVENANCE);expect(metadata.scanned).toBe(false);
  expect(envReads).not.toContain('MALWARE_SCANNER_URL');expect(envReads).not.toContain('MALWARE_SCANNER_TOKEN');
  expect(transport.mock.calls.every(([input])=>new URL(String(input)).hostname==='fixture.invalid')).toBe(true);
 });
 it('retains byte-format validation instead of trusting declared MIME',async()=>{
  expect((await submit(Buffer.from('%PDF-invalid-image'))).status).toBe(415);expect(storageCalls).toBe(0);
  expect((await submit(Buffer.from('%PDF-1.7\nsynthetic'),{kind:'proof'})).status).toBe(201);expect(metadata.scanned).toBe(false);
 });
 it('retains quota, membership and cross-company denials without storing',async()=>{
  quota=false;expect((await submit()).status).toBe(429);quota=true;role='client';expect((await submit()).status).toBe(403);
  role='driver';expect((await submit(undefined,{},'10000000-0000-4000-8000-000000000099')).status).toBe(409);expect(storageCalls).toBe(0);
 });
 it('does not grant the driver a generic financial upload',async()=>{
  expect((await submit(Buffer.from('%PDF-1.7'),{folder:'payable-payments',kind:'financial'})).status).toBe(403);expect(storageCalls).toBe(0);
 });
 it('preserves PDF and XML format choices for an authorized finance upload',async()=>{
  role='operator';finance=true;expect((await submit(Buffer.from('%PDF-1.7'),{folder:'payable-payments',kind:'financial'})).status).toBe(201);
  expect((await submit(Buffer.from('<?xml version="1.0"?><NFe/>'),{folder:'payable-payments',kind:'financial'})).status).toBe(201);
  expect(metadata).toEqual(UNSCANNED_UPLOAD_PROVENANCE);
 });
});
describe('positive legacy versus explicit no-analysis receipt provenance',()=>{
 it.each([{scanned:true},{...UNSCANNED_UPLOAD_PROVENANCE}])('accepts supported server metadata %j',value=>expect(hasReceiptScanProvenance(value)).toBe(true));
 it.each([{scanned:false},{scanned:null},{scanned:'false',scan_status:'not_performed',scan_policy:'patch2-no-scanner-v1'},
  {scanned:true,scan_status:'not_performed',scan_policy:'patch2-no-scanner-v1'}, {...UNSCANNED_UPLOAD_PROVENANCE,scan_policy:'client-forged'}, {...UNSCANNED_UPLOAD_PROVENANCE,scan_status:'clean'}])('rejects ambiguous or forged provenance %j',value=>expect(hasReceiptScanProvenance(value)).toBe(false));
});
