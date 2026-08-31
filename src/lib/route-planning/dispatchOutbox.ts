import type { Json } from '@/integrations/supabase/types';

export interface DispatchWirePayload {
  tenant_id:string; vehicle_id:string; driver_id:string; planned_start_at:string; route_name:string;
  load_ids:string[]; stops:Json[]; planning_draft_id:string|null;
}
export interface PendingDispatch {
  version:1; tenantId:string; actorId:string; scope:string; requestId:string; createdAt:string;
  payload:DispatchWirePayload;
}
export interface DispatchOutboxDependencies {
  storage:Storage;
  lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;
  send:(payload:DispatchWirePayload & {idempotency_key:string})=>Promise<{data:unknown;error:unknown}>;
  uuid:()=>string;
  changed?:()=>void;
  assertContext?:()=>void;
}
export const DISPATCH_OUTBOX_CHANGED='agvlog:dispatch-outbox-changed';
const prefix='agvlog:dispatch:v1:';
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const accountPrefix=(tenant:string,actor:string)=>`${prefix}${encodeURIComponent(tenant)}:${encodeURIComponent(actor)}:`;
const storageError=()=>new Error('Não foi possível acessar a recuperação local do despacho. Verifique o armazenamento deste navegador; nenhum novo envio será iniciado.');
export const pendingDispatchError=()=>Object.assign(new Error('Há um despacho sem confirmação. Use “Recuperar despacho” antes de alterar ou reenviar esta rota.'),{code:'DISPATCH_PENDING'});

function read(storage:Storage,key:string):PendingDispatch|null {
  try {
    const raw=storage.getItem(key);if(!raw)return null;
    const item=JSON.parse(raw) as PendingDispatch;
    if(item.version!==1 || !uuidPattern.test(item.requestId) || typeof item.scope!=='string' || !item.payload
      || item.payload.tenant_id!==item.tenantId || key!==accountPrefix(item.tenantId,item.actorId)+encodeURIComponent(item.scope)
      || !Array.isArray(item.payload.load_ids) || !item.payload.load_ids.every(id=>typeof id==='string')
      || !Array.isArray(item.payload.stops) || typeof item.payload.route_name!=='string')throw storageError();
    return item;
  }catch{throw storageError();}
}

export function pendingDispatches(storage:Storage,tenant:string,actor:string):PendingDispatch[]{
  try {
    const items:PendingDispatch[]=[];const account=accountPrefix(tenant,actor);
    for(let n=0;n<storage.length;n++){
      const key=storage.key(n);if(!key?.startsWith(account))continue;
      const item=read(storage,key);if(item)items.push(item);
    }
    return items.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  }catch{throw storageError();}
}

// The database, not browser storage, authorizes and deduplicates each request.
// Persist only the wire request required for exact replay; no credentials, user
// profiles, invoice XML or attachments. Remove it once success/rollback is known.
export function createDispatchOutbox(deps:DispatchOutboxDependencies){
  const inflight=new Map<string,Promise<string>>();
  function perform(tenant:string,actor:string,scope:string,payload?:DispatchWirePayload):Promise<string>{
    const key=accountPrefix(tenant,actor)+encodeURIComponent(scope);
    if(inflight.has(key))return inflight.get(key)!;
    const promise=deps.lock(key,async()=>{
      deps.assertContext?.();
      let item=read(deps.storage,key);const previouslyUnconfirmed=Boolean(item);
      if(item && payload)throw pendingDispatchError(); // Replay is an explicit action with the frozen body.
      if(!item){
        if(!payload)throw new Error('Não há despacho pendente neste navegador. Atualize os dados.');
        if(!scope || payload.tenant_id!==tenant)throw new Error('Contexto de despacho inválido.');
        item={version:1,tenantId:tenant,actorId:actor,scope,requestId:deps.uuid(),createdAt:new Date().toISOString(),
          payload:JSON.parse(JSON.stringify(payload)) as DispatchWirePayload};
        try{deps.storage.setItem(key,JSON.stringify(item));}catch{throw storageError();}
        deps.changed?.();
      }
      const forget=()=>{try{deps.storage.removeItem(key);}catch{/* Keep replayable request if cleanup fails. */}deps.changed?.();};
      try {
        deps.assertContext?.();
        const {data,error}=await deps.send({...item.payload,idempotency_key:item.requestId});
        if(error){
          const code=typeof error==='object' && 'code' in error && typeof error.code==='string'?error.code:'';
          // A later failure (including revoked access) cannot disprove an earlier
          // unknown commit. Only the first, definite SQL rollback releases edits.
          if(!previouslyUnconfirmed && /^(22|23)|^(40001|40P01|55P03|42501)$/.test(code))forget();
          const message=typeof error==='object' && 'message' in error && typeof error.message==='string'?error.message:'Falha ao despachar.';
          throw Object.assign(new Error(message),{code});
        }
        if(typeof data!=='string' || !uuidPattern.test(data))throw new Error('O servidor não confirmou o identificador da viagem. Use “Recuperar despacho”.');
        deps.assertContext?.();
        forget();return data;
      }catch(error){
        deps.changed?.();throw error;
      }
    });
    inflight.set(key,promise);
    void promise.finally(()=>{if(inflight.get(key)===promise)inflight.delete(key);}).catch(()=>{});
    return promise;
  }
  return {dispatch:(tenant:string,actor:string,scope:string,payload:DispatchWirePayload)=>perform(tenant,actor,scope,payload),
    recover:(tenant:string,actor:string,scope:string)=>perform(tenant,actor,scope)};
}
