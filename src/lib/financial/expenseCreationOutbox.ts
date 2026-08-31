import {expenseCreationSchema,parseCreationResult,parseReceiptStatus,type ExpenseCreationCommand,type ExpenseCreationInput,type ExpenseCreationResult} from './expenseCreationCommands';
import {isRecord} from '@/lib/loads/operationDocumentOutcome';
export const EXPENSE_CREATION_CHANGED='agvlog:expense-creation-changed';
const keyFor=(tenant:string,actor:string)=>'agvlog:expense-creation:v1:'+tenant+':'+actor;
const unavailable=()=>new Error('Recuperação da despesa indisponível ou incompatível. Nenhum novo pedido foi enviado.');
export interface PendingExpenseCreation {version:1;tenantId:string;actorId:string;createdAt:string;phase:'upload'|'ready'|'submitting';payload:ExpenseCreationCommand}
export function pendingExpenseCreation(storage:Storage,tenant:string,actor:string):PendingExpenseCreation|null{
 try{
  for(let n=0;n<storage.length;n++){const k=storage.key(n);if(k?.startsWith('agvlog:expense-creation:')&&k.endsWith(':'+tenant+':'+actor)&&k!==keyFor(tenant,actor))throw unavailable();}
  const raw=storage.getItem(keyFor(tenant,actor));if(!raw)return null;if(raw.length>30000)throw unavailable();const p:unknown=JSON.parse(raw);
  if(!isRecord(p)||p.version!==1||p.tenantId!==tenant||p.actorId!==actor||typeof p.createdAt!=='string'||!Number.isFinite(Date.parse(p.createdAt))||!['upload','ready','submitting'].includes(String(p.phase)))throw unavailable();
  const payload=expenseCreationSchema.parse(p.payload);if(payload.tenant_id!==tenant||payload.actor_id!==actor||(!payload.receipt&&p.phase==='upload'))throw unavailable();
  return {...p,payload} as PendingExpenseCreation;
 }catch{throw unavailable();}
}
interface Dependencies {
 storage:Storage;uuid:()=>string;assertContext:()=>void;changed:()=>void;lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;
 receiptStatus:(p:ExpenseCreationCommand)=>Promise<unknown>;upload:(p:ExpenseCreationCommand,file:File)=>Promise<unknown>;
 send:(p:ExpenseCreationCommand)=>Promise<{data:unknown;error:unknown}>;
}
export function createExpenseCreationOutbox(deps:Dependencies){
 let inFlight:Promise<ExpenseCreationResult>|null=null;
 const run=(tenant:string,actor:string,input?:ExpenseCreationInput,file?:File)=>{
  if(inFlight)return inFlight;const key=keyFor(tenant,actor),work=deps.lock(key,async()=>{
   deps.assertContext();let row=pendingExpenseCreation(deps.storage,tenant,actor);const uncertain=row?.phase==='submitting';
   if(row&&input)throw new Error('Há uma despesa pendente de confirmação. Recupere o pedido antes de iniciar outro.');
   const save=(r:PendingExpenseCreation)=>{try{deps.storage.setItem(key,JSON.stringify(r));}catch{throw unavailable();}deps.changed();};
   if(!row){if(!input)throw new Error('Nenhuma despesa pendente nesta sessão.');
    const payload=expenseCreationSchema.parse({...input,version:1,tenant_id:tenant,actor_id:actor,request_id:deps.uuid()});
    row={version:1,tenantId:tenant,actorId:actor,createdAt:new Date().toISOString(),phase:payload.receipt?'upload':'ready',payload};save(row);}
   if(row.phase==='upload'){
    const status=parseReceiptStatus(await deps.receiptStatus(row.payload),row.payload);deps.assertContext();
    if(!status.uploaded){
     if(!file)throw new Error('Selecione novamente o mesmo comprovante para concluir o envio. A despesa ainda não foi registrada.');
     const ack=parseReceiptStatus(await deps.upload(row.payload,file),row.payload);deps.assertContext();
     if(!ack.uploaded)throw new Error('Comprovante ainda não confirmado.');}
    row={...row,phase:'ready'};save(row);
   }
   deps.assertContext();row={...row,phase:'submitting'};save(row);
   const forget=()=>{try{deps.storage.removeItem(key);}catch{/* exact replay remains recoverable */}deps.changed();};
   const {data,error}=await deps.send(row.payload);deps.assertContext();
   if(error){const code=isRecord(error)?String(error.code??''):'';
    if(!uncertain&&(/^(22|23)/.test(code)||['40001','40P01','55P03','42501','55000'].includes(code)))forget();throw error;}
   const result=parseCreationResult(data,row.payload);forget();return result;
  });inFlight=work;void work.finally(()=>{if(inFlight===work)inFlight=null;deps.changed();}).catch(()=>{});return work;
 };
 return {submit:(t:string,a:string,input:ExpenseCreationInput,file?:File)=>run(t,a,input,file),recover:(t:string,a:string,file?:File)=>run(t,a,undefined,file),
  abandon:(tenant:string,actor:string)=>deps.lock(keyFor(tenant,actor),async()=>{
   deps.assertContext();const row=pendingExpenseCreation(deps.storage,tenant,actor);if(!row)return;
   if(row.phase==='submitting')throw new Error('Este pedido pode ter sido registrado. Recupere a confirmação; não descarte.');
   // No business RPC was transmitted. Uploaded evidence is retained; this
   // operation must never call privileged Storage cleanup.
   try{deps.storage.removeItem(keyFor(tenant,actor));}catch{throw unavailable();}deps.changed();
  })};
}
