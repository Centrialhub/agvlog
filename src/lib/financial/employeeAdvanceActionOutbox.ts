import {z} from 'zod';
import {employeeAdvanceActionExpectedSchema,employeeAdvanceActionCommandSchema,employeeAdvanceActionResultSchema,parseEmployeeAdvanceActionResult} from './employeeAdvanceActionContract';
const uuid=z.string().uuid();
const inputSchema=employeeAdvanceActionCommandSchema.omit({version:true,tenant_id:true,request_id:true}).extend({expected:employeeAdvanceActionExpectedSchema}).refine(v=>v.expected.status_after===(v.action==='approve'?'approved':'cancelled'));
export type EmployeeAdvanceActionInput=z.infer<typeof inputSchema>;
type Command=z.infer<typeof employeeAdvanceActionCommandSchema>;
type Result=z.infer<typeof employeeAdvanceActionResultSchema>;
const pendingSchema=z.object({version:z.literal(1),tenantId:uuid,actorId:uuid,expected:employeeAdvanceActionExpectedSchema,payload:employeeAdvanceActionCommandSchema}).strict();
export type PendingEmployeeAdvanceAction=z.infer<typeof pendingSchema>;
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const employeeAdvanceActionKey=(tenant:string,actor:string)=>`agvlog:employee-advance-action:v1:${tenant}:${actor}`;
const unavailable=()=>new Error('O pedido de pedido de adiantamento salvo está indisponível ou incompatível. Preserve os dados antes de iniciar outra operação.');
export function pendingEmployeeAdvanceAction(storage:Store,tenant:string,actor:string):PendingEmployeeAdvanceAction|null{
 try{uuid.parse(tenant);uuid.parse(actor);const raw=storage.getItem(employeeAdvanceActionKey(tenant,actor));if(raw===null)return null;if(raw.length>20000)throw unavailable();const original=JSON.parse(raw),row=pendingSchema.parse(original);if(row.tenantId!==tenant||row.actorId!==actor||row.payload.tenant_id!==tenant)throw unavailable();return original as PendingEmployeeAdvanceAction;}catch{throw unavailable();}
}
export async function lockEmployeeAdvanceAction<T>(key:string,work:()=>Promise<T>):Promise<T>{if(typeof navigator==='undefined'||!navigator.locks)throw new Error('Não foi possível proteger o pedido entre abas. Nenhum pedido de adiantamento foi enviado.');return navigator.locks.request(key,work);}
interface Dependencies{storage:Store;uuid:()=>string;assertContext:(tenant:string,actor:string)=>void;changed:()=>void;lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;send:(payload:Command)=>Promise<{data:unknown;error:unknown}>}
const isDefinitive=(error:unknown)=>{const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';return /^(22|23)/.test(code)||['40001','40P01','55P03','42501','55000'].includes(code);};
export function createEmployeeAdvanceActionOutbox(deps:Dependencies){
 let flight:{identity:string;promise:Promise<Result>}|null=null;
 const notify=()=>{try{deps.changed();}catch{/* Notification must not change the confirmed outcome. */}};
 function run(tenant:string,actor:string,input?:EmployeeAdvanceActionInput):Promise<Result>{
  let parsed:EmployeeAdvanceActionInput|undefined;try{uuid.parse(tenant);uuid.parse(actor);parsed=input===undefined?undefined:inputSchema.parse(input);}catch(error){return Promise.reject(error);}
  const identity=JSON.stringify([tenant,actor,parsed??null]);
  if(flight)return flight.identity===identity?flight.promise:Promise.reject(new Error('Outro pedido de adiantamento está em andamento. Aguarde o resultado do pedido original.'));
  const key=employeeAdvanceActionKey(tenant,actor);
  const promise=Promise.resolve().then(()=>deps.lock(key,async()=>{
   deps.assertContext(tenant,actor);const observedRaw=deps.storage.getItem(key);const found=pendingEmployeeAdvanceAction(deps.storage,tenant,actor);if(deps.storage.getItem(key)!==observedRaw)throw unavailable();let row=found;const uncertain=found!==null;
   if(row&&parsed)throw new Error('Há um pedido de adiantamento sem confirmação. Recupere o pedido existente antes de iniciar outra.');
   if(!row){if(!parsed)throw new Error('Nenhum pedido de adiantamento pendente para esta sessão.');row={version:1,tenantId:tenant,actorId:actor,expected:parsed.expected,payload:employeeAdvanceActionCommandSchema.parse({version:1,tenant_id:tenant,request_id:deps.uuid(),advance_id:parsed.advance_id,action:parsed.action,expected_revision:parsed.expected_revision,reason:parsed.reason})};}
   const raw=found?observedRaw:JSON.stringify(row);
   if(raw===null)throw unavailable();
   if(!found){if(deps.storage.getItem(key)!==null)throw unavailable();deps.storage.setItem(key,raw);notify();}
   // Detect writers that do not share our lock before sending or deleting anything.
   if(deps.storage.getItem(key)!==raw)throw unavailable();
   const forget=()=>{try{if(deps.storage.getItem(key)===raw)deps.storage.removeItem(key);}finally{notify();}};
   deps.assertContext(tenant,actor);const {data,error}=await deps.send(row.payload);deps.assertContext(tenant,actor);
   if(error){if(!uncertain&&isDefinitive(error)){try{forget();}catch{/* Preserve storage if cleanup fails. */}}throw error;}
   const result=parseEmployeeAdvanceActionResult(data,row.payload,actor,row.expected);
   if(result.tenant_id!==tenant||result.actor_id!==actor||result.request_id!==row.payload.request_id||result.advance_id!==row.payload.advance_id)throw new Error('Resposta incompatível com o pedido de pedido de adiantamento preservado.');
   try{forget();}catch{/* A confirmed result remains confirmed; stored replay stays available. */}return result;
  }));
  flight={identity,promise};void promise.finally(()=>{if(flight?.promise===promise)flight=null;notify();}).catch(()=>{});return promise;
 }
 return {submit:(tenant:string,actor:string,input:EmployeeAdvanceActionInput)=>run(tenant,actor,input),recover:(tenant:string,actor:string)=>run(tenant,actor)};
}
