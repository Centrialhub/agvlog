import {supabase} from '@/integrations/supabase/client';
import {readBlobBytes,validateUploadContent} from '@/lib/uploadPolicy';
import {receiptSchema,type ExpenseCreationCommand} from './expenseCreationCommands';
import {expenseRequest} from './expenseRequest';
export async function describeExpenseReceipt(file:File){
 const mime=await validateUploadContent(file,'proof');
 const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from(await readBlobBytes(file)).buffer);
 return receiptSchema.parse({mime,size:file.size,sha256:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')});
}
export async function uploadExpenseReceipt(p:ExpenseCreationCommand,file:File){
 const receipt=await describeExpenseReceipt(file);
 if(!p.receipt||receipt.sha256!==p.receipt.sha256||receipt.mime!==p.receipt.mime||receipt.size!==p.receipt.size)throw new Error('Selecione o mesmo arquivo do pedido original; outro comprovante não será enviado.');
 const body=new FormData();body.set('action','expense_receipt');body.set('tenant_id',p.tenant_id);body.set('bucket','receipts');body.set('folder','expense-receipts');body.set('kind','proof');
 body.set('request_id',p.request_id);body.set('source_type',p.source_type);body.set('source_id',p.source_id);body.set('sha256',receipt.sha256);body.set('file',file);
 const {data,error}=await expenseRequest(signal=>supabase.functions.invoke('secure-upload',{body,signal}));
 if(error)throw new Error('Envio do comprovante sem confirmação. Recupere o pedido com o mesmo arquivo.');return data as unknown;
}
