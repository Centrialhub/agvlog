import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {uploadRecoverableFinanceArtifact} from './uploadArtifactRecovery';
import {uploadArtifactStatus} from './uploadArtifactContract';
import type {PreparedExpenseReceipt} from './expenseBatchContract';
import {expenseReceiptIntentCommandSchema,expenseReceiptIntentResultSchema} from './expenseBatchReceiptContract';
export {expenseReceiptIntentCommandSchema,expenseReceiptIntentResultSchema} from './expenseBatchReceiptContract';
type Input=Omit<z.infer<typeof expenseReceiptIntentCommandSchema>,'version'|'request_id'>;
type Rpc=(name:string,args:Record<string,unknown>)=>Promise<{data:unknown;error:unknown}>;
export async function prepareExpenseReceiptIntent(input:Input,actor:string){
 const key=`finance-expense-receipt-intent:${input.tenant_id}:${actor}:${input.batch_request_id}:${input.expense_id}:${input.context}:${input.trip_id}:${input.stop_id}`;
 if(!navigator.locks?.request)throw new Error('Este navegador não oferece proteção para recuperar a preparação do comprovante.');
 return navigator.locks.request(key,{mode:'exclusive'},async()=>{
  const raw=localStorage.getItem(key);let command:z.infer<typeof expenseReceiptIntentCommandSchema>;
  if(raw){command=expenseReceiptIntentCommandSchema.parse(JSON.parse(raw));if(Object.entries(input).some(([k,v])=>command[k as keyof Input]!==v))throw new Error('A preparação preservada não corresponde a este gasto.');}
  else{command=expenseReceiptIntentCommandSchema.parse({...input,version:1,request_id:crypto.randomUUID()});localStorage.setItem(key,JSON.stringify(command));}
  const {data,error}=await (supabase.rpc as unknown as Rpc)('prepare_finance_expense_receipt_intent',{_payload:command});
  if(error)throw new Error('Preparação sem confirmação. Selecione novamente o arquivo para recuperar o mesmo pedido.');
  const result=expenseReceiptIntentResultSchema.parse(data);if(result.actor_id!==actor||Object.entries(command).some(([k,v])=>result[k as keyof typeof command]!==v))throw new Error('A preparação recebida pertence a outro pedido ou responsável.');
  return result;
 });
}
export async function prepareBatchReceipt(input:Input,actor:string,file:File):Promise<PreparedExpenseReceipt>{
 const ext=file.name.includes('.')?file.name.split('.').pop()?.toLowerCase():undefined;const format=ext==='jpg'?'jpeg':ext||(file.type==='image/jpeg'?'jpeg':file.type==='image/png'?'png':undefined);
 if(format!=='jpeg'&&format!=='png')throw new Error('Neste lote, selecione uma foto JPEG ou PNG. Outros formatos não possuem cópia validada para anexação.');
 const intent=await prepareExpenseReceiptIntent(input,actor);
 const artifact=await uploadRecoverableFinanceArtifact({tenantId:input.tenant_id,actorId:actor,sourceType:'expense_draft',sourceId:intent.intent_id,file,format});
 if(!artifact.usable||artifact.state!=='sanitized_derivative')throw new Error(uploadArtifactStatus(artifact)+' Nenhum comprovante foi vinculado a este gasto.');
 return {intentId:intent.intent_id,artifactId:artifact.artifact_id,tenantId:input.tenant_id,actorId:actor,batchRequestId:input.batch_request_id,expenseId:input.expense_id,context:input.context,tripId:input.trip_id,stopId:input.stop_id,sha256:artifact.original.sha256,name:file.name};
}
