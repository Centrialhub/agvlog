import {expenseCreationSchema,parseCreationContext,type ExpenseCreationCommand,type ExpenseCreationContext} from '@/lib/financial/expenseCreationCommands';
import type {Json} from '@/integrations/supabase/types';
import {driverOfflineOutbox,driverOfflineScope,driverOfflineSnapshotStore,type DriverOfflineEnvelope,type DriverOfflineFile} from '@/lib/driver/driverOfflineOutbox';

const databaseName='agvlog-driver-expenses-offline-v1';
const draftStoreName='expense-submissions';
const cacheStoreName='expense-contexts';
const scopeIndex='tenant-actor';
const maxCacheAgeMs=7*24*60*60*1000;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface StoredExpenseReceipt {
 blob:Blob;
 name:string;
 type:string;
 lastModified:number;
}

export interface DriverExpenseSource {
 id:string;
 driver_id:string;
 status:'planned'|'in_transit'|'completed';
 notes:string|null;
 created_at:string;
 actual_start_at:string|null;
 actual_end_at:string|null;
}

export interface DriverExpenseOfflineDraft {
 version:1;
 requestId:string;
 scopeKey:string;
 tenantId:string;
 actorId:string;
 payload:ExpenseCreationCommand;
 receipt:StoredExpenseReceipt;
 state:'queued'|'needs_attention';
 uploadFailures?:number;
 lastError:string|null;
 createdAt:string;
 updatedAt:string;
}

interface DriverExpenseOfflineCache {
 version:1;
 key:string;
 scopeKey:string;
 tenantId:string;
 actorId:string;
 sources:DriverExpenseSource[];
 contexts:Record<string,ExpenseCreationContext>;
 updatedAt:string;
}

export interface DriverExpenseOfflineStore {
 save(draft:DriverExpenseOfflineDraft):Promise<void>;
 list(tenantId:string,actorId:string):Promise<DriverExpenseOfflineDraft[]>;
 remove(requestId:string):Promise<void>;
 saveSources(tenantId:string,actorId:string,sources:DriverExpenseSource[]):Promise<void>;
 readSources(tenantId:string,actorId:string):Promise<DriverExpenseSource[]>;
 saveContext(tenantId:string,actorId:string,context:ExpenseCreationContext):Promise<void>;
 readContext(tenantId:string,actorId:string,sourceId:string):Promise<ExpenseCreationContext|null>;
}

export const driverExpenseScope=(tenantId:string,actorId:string)=>`${tenantId}:${actorId}`;
const cacheKey=(tenantId:string,actorId:string)=>`context:${driverExpenseScope(tenantId,actorId)}`;

function storageError(message:string){return new Error(`${message} O gasto e o comprovante não foram descartados.`);}

function openDatabase():Promise<IDBDatabase>{
 return new Promise((resolve,reject)=>{
  if(typeof indexedDB==='undefined'){reject(storageError('O armazenamento offline deste aparelho está indisponível.'));return;}
  const request=indexedDB.open(databaseName,1);
  request.onupgradeneeded=()=>{
   const database=request.result;
   const drafts=database.objectStoreNames.contains(draftStoreName)?request.transaction!.objectStore(draftStoreName):database.createObjectStore(draftStoreName,{keyPath:'requestId'});
   if(!drafts.indexNames.contains(scopeIndex))drafts.createIndex(scopeIndex,'scopeKey',{unique:false});
   if(!database.objectStoreNames.contains(cacheStoreName))database.createObjectStore(cacheStoreName,{keyPath:'key'});
  };
  request.onerror=()=>reject(storageError('Não foi possível abrir o armazenamento offline.'));
  request.onblocked=()=>reject(storageError('Feche outras abas do aplicativo para atualizar o armazenamento offline.'));
  request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result);};
 });
}

async function transaction<T>(storeName:string,mode:IDBTransactionMode,work:(store:IDBObjectStore)=>IDBRequest<T>,failure:string):Promise<T>{
 const database=await openDatabase();
 return new Promise((resolve,reject)=>{
  const tx=database.transaction(storeName,mode);let request:IDBRequest<T>;
  try{request=work(tx.objectStore(storeName));}catch{database.close();reject(storageError(failure));return;}
  tx.oncomplete=()=>{database.close();resolve(request.result);};
  tx.onabort=()=>{database.close();reject(storageError(failure));};
  tx.onerror=()=>{/* transaction abort is authoritative */};
 });
}

function validReceipt(value:unknown):value is StoredExpenseReceipt{
 if(!value||typeof value!=='object')return false;const receipt=value as Partial<StoredExpenseReceipt>;
 return receipt.blob instanceof Blob&&typeof receipt.name==='string'&&typeof receipt.type==='string'&&typeof receipt.lastModified==='number';
}

function validDraft(value:unknown,tenantId:string,actorId:string):value is DriverExpenseOfflineDraft{
 if(!value||typeof value!=='object')return false;const draft=value as Partial<DriverExpenseOfflineDraft>;const payload=expenseCreationSchema.safeParse(draft.payload);
 return draft.version===1&&draft.tenantId===tenantId&&draft.actorId===actorId&&draft.scopeKey===driverExpenseScope(tenantId,actorId)
  &&typeof draft.requestId==='string'&&payload.success&&payload.data.request_id===draft.requestId&&payload.data.tenant_id===tenantId&&payload.data.actor_id===actorId
  &&payload.data.source_type==='trip'&&!!payload.data.receipt&&validReceipt(draft.receipt)
  &&payload.data.receipt.size===draft.receipt.blob.size&&payload.data.receipt.mime===draft.receipt.type
  &&['queued','needs_attention'].includes(String(draft.state))&&(draft.lastError===null||typeof draft.lastError==='string')
  &&(draft.uploadFailures===undefined||(Number.isInteger(draft.uploadFailures)&&draft.uploadFailures>=0))
  &&typeof draft.createdAt==='string'&&typeof draft.updatedAt==='string';
}

function emptyCache(tenantId:string,actorId:string):DriverExpenseOfflineCache{return {version:1,key:cacheKey(tenantId,actorId),scopeKey:driverExpenseScope(tenantId,actorId),tenantId,actorId,sources:[],contexts:{},updatedAt:new Date().toISOString()};}
function validSource(value:unknown):value is DriverExpenseSource{
 if(!value||typeof value!=='object')return false;const source=value as Partial<DriverExpenseSource>;
 return typeof source.id==='string'&&uuidPattern.test(source.id)&&typeof source.driver_id==='string'&&uuidPattern.test(source.driver_id)&&['planned','in_transit','completed'].includes(String(source.status))
  &&(source.notes===null||typeof source.notes==='string')&&typeof source.created_at==='string'&&(source.actual_start_at===null||typeof source.actual_start_at==='string')&&(source.actual_end_at===null||typeof source.actual_end_at==='string');
}
function validCache(value:unknown,tenantId:string,actorId:string):value is DriverExpenseOfflineCache{
 if(!value||typeof value!=='object')return false;const cache=value as Partial<DriverExpenseOfflineCache>;
 return cache.version===1&&cache.key===cacheKey(tenantId,actorId)&&cache.scopeKey===driverExpenseScope(tenantId,actorId)&&cache.tenantId===tenantId&&cache.actorId===actorId
  &&Array.isArray(cache.sources)&&cache.sources.every(validSource)&&!!cache.contexts&&typeof cache.contexts==='object'&&!Array.isArray(cache.contexts)&&typeof cache.updatedAt==='string'
  &&Number.isFinite(Date.parse(cache.updatedAt))&&Date.now()-Date.parse(cache.updatedAt)<=maxCacheAgeMs
  &&Object.entries(cache.contexts).every(([sourceId,context])=>{try{return parseCreationContext(context,tenantId,actorId,'trip',sourceId).source_id===sourceId;}catch{return false;}});
}

async function readLegacyCache(tenantId:string,actorId:string){const value=await transaction(cacheStoreName,'readonly',store=>store.get(cacheKey(tenantId,actorId)),'Não foi possível consultar as viagens salvas.');
 if(value===undefined)return emptyCache(tenantId,actorId);if(!validCache(value,tenantId,actorId))throw storageError('Há dados de viagem incompatíveis com esta sessão.');return value;}

export function storeExpenseReceipt(file:File,type=file.type):StoredExpenseReceipt{return {blob:file,name:file.name,type,lastModified:file.lastModified};}
export function restoreExpenseReceipt(receipt:StoredExpenseReceipt):File{return new File([receipt.blob],receipt.name,{type:receipt.type,lastModified:receipt.lastModified});}

const legacyDriverExpenseOfflineStore:DriverExpenseOfflineStore={
 async save(draft){if(!validDraft(draft,draft.tenantId,draft.actorId))throw storageError('Os dados da despesa offline são inválidos.');await transaction(draftStoreName,'readwrite',store=>store.put(draft),'Não foi possível salvar a despesa no aparelho.');},
 async list(tenantId,actorId){const values=await transaction(draftStoreName,'readonly',store=>store.index(scopeIndex).getAll(driverExpenseScope(tenantId,actorId)),'Não foi possível consultar as despesas pendentes.');
  if(!Array.isArray(values)||!values.every(value=>validDraft(value,tenantId,actorId)))throw storageError('Há uma despesa offline incompatível com esta sessão.');return values.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));},
 async remove(requestId){await transaction(draftStoreName,'readwrite',store=>store.delete(requestId),'Não foi possível concluir a limpeza da despesa sincronizada.');},
 async saveSources(tenantId,actorId,sources){const cache=await readLegacyCache(tenantId,actorId);await transaction(cacheStoreName,'readwrite',store=>store.put({...cache,sources:structuredClone(sources),updatedAt:new Date().toISOString()}),'Não foi possível salvar as viagens para uso offline.');},
 async readSources(tenantId,actorId){return structuredClone((await readLegacyCache(tenantId,actorId)).sources);},
 async saveContext(tenantId,actorId,context){if(context.tenant_id!==tenantId||context.actor_id!==actorId||context.source_type!=='trip')throw storageError('O contexto da despesa não pertence a esta sessão.');const cache=await readLegacyCache(tenantId,actorId);
  await transaction(cacheStoreName,'readwrite',store=>store.put({...cache,contexts:{...cache.contexts,[context.source_id]:structuredClone(context)},updatedAt:new Date().toISOString()}),'Não foi possível salvar o contexto da viagem.');},
 async readContext(tenantId,actorId,sourceId){const value=(await readLegacyCache(tenantId,actorId)).contexts[sourceId];return value?structuredClone(value):null;},
};

const expenseFile=(receipt:StoredExpenseReceipt):DriverOfflineFile=>({slot:'receipt',blob:receipt.blob,name:receipt.name,type:receipt.type,lastModified:receipt.lastModified});
const storedReceipt=(file:DriverOfflineFile):StoredExpenseReceipt=>({blob:file.blob,name:file.name,type:file.type,lastModified:file.lastModified});
function expenseEnvelope(draft:DriverExpenseOfflineDraft):DriverOfflineEnvelope<Json>{return {version:1,id:draft.requestId,
 scopeKey:driverOfflineScope(draft.tenantId,draft.actorId),tenantId:draft.tenantId,actorId:draft.actorId,kind:'expense',aggregateId:draft.payload.source_id,
 state:draft.state,payload:draft.payload as unknown as Json,files:[expenseFile(draft.receipt)],attempts:0,uploadFailures:draft.uploadFailures??0,lastError:draft.lastError,
 createdAt:draft.createdAt,updatedAt:draft.updatedAt};}
function expenseDraft(record:DriverOfflineEnvelope):DriverExpenseOfflineDraft{
 const payload=expenseCreationSchema.parse(record.payload),file=record.files.find(item=>item.slot==='receipt');if(!file)throw storageError('O comprovante da despesa está ausente.');
 return {version:1,requestId:record.id,scopeKey:driverExpenseScope(record.tenantId,record.actorId),tenantId:record.tenantId,actorId:record.actorId,
  payload,receipt:storedReceipt(file),state:record.state==='needs_attention'?'needs_attention':'queued',uploadFailures:record.uploadFailures??0,
  lastError:record.lastError,createdAt:record.createdAt,updatedAt:record.updatedAt};
}

async function saveUnifiedCache(cache:DriverExpenseOfflineCache){const cachedAt=new Date(cache.updatedAt),id=cacheKey(cache.tenantId,cache.actorId);
 await driverOfflineSnapshotStore.put({version:1,id,scopeKey:driverOfflineScope(cache.tenantId,cache.actorId),tenantId:cache.tenantId,actorId:cache.actorId,
  tripId:'expense-contexts',payload:cache as unknown as Json,cachedAt:cache.updatedAt,expiresAt:new Date(cachedAt.getTime()+maxCacheAgeMs).toISOString()});}
async function readUnifiedCache(tenantId:string,actorId:string){const id=cacheKey(tenantId,actorId),record=await driverOfflineSnapshotStore.read(id);
 if(record&&new Date(record.expiresAt)>new Date()){const cache=record.payload as unknown as DriverExpenseOfflineCache;if(validCache(cache,tenantId,actorId))return cache;}
 if(record)await driverOfflineSnapshotStore.remove(id);
 try{const legacy=await readLegacyCache(tenantId,actorId);if(legacy.sources.length||Object.keys(legacy.contexts).length)await saveUnifiedCache(legacy);return legacy;}
 catch{return emptyCache(tenantId,actorId);}}

export const driverExpenseOfflineStore:DriverExpenseOfflineStore={
 async save(draft){if(!validDraft(draft,draft.tenantId,draft.actorId))throw storageError('Os dados da despesa offline são inválidos.');await driverOfflineOutbox.put(expenseEnvelope(draft));},
 async list(tenantId,actorId){const unified=(await driverOfflineOutbox.list(tenantId,actorId,'expense')).map(expenseDraft);let legacy:DriverExpenseOfflineDraft[]=[];
  try{legacy=await legacyDriverExpenseOfflineStore.list(tenantId,actorId);}catch{/* legacy database is optional after migration */}
  const ids=new Set(unified.map(row=>row.requestId));for(const draft of legacy){if(ids.has(draft.requestId))continue;await driverOfflineOutbox.put(expenseEnvelope(draft));
   await legacyDriverExpenseOfflineStore.remove(draft.requestId).catch(()=>undefined);unified.push(draft);}return unified.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));},
 async remove(requestId){await driverOfflineOutbox.remove(requestId);await legacyDriverExpenseOfflineStore.remove(requestId).catch(()=>undefined);},
 async saveSources(tenantId,actorId,sources){const cache=await readUnifiedCache(tenantId,actorId);await saveUnifiedCache({...cache,sources:structuredClone(sources),updatedAt:new Date().toISOString()});},
 async readSources(tenantId,actorId){return structuredClone((await readUnifiedCache(tenantId,actorId)).sources);},
 async saveContext(tenantId,actorId,context){if(context.tenant_id!==tenantId||context.actor_id!==actorId||context.source_type!=='trip')throw storageError('O contexto da despesa não pertence a esta sessão.');
  const cache=await readUnifiedCache(tenantId,actorId);await saveUnifiedCache({...cache,contexts:{...cache.contexts,[context.source_id]:structuredClone(context)},updatedAt:new Date().toISOString()});},
 async readContext(tenantId,actorId,sourceId){const value=(await readUnifiedCache(tenantId,actorId)).contexts[sourceId];return value?structuredClone(value):null;},
};

/** Removes cached trip/context data for an actor while preserving durable drafts. */
export async function clearDriverExpenseOfflineCaches(actorId:string|undefined):Promise<number>{
 if(!actorId||typeof indexedDB==='undefined')return 0;
 let rows:unknown[];
 try{rows=await transaction(cacheStoreName,'readonly',store=>store.getAll(),'Não foi possível localizar os caches antigos.');}
 catch{return 0;}
 const actorRows=rows.filter(value=>!!value&&typeof value==='object'&&(value as Partial<DriverExpenseOfflineCache>).actorId===actorId) as DriverExpenseOfflineCache[];
 for(const row of actorRows)await transaction(cacheStoreName,'readwrite',store=>store.delete(row.key),'Não foi possível limpar os caches antigos.');
 return actorRows.length;
}

export function createMemoryDriverExpenseOfflineStore():DriverExpenseOfflineStore{
 const drafts=new Map<string,DriverExpenseOfflineDraft>(),caches=new Map<string,DriverExpenseOfflineCache>();
 const cache=(tenant:string,actor:string)=>caches.get(cacheKey(tenant,actor))??emptyCache(tenant,actor);
 const cloneDraft=(draft:DriverExpenseOfflineDraft):DriverExpenseOfflineDraft=>({...draft,payload:structuredClone(draft.payload),receipt:{...draft.receipt,blob:draft.receipt.blob}});
 return {
  async save(draft){drafts.set(draft.requestId,cloneDraft(draft));},async list(tenant,actor){return [...drafts.values()].filter(row=>row.scopeKey===driverExpenseScope(tenant,actor)).map(cloneDraft);},async remove(id){drafts.delete(id);},
  async saveSources(tenant,actor,sources){caches.set(cacheKey(tenant,actor),{...cache(tenant,actor),sources:structuredClone(sources),updatedAt:new Date().toISOString()});},async readSources(tenant,actor){return structuredClone(cache(tenant,actor).sources);},
  async saveContext(tenant,actor,context){const current=cache(tenant,actor);caches.set(cacheKey(tenant,actor),{...current,contexts:{...current.contexts,[context.source_id]:structuredClone(context)},updatedAt:new Date().toISOString()});},async readContext(tenant,actor,source){return structuredClone(cache(tenant,actor).contexts[source]??null);},
 };
}
