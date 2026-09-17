import {z} from 'zod';
import {employeeAdvanceRegistrationCommandSchema,employeeAdvanceRegistrationResultSchema,parseEmployeeAdvanceRegistrationResult} from './employeeAdvanceRegistrationContract';
const uuid=z.string().uuid();
const inputSchema=employeeAdvanceRegistrationCommandSchema.omit({version:true,tenant_id:true,request_id:true});
export type EmployeeAdvanceRegistrationInput=z.infer<typeof inputSchema>;
type Command=z.infer<typeof employeeAdvanceRegistrationCommandSchema>;
type Result=z.infer<typeof employeeAdvanceRegistrationResultSchema>;
const pendingSchema=z.object({version:z.literal(1),tenantId:uuid,actorId:uuid,payload:employeeAdvanceRegistrationCommandSchema}).strict();
export type PendingEmployeeAdvanceRegistration=z.infer<typeof pendingSchema>;
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const employeeAdvanceRegistrationKey=(tenant:string,actor:string)=>`agvlog:employee-advance-registration:v1:${tenant}:${actor}`;
const unavailable=()=>new Error('O pedido de cadastro do adiantamento salvo está indisponível ou incompatível. Preserve os dados antes de iniciar outra operação.');
export function pendingEmployeeAdvanceRegistration(storage:Store,tenant:string,actor:string):PendingEmployeeAdvanceRegistration|null{
 try{uuid.parse(tenant);uuid.parse(actor);const raw=storage.getItem(employeeAdvanceRegistrationKey(tenant,actor));if(raw===null)return null;if(raw.length>20000)throw unavailable();const original=JSON.parse(raw),row=pendingSchema.parse(original);if(row.tenantId!==tenant||row.actorId!==actor||row.payload.tenant_id!==tenant)throw unavailable();return original as PendingEmployeeAdvanceRegistration;}catch{throw unavailable();}
}
export async function lockEmployeeAdvanceRegistration<T>(key:string,work:()=>Promise<T>):Promise<T>{if(typeof navigator==='undefined'||!navigator.locks)throw new Error('Não foi possível proteger o pedido entre abas. Nenhum cadastro do adiantamento foi enviado.');return navigator.locks.request(key,work);}
interface Dependencies{storage:Store;uuid:()=>string;assertContext:(tenant:string,actor:string)=>void;changed:()=>void;lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;send:(payload:Command)=>Promise<{data:unknown;error:unknown}>}
const isDefinitive=(error:unknown)=>{const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';return /^(22|23)/.test(code)||['40001','40P01','55P03','42501','55000'].includes(code);};
export function createEmployeeAdvanceRegistrationOutbox(deps:Dependencies){
 let flight:{identity:string;promise:Promise<Result>}|null=null;
 const notify=()=>{try{deps.changed();}catch{/* Notification must not change the confirmed outcome. */}};
 function run(tenant:string,actor:string,input?:EmployeeAdvanceRegistrationInput):Promise<Result>{
  let parsed:EmployeeAdvanceRegistrationInput|undefined;try{uuid.parse(tenant);uuid.parse(actor);parsed=input===undefined?undefined:inputSchema.parse(input);}catch(error){return Promise.reject(error);}
  const identity=JSON.stringify([tenant,actor,parsed??null]);
  if(flight)return flight.identity===identity?flight.promise:Promise.reject(new Error('Outro cadastro do adiantamento está em andamento. Aguarde o resultado do pedido original.'));
  const key=employeeAdvanceRegistrationKey(tenant,actor);
  const promise=Promise.resolve().then(()=>deps.lock(key,async()=>{
   deps.assertContext(tenant,actor);const observedRaw=deps.storage.getItem(key);const found=pendingEmployeeAdvanceRegistration(deps.storage,tenant,actor);if(deps.storage.getItem(key)!==observedRaw)throw unavailable();let row=found;const uncertain=found!==null;
   if(row&&parsed)throw new Error('Há um cadastro do adiantamento sem confirmação. Recupere o pedido existente antes de iniciar outra.');
   if(!row){if(!parsed)throw new Error('Nenhum cadastro do adiantamento pendente para esta sessão.');row={version:1,tenantId:tenant,actorId:actor,payload:employeeAdvanceRegistrationCommandSchema.parse({version:1,tenant_id:tenant,request_id:deps.uuid(),employee_id:parsed.employee_id,amount_cents:parsed.amount_cents,advance_date:parsed.advance_date,reason:parsed.reason,payment_method:parsed.payment_method,payment_reference:parsed.payment_reference,create_payable:parsed.create_payable})};}
   const raw=found?observedRaw:JSON.stringify(row);
   if(raw===null)throw unavailable();
   if(!found){if(deps.storage.getItem(key)!==null)throw unavailable();deps.storage.setItem(key,raw);notify();}
   // Detect writers that do not share our lock before sending or deleting anything.
   if(deps.storage.getItem(key)!==raw)throw unavailable();
   const forget=()=>{try{if(deps.storage.getItem(key)===raw)deps.storage.removeItem(key);}finally{notify();}};
   deps.assertContext(tenant,actor);const {data,error}=await deps.send(row.payload);deps.assertContext(tenant,actor);
   if(error){if(!uncertain&&isDefinitive(error)){try{forget();}catch{/* Preserve storage if cleanup fails. */}}throw error;}
   const result=parseEmployeeAdvanceRegistrationResult(data,row.payload,actor);
   if(result.tenant_id!==tenant||result.actor_id!==actor||result.request_id!==row.payload.request_id||result.employee_id!==row.payload.employee_id)throw new Error('Resposta incompatível com o pedido de cadastro do adiantamento preservado.');
   try{forget();}catch{/* A confirmed result remains confirmed; stored replay stays available. */}return result;
  }));
  flight={identity,promise};void promise.finally(()=>{if(flight?.promise===promise)flight=null;notify();}).catch(()=>{});return promise;
 }
 return {submit:(tenant:string,actor:string,input:EmployeeAdvanceRegistrationInput)=>run(tenant,actor,input),recover:(tenant:string,actor:string)=>run(tenant,actor)};
}
