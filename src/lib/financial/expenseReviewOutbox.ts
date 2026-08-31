import {expenseReviewCommandSchema,parseExpenseReviewResult,type ExpenseReviewCommand,type ExpenseReviewInput,type ExpenseReviewResult} from './expenseReviewCommands';
import {isRecord} from '@/lib/loads/operationDocumentOutcome';
export const EXPENSE_REVIEW_CHANGED='agvlog:expense-review-changed';
const keyFor=(tenant:string,actor:string)=>'agvlog:expense-review:v1:'+tenant+':'+actor;
const unavailable=()=>new Error('Recuperação da revisão indisponível ou incompatível. Nenhum novo pedido foi enviado.');
export interface PendingExpenseReview {version:1;tenantId:string;actorId:string;createdAt:string;payload:ExpenseReviewCommand}
export function pendingExpenseReview(storage:Storage,tenant:string,actor:string):PendingExpenseReview|null{
 try{
  for(let index=0;index<storage.length;index++){const key=storage.key(index);if(key?.startsWith('agvlog:expense-review:')&&key.endsWith(':'+tenant+':'+actor)&&key!==keyFor(tenant,actor))throw unavailable();}
  const raw=storage.getItem(keyFor(tenant,actor));if(!raw)return null;if(raw.length>15000)throw unavailable();const row:unknown=JSON.parse(raw);
  if(!isRecord(row)||row.version!==1||row.tenantId!==tenant||row.actorId!==actor||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt)))throw unavailable();
  const payload=expenseReviewCommandSchema.parse(row.payload);if(payload.tenant_id!==tenant||payload.actor_id!==actor)throw unavailable();return {...row,payload} as PendingExpenseReview;
 }catch{throw unavailable();}
}
interface Dependencies {storage:Storage;uuid:()=>string;assertContext:()=>void;changed:()=>void;lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;send:(payload:ExpenseReviewCommand)=>Promise<{data:unknown;error:unknown}>}
export function createExpenseReviewOutbox(deps:Dependencies){
 let inFlight:Promise<ExpenseReviewResult>|null=null;
 const run=(tenant:string,actor:string,input?:ExpenseReviewInput)=>{
  if(inFlight)return inFlight;const key=keyFor(tenant,actor);const work=deps.lock(key,async()=>{
   deps.assertContext();let row=pendingExpenseReview(deps.storage,tenant,actor);const uncertain=!!row;
   if(row&&input)throw new Error('Há uma revisão sem confirmação. Recupere o pedido existente antes de iniciar outro.');
   if(!row){if(!input)throw new Error('Nenhuma revisão pendente nesta sessão.');
    row={version:1,tenantId:tenant,actorId:actor,createdAt:new Date().toISOString(),payload:expenseReviewCommandSchema.parse({...input,version:1,tenant_id:tenant,actor_id:actor,request_id:deps.uuid()})};
    try{deps.storage.setItem(key,JSON.stringify(row));}catch{throw unavailable();}deps.changed();}
   const forget=()=>{try{deps.storage.removeItem(key);}catch{/* exact durable replay remains safe */}deps.changed();};
   deps.assertContext();const {data,error}=await deps.send(row.payload);deps.assertContext();
   if(error){const code=isRecord(error)?String(error.code??''):'';if(!uncertain&&(/^(22|23)/.test(code)||['40001','40P01','55P03','42501','55000'].includes(code)))forget();throw error;}
   const result=parseExpenseReviewResult(data,row.payload);forget();return result;
  });inFlight=work;void work.finally(()=>{if(inFlight===work)inFlight=null;deps.changed();}).catch(()=>{});return work;
 };
 return {submit:(tenant:string,actor:string,input:ExpenseReviewInput)=>run(tenant,actor,input),recover:(tenant:string,actor:string)=>run(tenant,actor)};
}
