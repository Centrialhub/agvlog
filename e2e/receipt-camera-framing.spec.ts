import {test,expect} from '@playwright/test';
import {createServer,type ViteDevServer} from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// An owned, synthetic camera. No login, upload, OCR provider or database request.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=`import '@/index.css';import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Scanner from '@/components/driver/DeliveryReceiptScanner';
import{BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS as thresholds}from'@/lib/driver/receiptQualityPolicy';
const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1800;
const ctx=canvas.getContext('2d');ctx.fillStyle='#777';ctx.fillRect(0,0,2400,1800);
const stream=canvas.captureStream(4);Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>stream},configurable:true});
function App(){const[value,setValue]=useState(null),[error,setError]=useState('');return <div style={{maxWidth:480,margin:'auto',padding:12}}>
<Scanner value={value} qualityPolicy={{source:'baseline',policy_id:null,version:1,tenant_id:'10000000-0000-4000-8000-000000000001',client_id:null,thresholds,resolved_at:'2026-11-13T00:00:00Z'}}
onChange={next=>{setValue(next);window.__receiptFrame=next?{crop:next.crop,corners:next.corners,width:next.quality.processedWidth,height:next.quality.processedHeight,accepted:next.quality.accepted}:null;}} onError={setError}/><p role="alert">{error}</p></div>}
createRoot(document.getElementById('root')).render(<App/>);`;
let server:ViteDevServer,origin:string;
test.beforeAll(async()=>{
  server=await createServer({root,configFile:false,logLevel:'error',plugins:[react(),{
    name:'receipt-camera-fixture',configureServer(s){s.middlewares.use((req,res,next)=>{
      if(req.url==='/'){res.setHeader('content-type','text/html');void s.transformIndexHtml('/','<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/receipt-fixture.tsx"></script>').then(html=>res.end(html));}
      else if(req.url?.startsWith('/receipt-fixture.tsx'))void s.transformRequest('/receipt-virtual.tsx').then(result=>{res.setHeader('content-type','text/javascript');res.end(result?.code??'');});
      else next();
    });},resolveId(id){if(id==='/receipt-virtual.tsx'||id==='/receipt-fixture.tsx')return '\0receipt-fixture.tsx';if(id==='@/integrations/supabase/client')return '\0receipt-supabase';},
    load(id){if(id==='\0receipt-fixture.tsx')return fixture;if(id==='\0receipt-supabase')return 'export const supabase={};';},
  }],resolve:{alias:[{find:/^@\/(?!integrations\/supabase\/client$)(.*)/,replacement:path.join(root,'src')+'/$1'}]},server:{host:'127.0.0.1',port:0,fs:{allow:[root]}}});
  await server.listen();const address=server.httpServer!.address();if(!address||typeof address==='string')throw Error('No owned camera fixture port');origin='http://127.0.0.1:'+address.port;
});
test.afterAll(async()=>{await server?.close();});
test('receipt framing follows the actual sensor and preserves an inconclusive full photo @critical',async({page},info)=>{
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
  await page.goto(origin);await page.getByRole('button',{name:'Abrir scanner',exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.clientWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  const video=page.getByLabel('Prévia da câmera');await expect(video).toBeVisible();
  await expect.poll(()=>video.evaluate((element:HTMLVideoElement)=>element.videoWidth)).toBe(2400);
  const geometry=await video.evaluate((element:HTMLVideoElement)=>{const sensor=element.getBoundingClientRect(),frame=element.parentElement!.getBoundingClientRect();
    return {video:{x:sensor.x,y:sensor.y,width:sensor.width,height:sensor.height},frame:{x:frame.x,y:frame.y,width:frame.width,height:frame.height},ratio:element.videoWidth/element.videoHeight};});
  expect(Math.abs(geometry.frame.width/geometry.frame.height-geometry.ratio)).toBeLessThan(.02);
  expect(Math.abs(geometry.video.width-geometry.frame.width)).toBeLessThan(3);
  expect(Math.abs(geometry.video.height-geometry.frame.height)).toBeLessThan(3);
  await page.getByRole('button',{name:'Capturar agora',exact:true}).click();
  await expect(page.getByAltText('Foto original para ajustar as bordas')).toBeVisible({timeout:20000});
  const result=await page.evaluate(()=> (window as unknown as {__receiptFrame:unknown}).__receiptFrame);
  expect(result).toMatchObject({accepted:false,width:2400,height:1800,corners:{topLeft:{x:0,y:0},bottomRight:{x:1,y:1}}});
  const handle=page.getByRole('button',{name:'Canto superior esquerdo',exact:true});
  await handle.scrollIntoViewIfNeeded();
  const handleIsReachable=await handle.evaluate(element=>{const box=element.getBoundingClientRect();
    return [[3,box.height/2],[box.width/2,3],[box.width-3,box.height/2]].every(([x,y])=>element.contains(document.elementFromPoint(box.x+x,box.y+y)));});
  expect(handleIsReachable).toBe(true);
  await expect(page.getByRole('button',{name:'Fotografar com a câmera do celular'})).toBeVisible();
  await info.attach('sensor-framing',{body:JSON.stringify({geometry,result}),contentType:'application/json'});
  await info.attach('synthetic-full-photo-review',{body:await page.screenshot(),contentType:'image/png'});
});
