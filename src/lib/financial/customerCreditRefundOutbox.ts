import {z} from 'zod';
import {customerCreditRefundExpectedSchema,customerCreditRefundCommandSchema,customerCreditRefundResultSchema,parseCustomerCreditRefundResult} from './customerCreditRefundContract';
const uuid=z.string().uuid();
const inputSchema=customerCreditRefundCommandSchema.omit({version:true,tenant_id:true,request_id:true}).extend({expected:customerCreditRefundExpectedSchema}).refine(v=>v.amount_cents===v.expected.effects.amount_cents);
export type CustomerCreditRefundInput=z.infer<typeof inputSchema>;
type Command=z.infer<typeof customerCreditRefundCommandSchema>;
type Result=z.infer<typeof customerCreditRefundResultSchema>;
const pendingSchema=z.object({version:z.literal(1),tenantId:uuid,actorId:uuid,expected:customerCreditRefundExpectedSchema,payload:customerCreditRefundCommandSchema}).strict();
export type PendingCustomerCreditRefund=z.infer<typeof pendingSchema>;
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const customerCreditRefundKey=(tenant:string,actor:string)=>`agvlog:customer-credit-refund:v1:${tenant}:${actor}`;
const unavailable=()=>new Error('O pedido de vinculação de devolução salvo está indisponível ou incompatível. Preserve os dados antes de iniciar outra operação.');
export function pendingCustomerCreditRefund(storage:Store,tenant:string,actor:string):PendingCustomerCreditRefund|null{
 try{uuid.parse(tenant);uuid.parse(actor);const raw=storage.getItem(customerCreditRefundKey(tenant,actor));if(raw===null)return null;if(raw.length>20000)throw unavailable();const original=JSON.parse(raw),row=pendingSchema.parse(original);if(row.tenantId!==tenant||row.actorId!==actor||row.payload.tenant_id!==tenant)throw unavailable();return original as PendingCustomerCreditRefund;}catch{throw unavailable();}
}
export async function lockCustomerCreditRefund<T>(key:string,work:()=>Promise<T>):Promise<T>{if(typeof navigator==='undefined'||!navigator.locks)throw new Error('Não foi possível proteger o pedido entre abas. Nenhuma vinculação de devolução foi enviada.');return navigator.locks.request(key,work);}
interface Dependencies{storage:Store;uuid:()=>string;assertContext:(tenant:string,actor:string)=>void;changed:()=>void;lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;send:(payload:Command)=>Promise<{data:unknown;error:unknown}>}
const isDefinitive=(error:unknown)=>{const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';return /^(22|23)/.test(code)||['40001','40P01','55P03','42501','55000'].includes(code);};
export function createCustomerCreditRefundOutbox(deps:Dependencies){
 let flight:{identity:string;promise:Promise<Result>}|null=null;
 const notify=()=>{try{deps.changed();}catch{/* Notification must not change the confirmed outcome. */}};
 function run(tenant:string,actor:string,input?:CustomerCreditRefundInput):Promise<Result>{
  let parsed:CustomerCreditRefundInput|undefined;try{uuid.parse(tenant);uuid.parse(actor);parsed=input===undefined?undefined:inputSchema.parse(input);}catch(error){return Promise.reject(error);}
  const identity=JSON.stringify([tenant,actor,parsed??null]);
  if(flight)return flight.identity===identity?flight.promise:Promise.reject(new Error('Outra vinculação de devolução está em andamento. Aguarde o resultado do pedido original.'));
  const key=customerCreditRefundKey(tenant,actor);
  const promise=Promise.resolve().then(()=>deps.lock(key,async()=>{
   deps.assertContext(tenant,actor);const observedRaw=deps.storage.getItem(key);const found=pendingCustomerCreditRefund(deps.storage,tenant,actor);if(deps.storage.getItem(key)!==observedRaw)throw unavailable();let row=found;const uncertain=found!==null;
   if(row&&parsed)throw new Error('Há uma vinculação de devolução sem confirmação. Recupere o pedido existente antes de iniciar outra.');
   if(!row){if(!parsed)throw new Error('Nenhuma vinculação de devolução pendente para esta sessão.');row={version:1,tenantId:tenant,actorId:actor,expected:parsed.expected,payload:customerCreditRefundCommandSchema.parse({version:1,tenant_id:tenant,request_id:deps.uuid(),credit_id:parsed.credit_id,outgoing_movement_id:parsed.outgoing_movement_id,amount_cents:parsed.amount_cents,expected_revision:parsed.expected_revision,reason:parsed.reason})};}
   const raw=found?observedRaw:JSON.stringify(row);
   if(raw===null)throw unavailable();
   if(!found){if(deps.storage.getItem(key)!==null)throw unavailable();deps.storage.setItem(key,raw);notify();}
   // Detect writers that do not share our lock before sending or deleting anything.
   if(deps.storage.getItem(key)!==raw)throw unavailable();
   const forget=()=>{try{if(deps.storage.getItem(key)===raw)deps.storage.removeItem(key);}finally{notify();}};
   deps.assertContext(tenant,actor);const {data,error}=await deps.send(row.payload);deps.assertContext(tenant,actor);
   if(error){if(!uncertain&&isDefinitive(error)){try{forget();}catch{/* Preserve storage if cleanup fails. */}}throw error;}
   const result=parseCustomerCreditRefundResult(data,row.payload,actor,row.expected);
   if(result.tenant_id!==tenant||result.actor_id!==actor||result.request_id!==row.payload.request_id||result.credit_id!==row.payload.credit_id||result.outgoing_movement_id!==row.payload.outgoing_movement_id)throw new Error('Resposta incompatível com o pedido de vinculação de devolução preservado.');
   try{forget();}catch{/* A confirmed result remains confirmed; stored replay stays available. */}return result;
  }));
  flight={identity,promise};void promise.finally(()=>{if(flight?.promise===promise)flight=null;notify();}).catch(()=>{});return promise;
 }
 return {submit:(tenant:string,actor:string,input:CustomerCreditRefundInput)=>run(tenant,actor,input),recover:(tenant:string,actor:string)=>run(tenant,actor)};
}
