import {z} from 'zod';
import {expenseArtifactCommandSchema,sendExpenseArtifact,ExpenseArtifactRejectedError,type ExpenseArtifactCommand} from './expenseArtifactClient';
const storedSchema=z.object({actor:z.string().uuid(),uncertain:z.boolean(),command:expenseArtifactCommandSchema}).strict();
export const expenseArtifactKey=(tenant:string,actor:string,expense:string)=>`finance-expense-artifact:${tenant}:${actor}:${expense}`;
export function loadExpenseArtifactPending(tenant:string,actor:string,expense:string){
 const raw=localStorage.getItem(expenseArtifactKey(tenant,actor,expense));if(!raw)return null;
 try{const row=storedSchema.parse(JSON.parse(raw));if(row.actor!==actor||row.command.tenant_id!==tenant||row.command.expense_id!==expense)throw new Error();return row;}catch{throw new Error('O pedido de anexo preservado está inconsistente. Nenhum novo envio foi permitido.');}
}
export async function attachExpenseArtifact(tenant:string,actor:string,expense:string,input?:{artifact:string;reason:string}){
 if(!navigator.locks?.request)throw new Error('O navegador não oferece a proteção necessária para recuperar o anexo.');
 const key=expenseArtifactKey(tenant,actor,expense);
 return navigator.locks.request(key,{mode:'exclusive'},async()=>{
  let pending=loadExpenseArtifactPending(tenant,actor,expense),raw=localStorage.getItem(key);
  if(pending&&input)throw new Error('Recupere o anexo pendente antes de confirmar outro.');
  if(!pending){if(!input)throw new Error('Nenhum anexo pendente.');pending={actor,uncertain:false,command:expenseArtifactCommandSchema.parse({version:2,tenant_id:tenant,request_id:crypto.randomUUID(),expense_id:expense,artifact_id:input.artifact,reason:input.reason})};}
  const wasUncertain=pending.uncertain,command:ExpenseArtifactCommand=pending.command;
  if(localStorage.getItem(key)!==raw)throw new Error('O pedido mudou em outra janela. Atualize a consulta.');
  raw=JSON.stringify({...pending,uncertain:true});localStorage.setItem(key,raw);
  try{const result=await sendExpenseArtifact(command);try{if(localStorage.getItem(key)===raw)localStorage.removeItem(key);}catch{/* Confirmed is terminal; a retained outbox can safely replay. */}return result;}
  catch(error){if(error instanceof ExpenseArtifactRejectedError&&!wasUncertain&&localStorage.getItem(key)===raw)localStorage.removeItem(key);throw error;}
 });
}
