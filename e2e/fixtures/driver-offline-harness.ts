import {createDeliverySubmission, listPendingDeliverySubmissions} from '../../src/lib/driver/driverDeliverySubmission';
import {driverOfflineOutbox, driverOfflineSnapshotStore} from '../../src/lib/driver/driverOfflineOutbox';

const tenantId='71000000-0000-4000-8000-000000000001';
const actorId='71000000-0000-4000-8000-000000000002';
const tripId='71000000-0000-4000-8000-000000000003';
const stopId='71000000-0000-4000-8000-000000000004';
const requestId='71000000-0000-4000-8000-000000000005';
const bytes=(label:string)=>new TextEncoder().encode(label);
const image=(label:string)=>new File([bytes(label)],`${label}.png`,{type:'image/png',lastModified:1_789_000_000_000});
const scan=()=>({
  original:image('canhoto-original'),processed:image('canhoto-processado'),thumbnail:image('canhoto-miniatura'),
  capturedAt:'2026-09-10T12:00:00.000Z',scanMode:'document_scan' as const,
  crop:{left:0.02,top:0.02,right:0.98,bottom:0.98},
  quality:{accepted:true,sourceWidth:2000,sourceHeight:3000,processedWidth:1900,processedHeight:2800,
    brightness:180,contrast:40,sharpness:12,requiresConfirmation:false,glareRatio:0.01,edgeCutRisk:false,
    estimatedDpi:422,processingMs:25,warnings:[],rejectionReasons:[]},
});

const deleteDatabase=(name:string)=>new Promise<void>((resolve,reject)=>{
  const request=indexedDB.deleteDatabase(name);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);
  request.onblocked=()=>reject(new Error(`blocked:${name}`));
});
const reset=async()=>{
  await Promise.all(['agvlog-driver-offline-v1','agvlog-driver-offline-v2','agvlog-driver-expenses-offline-v1'].map(deleteDatabase));
};
const setOnline=(online:boolean)=>Object.defineProperty(navigator,'onLine',{configurable:true,value:online});

const api={
  reset,
  async queueDelivery(){
    setOnline(false);
    return createDeliverySubmission({tenantId,actorId,tripId,stopId,expectedStatus:'arrived',eventKey:'entregue',
      details:{receiver_name:'Recebedor QA',notes:'Entregue',latitude:-23.5,longitude:-46.6,accuracy_m:8},
      photos:[image('foto-entrega')],receiptScan:scan(),signatureDataUrl:null,signatureFile:image('assinatura')},
      {requestId}).submit();
  },
  async inspect(){
    const [row]=await driverOfflineOutbox.list(tenantId,actorId);
    const files=await Promise.all((row?.files??[]).map(async file=>({slot:file.slot,name:file.name,type:file.type,size:file.blob.size,
      text:new TextDecoder().decode(await file.blob.arrayBuffer()),sha256:file.sha256})));
    return {row:row?{id:row.id,kind:row.kind,scopeKey:row.scopeKey,state:row.state,uploadFailures:row.uploadFailures,files}:null,
      pending:await listPendingDeliverySubmissions(tenantId,actorId)};
  },
  async writeCache(){
    await driverOfflineSnapshotStore.put({version:1,id:'route-cache',scopeKey:`${tenantId}:${actorId}`,tenantId,actorId,tripId,
      payload:{version:1,stops:[{status:'arrived'}]},cachedAt:'2026-09-10T12:00:00.000Z',expiresAt:'2026-09-17T12:00:00.000Z'});
  },
  async updateCache(){
    await driverOfflineSnapshotStore.put({version:1,id:'route-cache',scopeKey:`${tenantId}:${actorId}`,tenantId,actorId,tripId,
      payload:{version:2,stops:[{status:'arrived'},{status:'pending'}]},cachedAt:'2026-09-10T12:01:00.000Z',expiresAt:'2026-09-17T12:00:00.000Z'});
  },
  async readCache(){return driverOfflineSnapshotStore.read('route-cache');},
};

Object.assign(globalThis,{driverOfflineHarness:api});
document.querySelector('#ready')!.textContent='Pronto';

export type DriverOfflineHarness=typeof api;
