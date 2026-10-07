import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium} from '@playwright/test';

// Disposable Chromium storage/UI contract. Auth/context/remote ACKs are synthetic;
// the actual form, QueryClient mutation, receipt validation, Web Locks and IDB run.
// No app server, GoTrue, PostgREST, shared database or external requests are used.
const root=process.cwd(),expectPaused=process.argv.includes('--expect-paused');
const git=args=>{const r=spawnSync('git',['--no-optional-locks','-c','safe.directory='+root,...args],{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
const source=git(['rev-parse','HEAD']),tree=git(['rev-parse','HEAD^{tree}']),workingTreeClean=git(['status','--porcelain','--untracked-files=no'])==='';
const harness=String.raw`
import React from 'react';import {createRoot} from 'react-dom/client';
import {QueryClientProvider,onlineManager} from '@tanstack/react-query';
import {queryClient as client} from './src/app/queryClient';
import {DriverExpenseForm} from './src/components/driver/DriverExpenseForm';
import {DriverExpenseSyncAgent} from './src/components/driver/DriverExpenseSyncAgent';
import {driverExpenseOfflineStore as store} from './src/lib/driver/driverExpenseOfflineStore';
import {receiptPath} from './src/lib/financial/expenseCreationCommands';
const tenant='a8100000-0000-4000-8000-000000000001',actor='a8100000-0000-4000-8000-000000000002',trip='a8100000-0000-4000-8000-000000000003';
const state={tenant,actor,statusCalls:0,uploads:[],commands:[],saved:[],lost:false,hold:false,held:null};window.a8State=state;
const uploaded=new Set(),context={version:1,tenant_id:tenant,actor_id:actor,source_type:'trip',source_id:trip,driver_id:actor,driver_name:'Synthetic driver',trip_id:trip,settlement_id:null,manual_settlement_id:null,can_create:true,source_state:'in_transit',revision:'a'.repeat(32)};
const ack=p=>({version:1,tenant_id:tenant,actor_id:actor,request_id:p.request_id,source_type:'trip',source_id:trip,path:receiptPath(p),uploaded:uploaded.has(p.request_id),receipt:p.receipt});
window.a8Rpc=async(name,args)=>{
 if(name==='get_expense_creation_context'){if(!navigator.onLine)throw new TypeError('Failed to fetch');return {data:context,error:null};}
 if(name==='get_expense_receipt_status'){state.statusCalls++;return {data:ack({tenant_id:args._tenant_id,actor_id:actor,request_id:args._request_id,source_type:args._source_type,source_id:args._source_id,receipt:args._receipt}),error:null};}
 if(name!=='create_driver_expense_command')throw Error('Unexpected synthetic RPC '+name);
 const p=args._payload;state.commands.push(structuredClone(p));
 const response={data:{version:1,tenant_id:tenant,actor_id:actor,request_id:p.request_id,source_type:'trip',source_id:trip,expense_id:'a8100000-0000-4000-8000-000000000004',command_id:'a8100000-0000-4000-8000-000000000005',driver_id:actor,status:'pending',confirmed:true,receipt_path:receiptPath(p)},error:null};
 if(state.lost)return {data:null,error:new TypeError('Synthetic response lost')};if(state.hold)return new Promise(resolve=>{state.held=()=>resolve(response);});return response;
};
window.a8Invoke=async(name,{body})=>{
 if(name!=='secure-upload'||!navigator.onLine)throw Error('Unexpected/offline synthetic upload');
 const file=body.get('file'),request=body.get('request_id');uploaded.add(request);
 const receipt={sha256:body.get('sha256'),mime:file.type,size:file.size};state.uploads.push({requestId:request,bytes:file.size,sha256:receipt.sha256});
 return {data:ack({tenant_id:tenant,actor_id:actor,request_id:request,source_type:'trip',source_id:trip,receipt}),error:null};
};
const app=createRoot(document.getElementById('app'));
const render=()=>app.render(<QueryClientProvider client={client}><DriverExpenseForm sourceId={trip} onSaved={message=>state.saved.push(message)}/><DriverExpenseSyncAgent/></QueryClientProvider>);
window.a8Fixture={state,seed:()=>store.saveContext(tenant,actor,context),mount:()=>{onlineManager.setOnline(navigator.onLine);render();},drafts:()=>store.list(tenant,actor),otherScope:()=>store.list(tenant,'a8100000-0000-4000-8000-000000000009'),inspect:()=>client.getMutationCache().getAll().map(m=>({status:m.state.status,isPaused:m.state.isPaused})),release:()=>{state.hold=false;state.held?.();},failStorage:()=>{const actual=indexedDB.open.bind(indexedDB);indexedDB.open=()=>{throw new DOMException('Synthetic storage unavailable','QuotaExceededError');};return ()=>{indexedDB.open=actual;};}};
`;
const stub='export const supabase={rpc:(name,args)=>({abortSignal:()=>window.a8Rpc(name,args)}),functions:{invoke:(name,args)=>window.a8Invoke(name,args)}}';
const compiled=await build({stdin:{contents:harness,loader:'tsx',resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':resolve(root,'src')},define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'synthetic-identity-and-transport',setup(builder){
 builder.onResolve({filter:/^@\/(hooks\/useAuth|hooks\/useTenant|integrations\/supabase\/client)$/},args=>({path:args.path,namespace:'a8-synthetic'}));
 builder.onLoad({filter:/.*/,namespace:'a8-synthetic'},args=>({contents:args.path.endsWith('useAuth')?'export const useAuth=()=>({user:{id:window.a8State.actor}})':args.path.endsWith('useTenant')?'export const useTenant=()=>({currentTenant:{id:window.a8State.tenant,timezone:"America/Sao_Paulo"}})':stub,loader:'js'}));
}}]});
const html='<!doctype html><meta charset="utf-8"><title>Disposable A8 expense contract</title><div id="app"></div><script>'+compiled.outputFiles[0].text+'</script>';
const browser=await chromium.launch({headless:true}),context=await browser.newContext(),url='https://a8-expense-fixture.invalid/';
await context.route('**/*',route=>route.request().url()===url?route.fulfill({status:200,contentType:'text/html',body:html}):route.abort());
const page=await context.newPage(),steps=[];
const digest=value=>createHash('sha256').update(value).digest('hex');
const out=resolve('node_modules/.cache/qa-driver-expense-offline-browser');mkdirSync(out,{recursive:true});
const record={at:new Date().toISOString(),source,tree,workingTreeClean,browser:browser.version(),steps,externalRequestsAllowed:false,scope:'Real Chromium UI/QueryClient/IndexedDB/Web Locks/PDF/reload, synthetic Auth/context/transport. NOT native A8/Auth/PWA/DB acceptance.',sourceFilesSha256:Object.fromEntries(['src/hooks/useDriverExpensesOperational.ts','scripts/test-driver-expense-offline-ui-browser.mjs'].map(file=>[file,digest(readFileSync(resolve(root,file)))]))};
const snapshot=()=>page.evaluate(async()=>({online:navigator.onLine,button:document.querySelector('button[type="submit"]')?.textContent,mutations:window.a8Fixture.inspect(),drafts:(await window.a8Fixture.drafts()).map(d=>({requestId:d.requestId,payload:d.payload,bytes:d.receipt.blob.size})),statusCalls:window.a8State.statusCalls,uploads:window.a8State.uploads.length,commands:window.a8State.commands.length,saved:window.a8State.saved.length}));
const load=async(seed=false)=>{await page.goto(url);if(seed)await page.evaluate(()=>window.a8Fixture.seed());await context.setOffline(true);await page.waitForFunction(()=>navigator.onLine===false);await page.evaluate(()=>window.a8Fixture.mount());await page.getByRole('button',{name:'Salvar para sincronizar'}).waitFor();};
const pdf=Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n'.padEnd(142,' ')),pdfSha256=digest(pdf);
const submit=async amount=>{await page.getByLabel('Valor (R$)').fill(amount);await page.getByLabel('Comprovante obrigatório').setInputFiles({name:'scanned.pdf',mimeType:'application/pdf',buffer:pdf});await page.getByRole('button',{name:'Salvar para sincronizar'}).click();};
try{
 await load(true);await submit('18,91');
 if(expectPaused){await page.waitForFunction(()=>window.a8Fixture.inspect().some(m=>m.status==='pending'&&m.isPaused));const observed=await snapshot();assert.equal(observed.button,'Salvando...');assert.equal(observed.drafts.length,0);assert.equal(observed.statusCalls+observed.uploads+observed.commands+observed.saved,0);record.status='reproduced-base-offline-paused';record.observed=observed;}
 else{
  await page.waitForFunction(()=>window.a8State.saved.length===1);const first=await snapshot();assert.equal(first.online,false);assert.equal(first.drafts.length,1);assert.equal(first.drafts[0].payload.fields.amount_cents,1891);assert.equal(first.drafts[0].bytes,142);assert.equal(first.statusCalls+first.uploads+first.commands,0);assert.ok(first.mutations.some(m=>m.status==='success'&&!m.isPaused));
  const original=first.drafts[0],originalWire=JSON.stringify(original.payload);record.originalWireSha256=digest(originalWire);record.originalPdfSha256=pdfSha256;steps.push({name:'Offline UI stores complete request/PDF before acknowledgement and zero transport',...first});
  // Route-fulfilled navigation resets Chromium's reported network state here.
  // Reapply native offline emulation before mounting any hooks/replay agent.
  // This checks durable reload, not a PWA/service-worker boot while disconnected.
  await page.reload();await context.setOffline(false);await context.setOffline(true);await page.waitForFunction(()=>navigator.onLine===false);await page.evaluate(()=>window.a8Fixture.mount());await page.getByRole('button',{name:'Salvar para sincronizar'}).waitFor();
  const recovered=await page.evaluate(async()=>{const [d]=await window.a8Fixture.drafts();return {requestId:d.requestId,payload:d.payload,bytes:d.receipt.blob.size,pdf:Array.from(new Uint8Array(await d.receipt.blob.arrayBuffer())),otherScope:(await window.a8Fixture.otherScope()).length};});
  assert.equal(JSON.stringify(recovered.payload),originalWire);assert.equal(digest(Buffer.from(recovered.pdf)),pdfSha256);assert.equal(recovered.otherScope,0);steps.push({name:'Browser reload and offline remount preserve same immutable request/PDF with actor-scoped read',requestId:recovered.requestId,bytes:recovered.bytes,pdfSha256,otherScope:0});
  // Hold synthetic ACK to prove reconnect never deletes before confirmation.
  await page.evaluate(()=>{window.a8State.hold=true;});await context.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.waitForFunction(()=>window.a8State.commands.length===1);const held=await snapshot();assert.equal(held.drafts.length,1);assert.equal(held.uploads,1);const wire=await page.evaluate(()=>JSON.stringify(window.a8State.commands[0]));assert.equal(wire,originalWire);steps.push({name:'Reconnect sends identical command and PDF once; outbox retained pending ACK',requestId:original.requestId,uploads:held.uploads,commands:held.commands,drafts:held.drafts.length});
  await page.evaluate(()=>window.a8Fixture.release());await page.waitForFunction(async()=>(await window.a8Fixture.drafts()).length===0);steps.push({name:'Outbox removed only after confirmed synthetic ACK',drafts:0});
  // A browser storage failure must retain user input and never acknowledge/send.
  await context.setOffline(true);await page.evaluate(()=>window.dispatchEvent(new Event('offline')));await page.getByRole('button',{name:'Salvar para sincronizar'}).waitFor();await page.evaluate(()=>window.a8Fixture.failStorage());await submit('21,25');
  await page.getByText('Synthetic storage unavailable').waitFor({timeout:3000});
  const failed=await page.evaluate(()=>({saved:window.a8State.saved.length,commands:window.a8State.commands.length,amount:document.querySelector('input[inputmode="decimal"]').value,file:document.querySelector('input[type="file"]').files[0]?.size}));assert.equal(failed.saved,0);assert.equal(failed.commands,1);assert.equal(failed.amount,'21,25');assert.equal(failed.file,142);steps.push({name:'Local storage failure retains input/PDF; no false saved acknowledgement or new transport',...failed});
  record.status=workingTreeClean?'passed-browser-only':'passed-browser-only-draft';
 }
 writeFileSync(resolve(out,expectPaused?'base-paused-evidence.json':'evidence.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
}catch(error){record.status='failed-browser-only';record.error=String(error);record.lastUi=await page.locator('body').innerText().catch(()=>null);record.lastObservation=await snapshot().catch(()=>null);writeFileSync(resolve(out,'failed-evidence.json'),JSON.stringify(record,null,2)+'\n');throw error;}
finally{await context.close();await browser.close();}
