import {test,expect} from '@playwright/test';
import {createServer,type ViteDevServer} from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// This browser fixture controls only transport responses. No authenticated client,
// DB, scanner or delivery acknowledgement is contacted or qualified by these tests.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const owned=process.env.AGVLOG_RETRY_QA_ARTIFACTS;
if(!owned)throw new Error('AGVLOG_RETRY_QA_ARTIFACTS must identify an exclusive QA directory.');
const fixture=String.raw`
import '@/index.css';import React from 'react';import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {MemoryRouter} from 'react-router-dom';
import SignaturePad from '@/components/driver/SignaturePad';import {DriverDeliverySyncBanner} from '@/components/driver/DriverDeliverySyncBanner';
import {createDeliverySubmission,replayPendingDeliverySubmissions} from '@/lib/driver/driverDeliverySubmission';
import {driverDeliveryOfflineStore} from '@/lib/driver/driverDeliveryOfflineStore';
import {validateUploadContent} from '@/lib/uploadPolicy';
const harness=window.__retryQa;const actualNow=Date.now.bind(Date);Date.now=()=>harness.clock??actualNow();
const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
harness.queueState=()=>client.getQueryState(['driver_delivery_outbox_replay','tenant','driver'])?.fetchStatus;
harness.queryResult=()=>client.getQueryData(['driver_delivery_outbox_replay','tenant','driver']);
const read=()=>driverDeliveryOfflineStore.list('tenant','driver');
harness.rows=async()=>{const rows=await read();return rows.map(d=>({requestId:d.requestId,state:d.state,attention:d.attention,retry:d.synchronization?.retry,
 uploads:d.synchronization?.uploads,signatureBytes:d.signature?.blob.size,photoBytes:d.photos.map(f=>f.blob.size)}));};
harness.replay=()=>replayPendingDeliverySubmissions('tenant','driver');
harness.submit=async()=>{
 const blob=await(await fetch(harness.signature)).blob(),file=new File([blob],'signature.png',{type:'image/png'});await validateUploadContent(file,'image');
 const receipt={original:file,processed:file,capturedAt:new Date().toISOString(),scanMode:'document_scan',crop:{left:0,top:0,right:1,bottom:1},
 quality:{accepted:true,sourceWidth:2000,sourceHeight:3000,processedWidth:1900,processedHeight:2800,brightness:180,contrast:40,sharpness:12,requiresConfirmation:false,
 glareRatio:0.01,edgeCutRisk:false,estimatedDpi:422,processingMs:1,warnings:[],rejectionReasons:[]}};
 harness.result=await createDeliverySubmission({tenantId:'tenant',actorId:'driver',tripId:'trip',stopId:'stop',expectedStatus:'arrived',eventKey:'entregue',
 photos:[file],receiptScan:receipt,signatureDataUrl:null,signatureFile:file,details:{receiver_name:'Synthetic recipient',latitude:0,longitude:0,accuracy_m:1}}).submit();
 return harness.result;
};
harness.signatureContract=async()=>{
 const file=new File([await(await fetch(harness.signature)).blob()],'signature.png',{type:'image/png'});await validateUploadContent(file,'image');
 const bitmap=await createImageBitmap(file),bytes=new Uint8Array(await file.arrayBuffer()),canvas=document.querySelector('canvas'),rect=canvas.getBoundingClientRect();
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 return {kind:'image',mime:file.type,bytes:file.size,width:bitmap.width,height:bitmap.height,canvasWidth:canvas.width,canvasHeight:canvas.height,
 containerHeight:canvas.parentElement.getBoundingClientRect().height,renderedWidth:rect.width,renderedHeight:rect.height,dpr:devicePixelRatio,magic:Array.from(bytes.slice(0,8)),sha256:Array.from(digest).map(b=>b.toString(16).padStart(2,'0')).join('')};
};
function App(){return <QueryClientProvider client={client}><MemoryRouter><div style={{width:420}}><SignaturePad onChange={value=>{harness.signature=value;}}/></div><DriverDeliverySyncBanner/></MemoryRouter></QueryClientProvider>}
createRoot(document.getElementById('root')).render(<App/>);
harness.ready=true;
`;
const transport=String.raw`
window.__retryQa={ready:false,mode:'permanent',clock:null,calls:[],rpcCalls:[],signature:null,result:null};
const h=window.__retryQa;
export const supabase={functions:{invoke:async(_name,{body})=>{
 const slot=body.get('file_slot'),requestId=body.get('request_id'),sha=body.get('sha256');
 h.calls.push({slot,requestId,sha,at:Date.now()});if(h.pause)await h.pause;await new Promise(resolve=>setTimeout(resolve,15));
 if(slot==='signature'&&h.mode!=='success')return {data:null,error:{context:new Response(JSON.stringify({error:h.mode==='quota'?'upload_rate_limited':'invalid_upload'}),
 {status:h.mode==='quota'?429:400,headers:h.mode==='quota'?{'retry-after':'90'}:{}})}};
 return {data:{path:body.get('tenant_id')+'/'+body.get('folder')+'/'+requestId+'-'+slot.replace(':','-')+'-'+sha},error:null};
}},rpc:async(name,args)=>{h.rpcCalls.push({name,args});if(h.rpcPause)await h.rpcPause;return {data:{event_id:'10000000-0000-4000-8000-000000000001',operational_event_id:'20000000-0000-4000-8000-000000000001',replayed:false},error:null};},
auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),refreshSession:async()=>({data:{session:null},error:new Error('Synthetic transport only')})}};
`;
let server:ViteDevServer,origin:string;
test.beforeAll(async()=>{
  server=await createServer({root,configFile:false,envDir:path.join(owned,'empty-env'),cacheDir:path.join(owned,'browser-vite-cache'),
    publicDir:false,plugins:[react(),{name:'isolated-delivery-retry-fixture',
      resolveId(id){if(id==='@/integrations/supabase/client')return '\0retry-sdk';if(id==='@/hooks/useAuth')return '\0retry-auth';if(id==='@/hooks/useTenant')return '\0retry-tenant';if(id==='@/hooks/useOnlineStatus')return '\0retry-online';},
      load(id){if(id==='\0retry-sdk')return transport;if(id==='\0retry-auth')return "export function useAuth(){return {user:{id:'driver'}}}";if(id==='\0retry-tenant')return "export function useTenant(){return {currentTenant:{id:'tenant'}}}";if(id==='\0retry-online')return 'export function useOnlineStatus(){return navigator.onLine}';},
      configureServer(s){s.middlewares.use((req,res,next)=>{
        if(req.url==='/'){res.setHeader('content-type','text/html');void s.transformIndexHtml('/','<div id="root"></div><script type="module" src="/retry-fixture.tsx"></script>').then(html=>res.end(html));}
        else if(req.url?.startsWith('/retry-fixture.tsx'))void s.transformRequest('/retry-fixture-virtual.tsx').then(result=>{res.setHeader('content-type','text/javascript');res.end(result?.code??'');});
        else next();
      });},
    },{name:'virtual-fixture',resolveId(id){if(id==='/retry-fixture-virtual.tsx'||id==='/retry-fixture.tsx')return '\0retry-fixture.tsx';},load(id){if(id==='\0retry-fixture.tsx')return fixture;}}],
    resolve:{alias:[{find:/^@\/(?!integrations\/supabase\/client$|hooks\/useAuth$|hooks\/useTenant$|hooks\/useOnlineStatus$)(.*)/,replacement:path.join(root,'src')+'/$1'}]},
    server:{host:'127.0.0.1',port:0,fs:{allow:[root,owned]}}});
  await server.listen();const address=server.httpServer!.address();if(!address||typeof address==='string')throw new Error('No owned server port');origin='http://127.0.0.1:'+address.port;
});
test.afterAll(async()=>{await server?.close();});
async function draw(page:import('@playwright/test').Page){
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  await page.goto(origin);await page.waitForFunction(()=>window.__retryQa?.ready,{},{timeout:8000}).catch(error=>{throw new Error(String(error)+'; browser errors: '+errors.join(' | '));});
  const canvas=page.getByRole('img',{name:'Área para desenhar a assinatura'});const box=await canvas.boundingBox();if(!box)throw new Error('No signature canvas');
  await page.mouse.move(box.x+20,box.y+40);await page.mouse.down();
  for(let i=1;i<=12;i++)await page.mouse.move(box.x+20+i*20,box.y+40+Math.sin(i)*20);
  await page.mouse.up();await page.waitForFunction(()=>!!window.__retryQa.signature);
}
declare global {interface Window {__retryQa:{rpcPause:Promise<void>|null;rpcResume:()=>void;queueState:()=>string|undefined;queryResult:()=>{confirmed:number;rejected:number;superseded:number;pending:number}|undefined;pause:Promise<void>|null;resume:()=>void;ready:boolean;mode:string;clock:number|null;signature:string;result:unknown;calls:{slot:string;requestId:string;sha:string;at:number}[];rpcCalls:unknown[];
  submit:()=>Promise<unknown>;rows:()=>Promise<{requestId:string;state:string;attention:{kind:string;code:string};retry:{attempts:number;failures:number;nextAttemptAt:number};uploads:{slot:string;sha256:string;state:string}[];signatureBytes:number;photoBytes:number[]}[]>;
  replay:()=>Promise<unknown>;signatureContract:()=>Promise<{kind:string;mime:string;bytes:number;width:number;height:number;canvasWidth:number;canvasHeight:number;containerHeight:number;renderedWidth:number;renderedHeight:number;dpr:number;magic:number[];sha256:string}>;}}}
test('actual SignaturePad emits a content-valid PNG at its actual DPR1 dimensions',async({page},testInfo)=>{
  await draw(page);const contract=await page.evaluate(()=>window.__retryQa.signatureContract());
  expect(contract.dpr).toBe(1);expect(contract.mime).toBe('image/png');expect(contract.magic).toEqual([137,80,78,71,13,10,26,10]);
  expect(contract.width).toBe(contract.canvasWidth);expect(contract.height).toBe(contract.canvasHeight);expect(contract.canvasHeight).toBe(Math.round(contract.renderedHeight));
  expect(contract.containerHeight).toBe(180);expect(contract.renderedHeight).toBeGreaterThanOrEqual(178);expect(contract.renderedHeight).toBeLessThanOrEqual(180);expect(contract.bytes).toBeGreaterThan(0);expect(contract.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(await page.evaluate(()=>window.__retryQa.calls.length)).toBe(0);expect(await page.evaluate(()=>window.__retryQa.rpcCalls.length)).toBe(0);
  await testInfo.attach('signature-contract',{body:JSON.stringify(contract),contentType:'application/json'});
});
test('real IndexedDB retains permanent 400 evidence through 200 notifications and a page reload',async({page},testInfo)=>{
  await draw(page);const result=await page.evaluate(()=>window.__retryQa.submit());expect(result).toMatchObject({queued:true,needs_attention:true,attention_code:'invalid_upload'});
  await page.evaluate(()=>{for(let i=0;i<200;i++)window.dispatchEvent(new CustomEvent('agvlog:driver-offline-outbox-changed'));});
  await expect.poll(()=>page.evaluate(()=>window.__retryQa.calls.length)).toBe(4);
  const before=await page.evaluate(()=>window.__retryQa.rows());expect(before).toHaveLength(1);expect(before[0].uploads.filter(e=>e.state==='uploaded')).toHaveLength(3);expect(before[0].retry.attempts).toBe(4);
  expect(await page.evaluate(()=>window.__retryQa.rpcCalls.length)).toBe(0);
  await page.reload();await page.waitForFunction(()=>window.__retryQa.ready);const reopened=await page.evaluate(()=>window.__retryQa.rows());expect(reopened).toEqual(before);
  for(let i=0;i<20;i++)await page.evaluate(()=>window.__retryQa.replay());
  expect(await page.evaluate(()=>window.__retryQa.calls.length)).toBe(0);expect(await page.evaluate(()=>window.__retryQa.rpcCalls.length)).toBe(0);
  await testInfo.attach('indexeddb-permanent400',{body:JSON.stringify({before,reopened,postReloadTransportCalls:0}),contentType:'application/json'});
});
test('real IndexedDB 429 deadline survives reload and resumes only the failed slot at the deadline',async({page},testInfo)=>{
  await draw(page);await page.evaluate(()=>{window.__retryQa.mode='quota';});await page.evaluate(()=>window.__retryQa.submit());
  const before=(await page.evaluate(()=>window.__retryQa.rows()))[0],at=before.retry.nextAttemptAt;
  expect(at).toBeGreaterThan(Date.now()+80_000);expect(before.uploads.filter(e=>e.state==='uploaded')).toHaveLength(3);
  await page.reload();await page.waitForFunction(()=>window.__retryQa.ready);
  await page.evaluate(deadline=>{window.__retryQa.mode='success';window.__retryQa.clock=deadline-1;},at);
  for(let i=0;i<20;i++)await page.evaluate(()=>window.__retryQa.replay());expect(await page.evaluate(()=>window.__retryQa.calls.length)).toBe(0);
  await page.evaluate(deadline=>{window.__retryQa.clock=deadline;},at);await page.evaluate(()=>window.__retryQa.replay());
  const calls=await page.evaluate(()=>window.__retryQa.calls);expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({slot:'signature',requestId:before.requestId,sha:before.uploads.find(e=>e.slot==='signature')!.sha256,at});
  expect(await page.evaluate(()=>window.__retryQa.rpcCalls.length)).toBe(1);expect(await page.evaluate(()=>window.__retryQa.rows())).toEqual([]);
  await testInfo.attach('indexeddb-quota',{body:JSON.stringify({before,at,calls,acknowledgement:'synthetic transport only'}),contentType:'application/json'});
});

test('Web Locks serialize a separate tab replay and retain the authoritative terminal draft',async({page,context},testInfo)=>{
  await draw(page);const second=await context.newPage();await second.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  await second.goto(origin);await second.waitForFunction(()=>window.__retryQa.ready);
  expect(await page.evaluate(()=>!!navigator.locks)).toBe(true);
  await page.evaluate(()=>{const h=window.__retryQa;h.pause=new Promise<void>(resolve=>{h.resume=resolve;});void h.submit();});
  await expect.poll(()=>page.evaluate(()=>window.__retryQa.calls.length)).toBe(1);
  const replay=second.evaluate(()=>window.__retryQa.replay());
  await expect.poll(()=>second.evaluate(()=>window.__retryQa.rows().then(rows=>rows.length))).toBe(1);
  expect(await second.evaluate(()=>window.__retryQa.calls.length)).toBe(0);
  await page.evaluate(()=>window.__retryQa.resume());await replay;
  await expect.poll(()=>page.evaluate(()=>window.__retryQa.result)).toMatchObject({queued:true,needs_attention:true});
  expect(await page.evaluate(()=>window.__retryQa.calls.length)).toBe(4);expect(await second.evaluate(()=>window.__retryQa.calls.length)).toBe(0);
  expect(await page.evaluate(()=>window.__retryQa.rpcCalls.length)).toBe(0);expect(await second.evaluate(()=>window.__retryQa.rpcCalls.length)).toBe(0);
  const rows=await second.evaluate(()=>window.__retryQa.rows());expect(rows[0].state).toBe('needs_attention');expect(rows[0].retry.attempts).toBe(4);
  await testInfo.attach('cross-tab-terminal',{body:JSON.stringify({rows,firstTabUploads:4,secondTabUploads:0,outcomeCalls:0}),contentType:'application/json'});await second.close();
});

for(const {tabs,manual} of [{tabs:2,manual:false},{tabs:2,manual:true},{tabs:4,manual:false}]){
  test(`post-ACK stale ${tabs} tabs ${manual?'manual':'automatic'} performs no second upload or RPC`,async({page,context},testInfo)=>{
    await draw(page);const pages=[page];
    for(let i=1;i<tabs;i++){
      const next=await context.newPage();await next.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
      await next.goto(origin);await next.waitForFunction(()=>window.__retryQa.ready);pages.push(next);
    }
    for(const current of pages)await expect.poll(()=>current.evaluate(()=>window.__retryQa.queueState())).toBe('idle');
    await page.evaluate(()=>{const h=window.__retryQa;h.mode='success';h.rpcPause=new Promise<void>(resolve=>{h.rpcResume=resolve;});});
    const submit=page.evaluate(()=>window.__retryQa.submit());await expect.poll(()=>page.evaluate(()=>window.__retryQa.rpcCalls.length)).toBe(1);
    const first=(await page.evaluate(()=>window.__retryQa.rows()))[0];expect(first.uploads.filter(entry=>entry.state==='uploaded')).toHaveLength(4);expect(first.retry.attempts).toBe(5);
    const manualResults:Promise<unknown>[]=[];
    for(const secondary of pages.slice(1)){
      if(manual)manualResults.push(secondary.evaluate(()=>window.__retryQa.replay()));
      else await secondary.evaluate(()=>window.dispatchEvent(new CustomEvent('agvlog:driver-offline-outbox-changed')));
    }
    await expect.poll(()=>page.evaluate(()=>navigator.locks.query().then(state=>state.pending.length))).toBe(tabs-1);
    const captured=[];for(const current of pages)captured.push(await current.evaluate(()=>window.__retryQa.rows()));
    for(const rows of captured)expect(rows[0]).toMatchObject({requestId:first.requestId,retry:{attempts:5}});
    await page.evaluate(()=>window.__retryQa.rpcResume());await expect(submit).resolves.toMatchObject({queued:false});
    const results=manual?await Promise.all(manualResults):[];
    for(const current of pages)await expect.poll(()=>current.evaluate(()=>window.__retryQa.queueState())).toBe('idle');
    if(!manual)for(const secondary of pages.slice(1))results.push(await secondary.evaluate(()=>window.__retryQa.queryResult()));
    for(const result of results)expect(result).toMatchObject({confirmed:0,rejected:0,superseded:1,pending:0});
    const after=[];for(const current of pages)after.push(await current.evaluate(async()=>({uploads:window.__retryQa.calls.length,rpcs:window.__retryQa.rpcCalls.length,rows:await window.__retryQa.rows()})));
    expect(after.reduce((total,entry)=>total+entry.uploads,0)).toBe(4);expect(after.reduce((total,entry)=>total+entry.rpcs,0)).toBe(1);for(const entry of after)expect(entry.rows).toEqual([]);
    for(const current of pages)await current.evaluate(()=>{for(let i=0;i<100;i++)window.dispatchEvent(new CustomEvent('agvlog:driver-offline-outbox-changed'));});
    for(let i=0;i<100;i++)await pages[1].evaluate(()=>window.__retryQa.replay());
    for(const current of pages)await expect.poll(()=>current.evaluate(()=>window.__retryQa.queueState())).toBe('idle');
    const noAdditional=[];for(const current of pages)noAdditional.push(await current.evaluate(()=>({uploads:window.__retryQa.calls.length,rpcs:window.__retryQa.rpcCalls.length})));
    expect(noAdditional.reduce((total,entry)=>total+entry.uploads,0)).toBe(4);expect(noAdditional.reduce((total,entry)=>total+entry.rpcs,0)).toBe(1);
    for(const current of pages){await current.reload();await current.waitForFunction(()=>window.__retryQa.ready);await expect.poll(()=>current.evaluate(()=>window.__retryQa.queueState())).toBe('idle');}
    for(const current of pages){expect(await current.evaluate(()=>window.__retryQa.calls.length)).toBe(0);expect(await current.evaluate(()=>window.__retryQa.rpcCalls.length)).toBe(0);expect(await current.evaluate(()=>window.__retryQa.rows())).toEqual([]);}
    await testInfo.attach('post-ack-no-io',{body:JSON.stringify({tabs,manual,requestId:first.requestId,captured,results,after,noAdditional,afterReload:{uploads:0,rpcs:0},transport:'synthetic; no actual SQL ACK proof'}),contentType:'application/json'});
    for(const secondary of pages.slice(1))await secondary.close();
  });
}
