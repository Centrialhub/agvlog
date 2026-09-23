import {z} from 'zod';
import {
  payableBulkCommandSchema,
  payableBulkContextSchema,
  payableBulkResultSchema,
  payableBulkStorageKey,
  type PayableBulkCommand,
  type PayableBulkResult,
} from './payableBulkSettlementContract';

const uuid=z.string().uuid();
const requestSchema=z.object({command:payableBulkCommandSchema,context:payableBulkContextSchema}).strict().superRefine((value,ctx)=>{
  const {command,context}=value;
  if(command.tenant_id!==context.tenant_id||command.movement_id!==context.movement.id||command.bank_account_id!==context.movement.bank_account_id||command.paid_on!==context.movement.occurred_on||command.expected_revision!==context.expected_revision)ctx.addIssue({code:'custom',message:'Pedido de baixa incompatível com a prévia.'});
  if(command.items.length!==context.items.length||command.items.some(item=>!context.items.some(row=>row.payable_id===item.payable_id&&row.amount_cents===item.amount_cents)))ctx.addIssue({code:'custom',message:'Itens da baixa incompatíveis com a prévia.'});
});
export type PayableBulkSettlementRequest=z.infer<typeof requestSchema>;
const pendingSchema=z.object({version:z.literal(1),tenantId:uuid,actorId:uuid,payload:requestSchema}).strict();
export type PendingPayableBulkSettlement=z.infer<typeof pendingSchema>;
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
const unavailable=()=>new Error('O pedido de baixa em lote salvo está indisponível ou incompatível. Preserve os dados antes de iniciar outra operação.');

export function pendingPayableBulkSettlement(storage:Store,tenant:string,actor:string):PendingPayableBulkSettlement|null{
  try{
    uuid.parse(tenant);uuid.parse(actor);
    const raw=storage.getItem(payableBulkStorageKey(tenant,actor));
    if(raw===null)return null;
    if(raw.length>200000)throw unavailable();
    const original=JSON.parse(raw),row=pendingSchema.parse(original);
    if(row.tenantId!==tenant||row.actorId!==actor||row.payload.command.tenant_id!==tenant||row.payload.context.tenant_id!==tenant||row.payload.context.actor_id!==actor)throw unavailable();
    return original as PendingPayableBulkSettlement;
  }catch{throw unavailable();}
}

const fallbackLocks=new Map<string,Promise<void>>();
export async function lockPayableBulkSettlement<T>(key:string,work:()=>Promise<T>):Promise<T>{
  if(typeof navigator!=='undefined'&&navigator.locks)return navigator.locks.request(key,work);
  const prior=fallbackLocks.get(key)??Promise.resolve();
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const tail=prior.catch(()=>{}).then(()=>gate);
  fallbackLocks.set(key,tail);
  await prior.catch(()=>{});
  try{return await work();}
  finally{release();if(fallbackLocks.get(key)===tail)fallbackLocks.delete(key);}
}

interface Dependencies{
  storage:Store;
  assertContext:(tenant:string,actor:string)=>void;
  changed:()=>void;
  lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;
  send:(command:PayableBulkCommand,actor:string)=>Promise<PayableBulkResult>;
  isDefinitive:(error:unknown)=>boolean;
}

export function createPayableBulkSettlementOutbox(deps:Dependencies){
  let flight:{identity:string;promise:Promise<PayableBulkResult>}|null=null;
  const notify=()=>{try{deps.changed();}catch{/* Notification must not change the confirmed outcome. */}};
  function run(tenant:string,actor:string,request?:PayableBulkSettlementRequest):Promise<PayableBulkResult>{
    let parsed:PayableBulkSettlementRequest|undefined;
    try{
      uuid.parse(tenant);uuid.parse(actor);if(request!==undefined){requestSchema.parse(request);parsed=request;}
      if(parsed&&(parsed.command.tenant_id!==tenant||parsed.context.tenant_id!==tenant||parsed.context.actor_id!==actor))throw unavailable();
    }catch(error){return Promise.reject(error);}
    const identity=JSON.stringify([tenant,actor,parsed??null]);
    if(flight)return flight.identity===identity?flight.promise:Promise.reject(new Error('Outra baixa em lote está em andamento. Aguarde o resultado do pedido original.'));
    const key=payableBulkStorageKey(tenant,actor);
    const promise=Promise.resolve().then(()=>deps.lock(key,async()=>{
      deps.assertContext(tenant,actor);
      const observedRaw=deps.storage.getItem(key),found=pendingPayableBulkSettlement(deps.storage,tenant,actor);
      if(deps.storage.getItem(key)!==observedRaw)throw unavailable();
      let row=found;
      if(row&&parsed)throw new Error('Há uma baixa em lote sem confirmação. Recupere o pedido existente antes de iniciar outra.');
      if(!row){if(!parsed)throw new Error('Nenhuma baixa em lote pendente para esta sessão.');row={version:1,tenantId:tenant,actorId:actor,payload:parsed};}
      const raw=found?observedRaw:JSON.stringify(row);
      if(raw===null)throw unavailable();
      if(!found){if(deps.storage.getItem(key)!==null)throw unavailable();deps.storage.setItem(key,raw);notify();}
      // Detect writers that do not share this lock before sending or deleting anything.
      if(deps.storage.getItem(key)!==raw)throw unavailable();
      const forget=()=>{try{if(deps.storage.getItem(key)===raw)deps.storage.removeItem(key);}finally{notify();}};
      try{
        deps.assertContext(tenant,actor);
        const result=payableBulkResultSchema.parse(await deps.send(row.payload.command,actor));
        deps.assertContext(tenant,actor);
        const command=row.payload.command;
        if(result.tenant_id!==tenant||result.actor_id!==actor||result.request_id!==command.request_id||result.movement_id!==command.movement_id||result.bank_account_id!==command.bank_account_id||result.paid_on!==command.paid_on||result.rows.length!==command.items.length||result.rows.some(item=>!command.items.some(row=>row.payable_id===item.payable_id&&row.amount_cents===item.amount_cents)))throw new Error('Resposta incompatível com o pedido de baixa em lote preservado.');
        try{forget();}catch{/* A confirmed result remains confirmed; stored replay stays available. */}
        return result;
      }catch(error){
        if(deps.isDefinitive(error)){try{forget();}catch{/* Preserve storage if cleanup fails. */}}
        throw error;
      }
    }));
    flight={identity,promise};
    void promise.finally(()=>{if(flight?.promise===promise)flight=null;notify();}).catch(()=>{});
    return promise;
  }
  return {submit:(tenant:string,actor:string,request:PayableBulkSettlementRequest)=>run(tenant,actor,request),recover:(tenant:string,actor:string)=>run(tenant,actor)};
}
