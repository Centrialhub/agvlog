import {invoiceCommandSchema,parseInvoiceResult,type InvoiceCommand,type InvoiceCommandInput,type InvoiceResult} from './clientInvoiceCommands';
import {isRecord} from '@/lib/loads/operationDocumentOutcome';
export const INVOICE_COMMAND_CHANGED='agvlog:client-invoice-changed';
const keyFor=(tenant:string,actor:string)=>`agvlog:client-invoice:v1:${tenant}:${actor}`;
const unavailable=()=>new Error('Recuperação da operação de fatura indisponível ou incompatível. Nenhum novo pedido foi enviado.');
export interface PendingInvoiceCommand {version:1;tenantId:string;actorId:string;createdAt:string;payload:InvoiceCommand}
export function pendingInvoiceCommand(storage:Storage,tenant:string,actor:string):PendingInvoiceCommand|null{
 try{
  for(let index=0;index<storage.length;index++){const key=storage.key(index);if(key?.startsWith('agvlog:client-invoice:')&&key.endsWith(`:${tenant}:${actor}`)&&key!==keyFor(tenant,actor))throw unavailable();}
  const raw=storage.getItem(keyFor(tenant,actor));if(!raw)return null;if(raw.length>1100000)throw unavailable();const row:unknown=JSON.parse(raw);
  if(!isRecord(row)||row.version!==1||row.tenantId!==tenant||row.actorId!==actor||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt)))throw unavailable();
  const payload=invoiceCommandSchema.parse(row.payload);if(payload.tenant_id!==tenant||payload.actor_id!==actor)throw unavailable();return {...row,payload} as PendingInvoiceCommand;
 }catch{throw unavailable();}
}
interface Dependencies {storage:Storage;uuid:()=>string;assertContext:()=>void;changed:()=>void;lock:<T>(key:string,work:()=>Promise<T>)=>Promise<T>;send:(payload:InvoiceCommand)=>Promise<{data:unknown;error:unknown}>}
export function createInvoiceOutbox(deps:Dependencies){
 let inFlight:Promise<InvoiceResult>|null=null;
 const run=(tenant:string,actor:string,input?:InvoiceCommandInput)=>{
  if(inFlight)return inFlight;const key=keyFor(tenant,actor);const work=deps.lock(key,async()=>{
   deps.assertContext();let row=pendingInvoiceCommand(deps.storage,tenant,actor);const uncertain=!!row;
   if(row&&input)throw new Error('Há uma operação de fatura sem confirmação. Recupere o pedido existente antes de iniciar outra.');
   if(!row){if(!input)throw new Error('Nenhuma operação de fatura pendente nesta sessão.');
    row={version:1,tenantId:tenant,actorId:actor,createdAt:new Date().toISOString(),payload:invoiceCommandSchema.parse({...input,version:1,tenant_id:tenant,actor_id:actor,request_id:deps.uuid()})};
    try{const raw=JSON.stringify(row);if(raw.length>1100000)throw unavailable();deps.storage.setItem(key,raw);}catch{throw unavailable();}deps.changed();}
   const forget=()=>{try{deps.storage.removeItem(key);}catch{/* exact durable replay remains safe */}deps.changed();};
   deps.assertContext();const {data,error}=await deps.send(row.payload);deps.assertContext();
   if(error){const code=isRecord(error)?String(error.code??''):'';if(!uncertain&&(/^(22|23)/.test(code)||['40001','40P01','55P03','42501','55000'].includes(code)))forget();throw error;}
   const result=parseInvoiceResult(data,row.payload);forget();return result;
  });inFlight=work;void work.finally(()=>{if(inFlight===work)inFlight=null;deps.changed();}).catch(()=>{});return work;
 };
 return {submit:(tenant:string,actor:string,input:InvoiceCommandInput)=>run(tenant,actor,input),recover:(tenant:string,actor:string)=>run(tenant,actor)};
}
