import {z} from 'zod';
import type {ClientInvoice} from '@/hooks/useClientInvoices';
const rowSchema=z.object({id:z.string().uuid(),tenant_id:z.string().uuid(),client_id:z.string().uuid(),invoice_number:z.string(),
 sequence_number:z.number().nullable(),installment_number:z.number(),issue_date:z.string(),due_date:z.string().nullable(),
 gross_amount:z.number(),discount_amount:z.number(),interest_amount:z.number(),total_amount:z.number(),status:z.string(),
 notes:z.string().nullable(),pdf_url:z.string().nullable(),sent_at:z.string().nullable(),receivable_id:z.string().uuid().nullable(),
 cancelled_at:z.string().nullable(),cancellation_reason:z.string().nullable(),created_at:z.string(),
 clients:z.object({company_name:z.string().nullable(),tax_id:z.string().nullable()}).nullable(),
 received_amount:z.number().nonnegative().nullable(),open_amount:z.number().nonnegative().nullable(),requires_reconciliation:z.boolean()}).passthrough();
const listSchema=z.object({version:z.literal(1),tenant_id:z.string().uuid(),actor_id:z.string().uuid(),truncated:z.boolean(),rows:z.array(rowSchema).max(500)}).strict();
export function parseInvoiceList(value:unknown,tenant:string,actor:string):{rows:ClientInvoice[];truncated:boolean}{
 const result=listSchema.safeParse(value);
 if(!result.success||result.data.tenant_id!==tenant||result.data.actor_id!==actor||result.data.rows.some(row=>row.tenant_id!==tenant))throw new Error('Consulta de faturas incompatível com a sessão. Atualize a lista.');
 const rows=result.data.rows.map(row=>{
  if(!row.requires_reconciliation&&(row.received_amount===null||row.open_amount===null||
    (row.status==='cancelled'?(row.received_amount!==0||row.open_amount!==0):Math.round((row.received_amount+row.open_amount)*100)!==Math.round(row.total_amount*100))))throw new Error('Saldo de fatura incompatível. Atualize a lista.');
  return {...row,clients:row.clients?{...row.clients,company_name:row.clients.company_name||''}:null};
 });
 return {rows:rows as ClientInvoice[],truncated:result.data.truncated};
}
