import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {buildSync} from 'esbuild';
import {chromium} from '@playwright/test';

// Browser-only storage/wire contract. No application server, Auth, DB, external
// requests or fiscal services. A brand new context owns all synthetic storage.
const root=process.cwd(),oldSha='aac2f89fac7f3180f80dcb69e66552427f6e87a1';
const git=args=>{
 const result=spawnSync('git',['-c','safe.directory='+root,...args],{cwd:root,encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);return result.stdout;
};
const legacy=git(['show',oldSha+':src/lib/loads/loadCreationOutbox.ts']);
const source=git(['rev-parse','HEAD']).trim(),tree=git(['rev-parse','HEAD^{tree}']).trim(),workingTreeClean=git(['status','--porcelain','--untracked-files=no']).trim()==='';
const bundle=(contents,name)=>buildSync({stdin:{contents,loader:'ts',resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',globalName:name}).outputFiles[0].text;
const currentBundle=bundle("export * from './src/lib/loads/loadCreationOutbox.ts'",'currentLoadOutbox');
const legacyBundle=bundle(legacy,'legacyLoadOutbox');
const html='<!doctype html><meta charset="utf-8"><title>Disposable outbox contract</title><script>'+currentBundle+'\n'+legacyBundle+'</script>';
const browser=await chromium.launch({headless:true}),context=await browser.newContext({offline:true});
const url='https://outbox-quota-fixture.invalid/';
await context.route('**/*',route=>route.request().url()===url?route.fulfill({status:200,contentType:'text/html',body:html}):route.abort());
const page=await context.newPage();
const digest=text=>createHash('sha256').update(text).digest('hex');
try{
 await page.goto(url);
 const first=await page.evaluate(async()=>{
  const invoices=Array.from({length:503},(_,n)=>'M3-20261005-'+String(n+1).padStart(12,'0')),joined=invoices.join(', ');
  const input={changes:{destination:'Jaíba - Espinosa',notes:'NF: '+joined},selected_document_ids:invoices.map((_,n)=>'note-'+n),
   audit_events:invoices.map((invoice_number,n)=>({fiscal_document_id:'note-'+n,previous_load_id:null,invoice_number,details:{source:'new_load_dialog',
    selected_document:{id:'note-'+n,invoice_number,recipient:'Cliente sintético',remitter:'Fornecedor',neighborhood:'Centro',city:'Jaíba',state:'MG'},
    auto_filled_fields:{invoice_number,client_name:'Cliente sintético',supplier:'Fornecedor',neighborhood:'Centro',destination:'Centro - Jaíba - MG'},
    final_fields:{invoice_number:joined,client_name:'Cliente sintético',supplier:'Fornecedor',neighborhood:'Centro',destination:'Jaíba - Espinosa'}}}))};
  const key='agvlog:load-creation:v1:tenant:actor:documents:manual',payload={...input,tenant_id:'tenant',request_id:'request-1'};
  const row={version:1,tenant:'tenant',actor:'actor',kind:'documents',scope:'manual',payload};
  let oldSends=0,newSends=0,oldError='',wire='';
  const deps={storage:localStorage,uuid:()=> 'request-1',assertContext:()=>{},lock:(name,work)=>navigator.locks.request(name,work)};
  try{await legacyLoadOutbox.createLoadCreationOutbox({...deps,send:async()=>{oldSends++;throw Error('must not send');}})('tenant','actor','documents','manual',input);}catch(error){oldError=error.name;}
  if(oldError!=='QuotaExceededError'||oldSends!==0||localStorage.getItem(key)!==null)throw Error('Legacy must reproduce real quota before RPC');
  try{await currentLoadOutbox.createLoadCreationOutbox({...deps,send:async(_kind,value)=>{newSends++;wire=JSON.stringify(value);throw Error('lost response');}})('tenant','actor','documents','manual',input);}catch(error){if(!error.message.includes('sem confirmação'))throw error;}
  const stored=localStorage.getItem(key),decoded=currentLoadOutbox.readPendingLoadCreations(localStorage,'tenant','actor','documents')[0];
  if(!stored||newSends!==1||JSON.stringify(decoded)!==JSON.stringify(row)||wire!==JSON.stringify(payload))throw Error('Full durable command and audit must equal original wire');
  return {legacyCharacters:JSON.stringify(row).length,legacyUtf8Bytes:new TextEncoder().encode(JSON.stringify(row)).length,legacyError:oldError,oldSends,newSends,storedCharacters:stored.length,storedUtf8Bytes:new TextEncoder().encode(stored).length,storedVersion:JSON.parse(stored).version,selected:decoded.payload.selected_document_ids.length,auditEvents:decoded.payload.audit_events.length,wire};
 });
 assert.equal(first.selected,503);assert.equal(first.auditEvents,503);assert.equal(first.storedVersion,2);assert.ok(first.storedCharacters<500_000);
 const originalWireSha256=digest(first.wire);delete first.wire;
 await page.reload();
 const recovered=await page.evaluate(async()=>{
  const key='agvlog:load-creation:v1:tenant:actor:documents:manual',stored=localStorage.getItem(key);
  let oldSends=0,uuids=0,newSends=0,oldBlocked=false,wire='';
  const deps={storage:localStorage,uuid:()=>{uuids++;throw Error('must retain request');},assertContext:()=>{},lock:(name,work)=>navigator.locks.request(name,work)};
  const {tenant_id:_tenant,request_id:_request,...originalInput}=currentLoadOutbox.readPendingLoadCreations(localStorage,'tenant','actor','documents')[0].payload;
  try{await legacyLoadOutbox.createLoadCreationOutbox({...deps,send:async()=>{oldSends++;throw Error('old send forbidden');}})('tenant','actor','documents','manual',originalInput);}catch{oldBlocked=true;}
  if(!oldBlocked||oldSends!==0||uuids!==0||localStorage.getItem(key)!==stored)throw Error('Rollback reader must fail closed without deleting or duplicating');
  const result=await currentLoadOutbox.createLoadCreationOutbox({...deps,send:async(_kind,payload)=>{
   newSends++;wire=JSON.stringify(payload);return {data:{ok:true,load_id:'load-1',load:{id:'load-1',load_number:'M3'},tenant_id:payload.tenant_id,request_id:payload.request_id,document_count:payload.selected_document_ids.length,document_ids:payload.selected_document_ids,replayed:true},error:null};
  }})('tenant','actor','documents','manual');
  if(newSends!==1||uuids!==0||localStorage.getItem(key)!==null||result.document_count!==503)throw Error('Recovery must confirm original503 command once');
  return {oldBlocked,oldSends,uuids,newSends,documentCount:result.document_count,requestId:result.request_id,pendingAfterConfirmation:localStorage.getItem(key),wire};
 });
 assert.equal(digest(recovered.wire),originalWireSha256);delete recovered.wire;
 const full=await page.evaluate(async()=>{
  let fillers=0;
  for(;fillers<32;fillers++){try{localStorage.setItem('unrelated-'+fillers,'x'.repeat(512*1024));}catch(error){if(error.name!=='QuotaExceededError')throw error;break;}}
  if(fillers===32)throw Error('Browser quota was not reached');
  const before=localStorage.length,input={changes:{notes:'long'.repeat(150_000)},selected_document_ids:['note-1']};let sends=0,errorName='';
  const deps={storage:localStorage,uuid:()=> 'request-2',assertContext:()=>{},lock:(name,work)=>navigator.locks.request(name,work),send:async()=>{sends++;throw Error('must not send');}};
  try{await currentLoadOutbox.createLoadCreationOutbox(deps)('tenant','actor','documents','manual',input);}catch(error){errorName=error.name;}
  if(errorName!=='QuotaExceededError'||sends!==0||localStorage.length!==before)throw Error('Full storage must reject before RPC and retain unrelated values');
  return {fillers,quotaError:errorName,sends,unrelatedKeysPreserved:localStorage.length===before};
 });
 const out=resolve('node_modules/.cache/qa-load-creation-browser');mkdirSync(out,{recursive:true});
 const record={at:new Date().toISOString(),source,tree,workingTreeClean,sourceFilesSha256:Object.fromEntries(['src/lib/loads/loadCreationOutbox.ts','src/lib/loads/loadCreationStorageCodec.ts','scripts/test-load-creation-outbox-browser.mjs'].map(file=>[file,digest(readFileSync(resolve(root,file)))])),browser:browser.version(),status:workingTreeClean?'passed-browser-only':'passed-browser-only-draft',scope:'Real Chromium localStorage and Web Locks, lossless wire equality and reload/replay with synthetic RPC response; NOT native Auth/PostgREST/DB/M3 acceptance',originalWireSha256,first,recovered,full,externalRequestsAllowed:false};
 writeFileSync(resolve(out,'evidence.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
}finally{await context.close();await browser.close();}
