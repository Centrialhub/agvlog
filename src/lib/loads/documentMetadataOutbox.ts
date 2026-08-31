import {isRecord} from './operationDocumentOutcome';
import {uuidValue} from './redelivery';
import {isMetadataPayload,isMetadataResult,type MetadataPayload,type MetadataResult} from './documentMetadata';
export const METADATA_CHANGED='agvlog:document-metadata-changed';
export interface PendingMetadata {version:1;tenantId:string;actorId:string;requestId:string;createdAt:string;payload:MetadataPayload}
interface Dependencies {storage:Storage;uuid:()=>string;changed:()=>void;assertContext:()=>void;
 lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;send:(payload:MetadataPayload&{request_id:string})=>Promise<{data:unknown;error:unknown}>}
const prefix=(tenant:string,actor:string)=>`agvlog:document-metadata:v1:${encodeURIComponent(tenant)}:${encodeURIComponent(actor)}:`;
const unavailable=()=>new Error('Recuperação da conferência indisponível ou incompatível. Nenhum novo pedido foi enviado.');
function read(storage:Storage,key:string):PendingMetadata|null{
 try{const raw=storage.getItem(key);if(!raw)return null;const row:unknown=JSON.parse(raw);
  if(!isRecord(row)||row.version!==1||!uuidValue(row.tenantId)||!uuidValue(row.actorId)||!uuidValue(row.requestId)||!isMetadataPayload(row.payload)
   ||row.payload.tenant_id!==row.tenantId||key!==prefix(row.tenantId,row.actorId)+row.payload.load_id
   ||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt)))throw unavailable();return row as unknown as PendingMetadata;
 }catch{throw unavailable();}
}
export function pendingMetadata(storage:Storage,tenant:string,actor:string){
 try{const rows:PendingMetadata[]=[];for(let index=0;index<storage.length;index++){const key=storage.key(index);if(!key?.startsWith('agvlog:document-metadata:'))continue;
  const parts=key.split(':');if(parts[3]!==encodeURIComponent(tenant)||parts[4]!==encodeURIComponent(actor))continue;
  if(!key.startsWith(prefix(tenant,actor)))throw unavailable();const row=read(storage,key);if(row)rows.push(row);
 }return rows.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));}catch{throw unavailable();}
}
export function createMetadataOutbox(deps:Dependencies){
 const inflight=new Map<string,Promise<MetadataResult>>();
 function run(tenant:string,actor:string,load:string,input?:MetadataPayload){
  const key=prefix(tenant,actor)+load;if(inflight.has(key))return inflight.get(key)!;
  const promise=deps.lock(key,async()=>{
   deps.assertContext();pendingMetadata(deps.storage,tenant,actor);let row=read(deps.storage,key);const uncertainBefore=!!row;
   if(row&&input)throw new Error('Há conferência sem confirmação. Use Recuperar conferência antes de enviar outro pedido.');
   if(!row){
    if(!uuidValue(actor)||!input||!isMetadataPayload(input)||input.tenant_id!==tenant||input.load_id!==load)throw new Error('Confira o contexto e os campos das notas.');
    row={version:1,tenantId:tenant,actorId:actor,requestId:deps.uuid(),createdAt:new Date().toISOString(),payload:JSON.parse(JSON.stringify(input)) as MetadataPayload};
    if(!uuidValue(row.requestId))throw unavailable();try{deps.storage.setItem(key,JSON.stringify(row));}catch{throw unavailable();}deps.changed();
   }
   const forget=()=>{try{deps.storage.removeItem(key);}catch{/* Retain an exact replay if local removal fails. */}deps.changed();};
   deps.assertContext();const {data,error}=await deps.send({...row.payload,request_id:row.requestId});deps.assertContext();
   if(error){const code=isRecord(error)&&typeof error.code==='string'?error.code:'';
    if(!uncertainBefore&&(/^(22|23)/.test(code)||['40001','40P01','55P03','42501'].includes(code))
     &&!(isRecord(error)&&String(error.message).includes('reconciliation_required')))forget();throw error;}
   if(!isMetadataResult(data,row.payload,actor,row.requestId))throw new Error('O servidor não confirmou a conferência. Recupere o mesmo pedido; não envie outro lote.');
   forget();return data;
  });
  inflight.set(key,promise);void promise.finally(()=>{if(inflight.get(key)===promise)inflight.delete(key);deps.changed();}).catch(()=>{});return promise;
 }
 return {submit:(tenant:string,actor:string,payload:MetadataPayload)=>run(tenant,actor,payload.load_id,payload),recover:(tenant:string,actor:string,load:string)=>run(tenant,actor,load)};
}
