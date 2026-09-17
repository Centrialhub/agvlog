import {z} from 'zod';
import {payableXmlCommandSchema,payableXmlResultSchema,parsePayableXmlResult} from './payableXmlContract';
const uuid=z.string().uuid();
const inputSchema=payableXmlCommandSchema.innerType().omit({version:true,tenant_id:true,request_id:true});
export type PayableXmlInput=z.infer<typeof inputSchema>;
type Command=z.infer<typeof payableXmlCommandSchema>;
type Result=z.infer<typeof payableXmlResultSchema>;
const pendingSchema=z.object({version:z.literal(1),tenantId:uuid,actorId:uuid,payload:payableXmlCommandSchema}).strict();
export type PendingPayableXml=z.infer<typeof pendingSchema>;
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const payableXmlKey=(tenant:string,actor:string)=>`agvlog:payable-xml:v1:${tenant}:${actor}`;
export function discardPendingPayableXml(storage:Pick<Storage,'removeItem'>,tenant:string,actor:string){storage.removeItem(payableXmlKey(tenant,actor));}
const unavailable=()=>new Error('O pedido de conta com XML salvo está indisponível ou incompatível. Preserve os dados antes de iniciar outra operação.');
export function pendingPayableXml(storage:Store,tenant:string,actor:string):PendingPayableXml|null{
 try{uuid.parse(tenant);uuid.parse(actor);const raw=storage.getItem(payableXmlKey(tenant,actor));if(raw===null)return null;if(raw.length>2_000_000)throw unavailable();const original=JSON.parse(raw),row=pendingSchema.parse(original);if(row.tenantId!==tenant||row.actorId!==actor||row.payload.tenant_id!==tenant)throw unavailable();return original as PendingPayableXml;}catch{throw unavailable();}
}
export async function lockPayableXml<T>(key:string,work:()=>Promise<T>):Promise<T>{if(typeof navigator==='undefined'||!navigator.locks)throw new Error('Não foi possível proteger o pedido entre abas. Nenhuma conta com XML foi enviada.');return navigator.locks.request(key,work);}
interface Dependencies{storage:Store;uuid:()=>string;assertContext:(tenant:string,actor:string)=>void;changed:()=>void;lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;send:(payload:Command)=>Promise<{data:unknown;error:unknown}>}
const isDefinitive=(error:unknown)=>{const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';return /^(22|23)/.test(code)||['40001','40P01','55P03','42501','55000'].includes(code);};
export function createPayableXmlOutbox(deps:Dependencies){
 let flight:{identity:string;promise:Promise<Result>}|null=null;
 const notify=()=>{try{deps.changed();}catch{/* Notification must not change the confirmed outcome. */}};
 function run(tenant:string,actor:string,input?:PayableXmlInput):Promise<Result>{
  let parsed:PayableXmlInput|undefined;try{uuid.parse(tenant);uuid.parse(actor);parsed=input===undefined?undefined:inputSchema.parse(input);}catch(error){return Promise.reject(error);}
  const identity=JSON.stringify([tenant,actor,parsed??null]);
  if(flight)return flight.identity===identity?flight.promise:Promise.reject(new Error('Outra conta com XML está em andamento. Aguarde o resultado do pedido original.'));
  const key=payableXmlKey(tenant,actor);
  const promise=Promise.resolve().then(()=>deps.lock(key,async()=>{
   deps.assertContext(tenant,actor);const observedRaw=deps.storage.getItem(key);const found=pendingPayableXml(deps.storage,tenant,actor);if(deps.storage.getItem(key)!==observedRaw)throw unavailable();let row=found;const uncertain=found!==null;
   if(row&&parsed)throw new Error('Há uma conta com XML sem confirmação. Recupere o pedido existente antes de iniciar outra.');
   if(!row){if(!parsed)throw new Error('Nenhuma conta com XML pendente para esta sessão.');row={version:1,tenantId:tenant,actorId:actor,payload:payableXmlCommandSchema.parse({...parsed,version:1,tenant_id:tenant,request_id:deps.uuid()})};}
   const raw=found?observedRaw:JSON.stringify(row);
   if(raw===null||raw.length>2_000_000)throw unavailable();
   if(!found){if(deps.storage.getItem(key)!==null)throw unavailable();deps.storage.setItem(key,raw);notify();}
   // Detect writers that do not share our lock before sending or deleting anything.
   if(deps.storage.getItem(key)!==raw)throw unavailable();
   const forget=()=>{try{if(deps.storage.getItem(key)===raw)deps.storage.removeItem(key);}finally{notify();}};
   deps.assertContext(tenant,actor);const {data,error}=await deps.send(row.payload);deps.assertContext(tenant,actor);
   if(error){if(!uncertain&&isDefinitive(error)){try{forget();}catch{/* Preserve storage if cleanup fails. */}}throw error;}
   const result=parsePayableXmlResult(data,row.payload,actor);
   if(result.tenant_id!==tenant||result.actor_id!==actor||result.request_id!==row.payload.request_id||result.artifact_id!==row.payload.artifact_id)throw new Error('Resposta incompatível com o pedido de conta com XML preservado.');
   try{forget();}catch{/* A confirmed result remains confirmed; stored replay stays available. */}return result;
  }));
  flight={identity,promise};void promise.finally(()=>{if(flight?.promise===promise)flight=null;notify();}).catch(()=>{});return promise;
 }
 return {submit:(tenant:string,actor:string,input:PayableXmlInput)=>run(tenant,actor,input),recover:(tenant:string,actor:string)=>run(tenant,actor)};
}
