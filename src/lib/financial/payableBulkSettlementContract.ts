import {z} from 'zod';

const uuid=z.string().uuid();
const cents=z.string().regex(/^\d+$/);
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const revision=z.string().regex(/^[a-f0-9]{32}$/);
export const payableBulkMethodSchema=z.enum(['pix','boleto','ted','doc','dinheiro','cartao','debito_automatico','other']);
export const payableBulkItemSchema=z.object({payable_id:uuid,amount_cents:cents.refine(value=>BigInt(value)>0n)}).strict();
export const payableBulkItemsSchema=z.array(payableBulkItemSchema).min(2).max(100).superRefine((items,ctx)=>{
  if(new Set(items.map(item=>item.payable_id)).size!==items.length)ctx.addIssue({code:'custom',message:'O mesmo título não pode aparecer duas vezes.'});
});
const contextItemSchema=z.object({payable_id:uuid,supplier_id:uuid.nullable(),supplier_name:z.string().nullable(),description:z.string().nullable(),status:z.string(),driver_id:uuid.nullable(),nominal_cents:cents.nullable(),paid_cents:cents.nullable(),remaining_cents:cents.nullable(),amount_cents:cents,eligible:z.boolean(),issue:z.string().nullable()});
const movementSchema=z.object({id:uuid,bank_account_id:uuid,account_name:z.string(),occurred_on:date,beneficiary_name:z.string(),bank_reference:z.string().nullable(),description:z.string(),receipt_path:z.string().nullable(),amount_cents:cents,remaining_cents:cents});
export const payableBulkContextSchema=z.object({version:z.literal(1),tenant_id:uuid,actor_id:uuid,movement:movementSchema,items:z.array(contextItemSchema).min(2).max(100),total_cents:cents,blockers:z.array(z.string()),eligible:z.boolean(),expected_revision:revision}).superRefine((value,ctx)=>{
  if(value.eligible!==(value.blockers.length===0)||value.items.some(item=>!item.eligible)!==value.blockers.includes('finance_payable_bulk_title_invalid'))ctx.addIssue({code:'custom',message:'Prévia de baixa inconsistente.'});
  if(new Set(value.items.map(item=>item.payable_id)).size!==value.items.length)ctx.addIssue({code:'custom',message:'Prévia de baixa contém título repetido.'});
  if(value.items.reduce((sum,item)=>sum+BigInt(item.amount_cents),0n)!==BigInt(value.total_cents))ctx.addIssue({code:'custom',message:'Total da prévia inconsistente.'});
});
export type PayableBulkContext=z.infer<typeof payableBulkContextSchema>;
export const payableBulkCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,movement_id:uuid,bank_account_id:uuid,paid_on:date,expected_revision:revision,items:payableBulkItemsSchema,method:payableBulkMethodSchema,reason:z.string().trim().min(5).max(2000)}).strict();
export type PayableBulkCommand=z.infer<typeof payableBulkCommandSchema>;
export const payableBulkResultSchema=z.object({version:z.literal(1),tenant_id:uuid,actor_id:uuid,request_id:uuid,movement_id:uuid,bank_account_id:uuid,paid_on:date,total_cents:cents,rows:z.array(z.object({payable_id:uuid,payment_id:uuid,link_id:uuid,amount_cents:cents})).min(2).max(100),bank_confirmation:z.literal('not_evaluated'),cash_created:z.literal(false),confirmed:z.literal(true)}).superRefine((value,ctx)=>{
  if(new Set(value.rows.map(row=>row.payable_id)).size!==value.rows.length)ctx.addIssue({code:'custom',message:'Confirmação da baixa contém título repetido.'});
  if(value.rows.reduce((sum,row)=>sum+BigInt(row.amount_cents),0n)!==BigInt(value.total_cents))ctx.addIssue({code:'custom',message:'Total confirmado da baixa inconsistente.'});
});
export type PayableBulkResult=z.infer<typeof payableBulkResultSchema>;
export type PayableBulkSelection={payable_id:string;supplier_id:string|null;supplier_name:string|null;description:string|null;open_cents:string};
export const payableBulkStorageKey=(tenant:string,actor:string)=>`agvlog:payable-bulk-settlement:v1:${tenant}:${actor}`;
