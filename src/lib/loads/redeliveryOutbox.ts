import {isRecord} from './operationDocumentOutcome';
import {isConfirmedRedelivery,isRedeliveryPayload,isRedeliveryExpected,uuidValue,type RedeliveryPayload,type RedeliveryResult,type RedeliveryExpected} from './redelivery';
export const REDELIVERY_CHANGED='agvlog:redelivery-changed';
export interface PendingRedelivery {version:1;tenantId:string;actorId:string;requestId:string;createdAt:string;payload:RedeliveryPayload;expected:RedeliveryExpected}
interface Dependencies {storage:Storage;uuid:()=>string;changed:()=>void;assertContext:()=>void;
 lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;send:(payload:RedeliveryPayload&{request_id:string})=>Promise<{data:unknown;error:unknown}>}
const prefix=(tenant:string,actor:string)=>`agvlog:redelivery:v1:${encodeURIComponent(tenant)}:${encodeURIComponent(actor)}:`;
const storageError=()=>new Error('Recuperação local da reentrega indisponível ou incompatível. Nenhum novo envio foi iniciado.');
function read(storage:Storage,key:string):PendingRedelivery|null{
 try{const raw=storage.getItem(key);if(!raw)return null;const row:unknown=JSON.parse(raw);
  if(!isRecord(row)||row.version!==1||!isRedeliveryPayload(row.payload)||!uuidValue(row.tenantId)||!uuidValue(row.actorId)||!uuidValue(row.requestId)
   ||row.payload.tenant_id!==row.tenantId||key!==prefix(row.tenantId,row.actorId)+row.payload.document_id||!isRedeliveryExpected(row.expected)
   ||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt)))throw storageError();
  return row as unknown as PendingRedelivery;
 }catch{throw storageError();}
}
export function pendingRedeliveries(storage:Storage,tenant:string,actor:string){
 try{const rows:PendingRedelivery[]=[];for(let index=0;index<storage.length;index++){const key=storage.key(index);if(!key?.startsWith('agvlog:redelivery:'))continue;
   const parts=key.split(':');if(parts[3]!==encodeURIComponent(tenant)||parts[4]!==encodeURIComponent(actor))continue;
   if(!key.startsWith(prefix(tenant,actor)))throw storageError();
   const row=read(storage,key);if(row)rows.push(row);}return rows.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 }catch{throw storageError();}
}
export function createRedeliveryOutbox(deps:Dependencies){
 const inflight=new Map<string,Promise<RedeliveryResult>>();
 function run(tenant:string,actor:string,doc:string,input?:{payload:RedeliveryPayload;expected:RedeliveryExpected}){
  const key=prefix(tenant,actor)+doc;if(inflight.has(key))return inflight.get(key)!;
  const promise=deps.lock(key,async()=>{
   deps.assertContext();pendingRedeliveries(deps.storage,tenant,actor);let row=read(deps.storage,key);const uncertainBefore=!!row;
   if(row&&input)throw new Error('Há reentrega sem confirmação. Use Recuperar reentrega antes de enviar outro pedido.');
   if(!row){
    if(!input||!isRedeliveryPayload(input.payload)||input.payload.tenant_id!==tenant||input.payload.document_id!==doc
     ||!uuidValue(tenant)||!uuidValue(actor)||!isRedeliveryExpected(input.expected))throw new Error('Confira descrição, pallets inteiros, peso e cubagem de todos os itens do saldo.');
    row={version:1,tenantId:tenant,actorId:actor,requestId:deps.uuid(),createdAt:new Date().toISOString(),
     payload:JSON.parse(JSON.stringify(input.payload)) as RedeliveryPayload,expected:{...input.expected}};
    if(!uuidValue(row.requestId))throw storageError();
    try{deps.storage.setItem(key,JSON.stringify(row));}catch{throw storageError();}deps.changed();
   }
   const forget=()=>{try{deps.storage.removeItem(key);}catch{/* Exact replay remains available. */}deps.changed();};
   deps.assertContext();const {data,error}=await deps.send({...row.payload,request_id:row.requestId});deps.assertContext();
   if(error){const code=isRecord(error)&&typeof error.code==='string'?error.code:'';
    if(!uncertainBefore&&(/^(22|23)/.test(code)||['40001','40P01','55P03','42501'].includes(code))
     &&!(isRecord(error)&&String(error.message).includes('reconciliation_required')))forget();throw error;}
   if(!isConfirmedRedelivery(data,row.payload,row.expected,actor,row.requestId))throw new Error('O servidor não confirmou a reentrega. Use Recuperar reentrega; não registre outro pedido.');
   forget();return data;
  });
  inflight.set(key,promise);void promise.finally(()=>{if(inflight.get(key)===promise)inflight.delete(key);deps.changed();}).catch(()=>{});return promise;
 }
 return {submit:(tenant:string,actor:string,payload:RedeliveryPayload,expected:RedeliveryExpected)=>run(tenant,actor,payload.document_id,{payload,expected}),
  recover:(tenant:string,actor:string,doc:string)=>run(tenant,actor,doc)};
}
