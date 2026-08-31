import {closingDraftSchema,parseClosingCreation,type ClosingDraftInput,type ClosingDraftPayload,type ClosingCreationResult} from './closingDraft';
import {isRecord} from '@/lib/loads/operationDocumentOutcome';
export const CLOSING_DRAFT_CHANGED='agvlog:closing-draft-changed';
export interface PendingClosingDraft {version:1;tenantId:string;actorId:string;createdAt:string;payload:ClosingDraftPayload}
const keyFor=(tenant:string,actor:string)=>`agvlog:closing-draft:v1:${encodeURIComponent(tenant)}:${encodeURIComponent(actor)}`;
const unavailable=()=>new Error('Recuperação do fechamento indisponível ou incompatível. Nenhum novo pedido foi enviado.');
export function pendingClosingDraft(storage:Storage,tenant:string,actor:string):PendingClosingDraft|null{
 try{
  const suffix=`:${encodeURIComponent(tenant)}:${encodeURIComponent(actor)}`;
  for(let index=0;index<storage.length;index++){const key=storage.key(index);if(key?.startsWith('agvlog:closing-draft:')&&key.endsWith(suffix)&&key!==keyFor(tenant,actor))throw unavailable();}
  const raw=storage.getItem(keyFor(tenant,actor));if(!raw)return null;const row:unknown=JSON.parse(raw);
  if(!isRecord(row)||row.version!==1||row.tenantId!==tenant||row.actorId!==actor||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt)))throw unavailable();
  const parsed=closingDraftSchema.safeParse(row.payload);if(!parsed.success||parsed.data.tenant_id!==tenant||parsed.data.actor_id!==actor)throw unavailable();
  return {...row,payload:parsed.data} as PendingClosingDraft;
 }catch{throw unavailable();}
}
interface Dependencies {storage:Storage;uuid:()=>string;assertContext:()=>void;changed:()=>void;
 lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;send:(payload:ClosingDraftPayload)=>Promise<{data:unknown;error:unknown}>}
export function createClosingDraftOutbox(deps:Dependencies){
 let inFlight:Promise<ClosingCreationResult>|null=null;
 function run(tenant:string,actor:string,input?:ClosingDraftInput){
  if(inFlight)return inFlight;const key=keyFor(tenant,actor);
  const work=deps.lock(key,async()=>{
   deps.assertContext();let row=pendingClosingDraft(deps.storage,tenant,actor);const uncertainBefore=!!row;
   if(row&&input)throw new Error('Há fechamento sem confirmação. Recupere o pedido existente antes de criar outro.');
   if(!row){
    if(!input)throw new Error('Nenhum fechamento pendente nesta sessão.');
    const payload=closingDraftSchema.parse({...input,version:1,tenant_id:tenant,actor_id:actor,request_id:deps.uuid()});
    row={version:1,tenantId:tenant,actorId:actor,createdAt:new Date().toISOString(),payload};
    try{deps.storage.setItem(key,JSON.stringify(row));}catch{throw unavailable();}deps.changed();
   }
   const forget=()=>{try{deps.storage.removeItem(key);}catch{/* An exact durable replay remains safe. */}deps.changed();};
   deps.assertContext();const {data,error}=await deps.send(row.payload);deps.assertContext();
   if(error){const code=isRecord(error)?String(error.code??''):'';
    if(!uncertainBefore&&(/^(22|23)/.test(code)||['40001','40P01','55P03','42501'].includes(code)))forget();throw error;}
   const result=parseClosingCreation(data,row.payload);forget();return result;
  });inFlight=work;void work.finally(()=>{if(inFlight===work)inFlight=null;deps.changed();}).catch(()=>{});return work;
 }
 return {submit:(tenant:string,actor:string,input:ClosingDraftInput)=>run(tenant,actor,input),recover:(tenant:string,actor:string)=>run(tenant,actor)};
}
