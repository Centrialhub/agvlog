import {z} from 'zod';
import {customerCreditCommandSchema,customerCreditResultSchema,parseCustomerCreditResult} from './customerCreditContract';
const uuid=z.string().uuid();
const inputSchema=customerCreditCommandSchema.innerType().omit({version:true,tenant_id:true,request_id:true}).refine(v=>(v.action==='apply')===(v.application_id===null));
export type CustomerCreditInput=z.infer<typeof inputSchema>;
type Command=z.infer<typeof customerCreditCommandSchema>;
type Result=z.infer<typeof customerCreditResultSchema>;
const pendingSchema=z.object({version:z.literal(1),tenantId:uuid,actorId:uuid,payload:customerCreditCommandSchema}).strict();
export type PendingCustomerCredit=z.infer<typeof pendingSchema>;
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const customerCreditKey=(tenant:string,actor:string)=>`agvlog:customer-credit:v1:${tenant}:${actor}`;
const unavailable=()=>new Error('O pedido de operação de crédito salvo está indisponível ou incompatível. Preserve os dados antes de iniciar outra operação.');
export function pendingCustomerCredit(storage:Store,tenant:string,actor:string):PendingCustomerCredit|null{
 try{uuid.parse(tenant);uuid.parse(actor);const raw=storage.getItem(customerCreditKey(tenant,actor));if(raw===null)return null;if(raw.length>20000)throw unavailable();const original=JSON.parse(raw),row=pendingSchema.parse(original);if(row.tenantId!==tenant||row.actorId!==actor||row.payload.tenant_id!==tenant)throw unavailable();return original as PendingCustomerCredit;}catch{throw unavailable();}
}
export async function lockCustomerCredit<T>(key:string,work:()=>Promise<T>):Promise<T>{if(typeof navigator==='undefined'||!navigator.locks)throw new Error('Não foi possível proteger o pedido entre abas. Nenhuma operação de crédito foi enviada.');return navigator.locks.request(key,work);}
interface Dependencies{storage:Store;uuid:()=>string;assertContext:(tenant:string,actor:string)=>void;changed:()=>void;lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;send:(payload:Command)=>Promise<{data:unknown;error:unknown}>}
const isDefinitive=(error:unknown)=>{const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';return /^(22|23)/.test(code)||['40001','40P01','55P03','42501','55000'].includes(code);};
export function createCustomerCreditOutbox(deps:Dependencies){
 let flight:{identity:string;promise:Promise<Result>}|null=null;
 const notify=()=>{try{deps.changed();}catch{/* Notification must not change the confirmed outcome. */}};
 function run(tenant:string,actor:string,input?:CustomerCreditInput):Promise<Result>{
  let parsed:CustomerCreditInput|undefined;try{uuid.parse(tenant);uuid.parse(actor);parsed=input===undefined?undefined:inputSchema.parse(input);}catch(error){return Promise.reject(error);}
  const identity=JSON.stringify([tenant,actor,parsed??null]);
  if(flight)return flight.identity===identity?flight.promise:Promise.reject(new Error('Outra operação de crédito está em andamento. Aguarde o resultado do pedido original.'));
  const key=customerCreditKey(tenant,actor);
  const promise=Promise.resolve().then(()=>deps.lock(key,async()=>{
   deps.assertContext(tenant,actor);const observedRaw=deps.storage.getItem(key);const found=pendingCustomerCredit(deps.storage,tenant,actor);if(deps.storage.getItem(key)!==observedRaw)throw unavailable();let row=found;const uncertain=found!==null;
   if(row&&parsed)throw new Error('Há uma operação de crédito sem confirmação. Recupere o pedido existente antes de iniciar outra.');
   if(!row){if(!parsed)throw new Error('Nenhuma operação de crédito pendente para esta sessão.');row={version:1,tenantId:tenant,actorId:actor,payload:customerCreditCommandSchema.parse({...parsed,version:1,tenant_id:tenant,request_id:deps.uuid()})};}
   const raw=found?observedRaw:JSON.stringify(row);
   if(raw===null)throw unavailable();
   if(!found){if(deps.storage.getItem(key)!==null)throw unavailable();deps.storage.setItem(key,raw);notify();}
   // Detect writers that do not share our lock before sending or deleting anything.
   if(deps.storage.getItem(key)!==raw)throw unavailable();
   const forget=()=>{try{if(deps.storage.getItem(key)===raw)deps.storage.removeItem(key);}finally{notify();}};
   deps.assertContext(tenant,actor);const {data,error}=await deps.send(row.payload);deps.assertContext(tenant,actor);
   if(error){if(!uncertain&&isDefinitive(error)){try{forget();}catch{/* Preserve storage if cleanup fails. */}}throw error;}
   const result=parseCustomerCreditResult(data,row.payload,actor);
   if(result.tenant_id!==tenant||result.actor_id!==actor||result.request_id!==row.payload.request_id||result.credit_id!==row.payload.credit_id||result.receivable_id!==row.payload.receivable_id)throw new Error('Resposta incompatível com o pedido de operação de crédito preservado.');
   try{forget();}catch{/* A confirmed result remains confirmed; stored replay stays available. */}return result;
  }));
  flight={identity,promise};void promise.finally(()=>{if(flight?.promise===promise)flight=null;notify();}).catch(()=>{});return promise;
 }
 return {submit:(tenant:string,actor:string,input:CustomerCreditInput)=>run(tenant,actor,input),recover:(tenant:string,actor:string)=>run(tenant,actor)};
}
