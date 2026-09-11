import {z} from 'zod';
const uuid=z.string().uuid(),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
export const receivablesPageSchema=z.object({version:z.literal(1),tenant_id:uuid,page:z.number().int().positive(),page_size:z.literal(50),total:z.number().int().nonnegative(),total_unfiltered:z.number().int().nonnegative(),rows:z.array(z.object({
 id:uuid,tenant_id:uuid,client_id:uuid.nullable(),description:z.string().nullable(),invoice_number:z.string().nullable(),notes:z.string().nullable(),amount:z.number().finite(),received_amount:z.number().finite().nullable(),status:z.string(),due_date:date,client_invoice_id:uuid.nullable(),clients:z.object({company_name:z.string().nullable()}).nullable(),
}).passthrough()).max(50)}).superRefine((data,ctx)=>{if(data.total>data.total_unfiltered||data.rows.some(row=>row.tenant_id!==data.tenant_id)||new Set(data.rows.map(row=>row.id)).size!==data.rows.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Lista de títulos inconsistente.'});});
export type ReceivableListFilters={search:string;status:string;client:string;from:string;to:string};
