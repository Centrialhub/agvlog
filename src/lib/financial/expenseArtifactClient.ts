import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {uploadArtifactSchema} from './uploadArtifactContract';
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>;
const uuid=z.string().uuid();
export const expenseArtifactCommandSchema=z.object({version:z.literal(2),tenant_id:uuid,request_id:uuid,expense_id:uuid,artifact_id:uuid,reason:z.string().trim().min(5).max(2000)}).strict();
export type ExpenseArtifactCommand=z.infer<typeof expenseArtifactCommandSchema>;
const resultSchema=z.object({version:z.literal(2),tenant_id:uuid,request_id:uuid,expense_id:uuid,artifact_id:uuid,link_id:uuid,confirmed:z.literal(true)});
export const expenseArtifactsSchema=z.object({version:z.literal(2),tenant_id:uuid,expense_id:uuid,receipts:z.array(z.object({link_id:uuid,artifact_id:uuid,actor_id:uuid,request_id:uuid,reason:z.string(),created_at:z.string(),evidence:uploadArtifactSchema}))});
export async function readExpenseArtifacts(tenant:string,expense:string){
 const result=await(supabase.rpc as unknown as Rpc)('get_finance_expense_receipt_artifacts',{_tenant_id:tenant,_expense_id:expense});if(result.error)throw result.error;
 const data=expenseArtifactsSchema.parse(result.data);
 if(data.tenant_id!==tenant||data.expense_id!==expense||data.receipts.some(row=>row.evidence.tenant_id!==tenant||row.evidence.source_type!=='expense_item'||row.evidence.source_id!==expense||row.artifact_id!==row.evidence.artifact_id))throw new Error('Comprovantes fora do gasto solicitado.');return data;
}
export class ExpenseArtifactRejectedError extends Error{}
export async function sendExpenseArtifact(command:ExpenseArtifactCommand){
 const result=await(supabase.rpc as unknown as Rpc)('attach_finance_expense_receipt_artifact',{_payload:command});
 if(result.error){const error=z.object({code:z.string()}).safeParse(result.error);if(error.success&&['22023','23514','23505','42501','55000','40001'].includes(error.data.code))throw new ExpenseArtifactRejectedError('O anexo não foi aceito. Atualize a consulta e confira o gasto e o arquivo.');throw new Error('Anexo sem confirmação. Recupere o mesmo pedido.');}
 const data=resultSchema.parse(result.data);if(data.tenant_id!==command.tenant_id||data.request_id!==command.request_id||data.expense_id!==command.expense_id||data.artifact_id!==command.artifact_id)throw new Error('Confirmação fora do pedido preservado.');return data;
}
export async function previewExpenseArtifact(tenant:string,expense:string,artifact:string){
 const result=await supabase.functions.invoke('secure-upload',{body:{action:'finance_artifact_preview_v2',tenant_id:tenant,expense_id:expense,artifact_id:artifact}});if(result.error)throw new Error('Não foi possível abrir a cópia validada.');
 const data=z.object({version:z.literal(2),tenant_id:uuid,expense_id:uuid,artifact_id:uuid,url:z.string().url(),mime:z.enum(['image/jpeg','image/png']),expires_in:z.literal(300)}).parse(result.data);
 if(data.tenant_id!==tenant||data.expense_id!==expense||data.artifact_id!==artifact||!data.url.startsWith('https://'))throw new Error('Cópia fora do gasto solicitado.');return data;
}
