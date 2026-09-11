import {legacyReceivableCents} from './receivableCreditAmounts';
import {z} from 'zod';
import type {ClientInvoice} from '@/hooks/useClientInvoices';
const amount=z.number().finite().refine(value=>legacyReceivableCents(value)!==null,'Valor monetário inválido: centavos exatos exigidos.');
const rowSchema=z.object({id:z.string().uuid(),tenant_id:z.string().uuid(),client_id:z.string().uuid(),invoice_number:z.string(),
 sequence_number:z.number().nullable(),installment_number:z.number(),issue_date:z.string(),due_date:z.string().nullable(),
 gross_amount:amount,discount_amount:amount,interest_amount:amount,total_amount:amount,status:z.string(),
 notes:z.string().nullable(),pdf_url:z.string().nullable(),sent_at:z.string().nullable(),receivable_id:z.string().uuid().nullable(),
 cancelled_at:z.string().nullable(),cancellation_reason:z.string().nullable(),created_at:z.string(),
 clients:z.object({company_name:z.string().nullable(),tax_id:z.string().nullable()}).nullable(),
 received_amount:amount.nullable(),open_amount:amount.nullable(),requires_reconciliation:z.boolean()}).passthrough();
const listSchema=z.object({version:z.literal(1),tenant_id:z.string().uuid(),actor_id:z.string().uuid(),truncated:z.boolean(),rows:z.array(rowSchema).max(500)}).strict();
export function parseInvoiceList(value:unknown,tenant:string,actor:string):{rows:ClientInvoice[];truncated:boolean}{
 const result=listSchema.safeParse(value);
 if(!result.success||result.data.tenant_id!==tenant||result.data.actor_id!==actor||result.data.rows.some(row=>row.tenant_id!==tenant))throw new Error('Consulta de faturas incompatível com a sessão. Atualize a lista.');
 const rows=result.data.rows.map(row=>{
  if(!row.requires_reconciliation&&(row.received_amount===null||row.open_amount===null||
    (row.status==='cancelled'?(row.received_amount!==0||row.open_amount!==0):BigInt(legacyReceivableCents(row.received_amount)!)+BigInt(legacyReceivableCents(row.open_amount)!)!==BigInt(legacyReceivableCents(row.total_amount)!))))throw new Error('Saldo de fatura incompatível. Atualize a lista.');
  return {...row,clients:row.clients?{...row.clients,company_name:row.clients.company_name||''}:null};
 });
 return {rows:rows as ClientInvoice[],truncated:result.data.truncated};
}

export type InvoiceListTotals={open:string|null;overdue:string|null;sent:string|null;paid:string|null};
type TotalSource=Pick<ClientInvoice,'status'|'due_date'|'received_amount'|'open_amount'|'requires_reconciliation'>;
export function invoiceListTotals(rows:readonly TotalSource[],now=new Date()):InvoiceListTotals{
 const unknown:InvoiceListTotals={open:null,overdue:null,sent:null,paid:null};
 if(rows.some(row=>row.requires_reconciliation))return unknown;
 let open=0n,overdue=0n,sent=0n,paid=0n;
 for(const row of rows){
  if(row.status==='cancelled')continue;
  const received=legacyReceivableCents(row.received_amount),remaining=legacyReceivableCents(row.open_amount);
  if(received===null||remaining===null)return unknown;
  paid+=BigInt(received);
  if(row.status==='generated'||row.status==='sent'){
   open+=BigInt(remaining);
   if(row.due_date&&new Date(row.due_date+'T23:59:59')<now)overdue+=BigInt(remaining);
  }
  if(row.status==='sent')sent+=BigInt(remaining);
 }
 return{open:open.toString(),overdue:overdue.toString(),sent:sent.toString(),paid:paid.toString()};
}
