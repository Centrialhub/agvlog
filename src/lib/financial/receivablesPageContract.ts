import {receivableCreditTextFields,creditCompositionValid,legacyReceivableCents} from './receivableCreditAmounts';
import {z} from 'zod';
const uuid=z.string().uuid(),date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const pageObject=z.object({version:z.literal(1),tenant_id:uuid,page:z.number().int().positive(),page_size:z.literal(50),total:z.number().int().nonnegative(),total_unfiltered:z.number().int().nonnegative(),rows:z.array(z.object({
 ...receivableCreditTextFields,open_cents:z.string().regex(/^(0|[1-9]\d*)$/).nullable().optional(),id:uuid,tenant_id:uuid,client_id:uuid.nullable(),description:z.string().nullable(),invoice_number:z.string().nullable(),notes:z.string().nullable(),amount:z.number().finite(),received_amount:z.number().finite().nullable(),status:z.string(),due_date:date,client_invoice_id:uuid.nullable(),clients:z.object({company_name:z.string().nullable()}).nullable(),
}).passthrough()).max(50)});
const consistency=(data:z.infer<typeof pageObject>|z.infer<typeof originObject>,ctx:z.RefinementCtx)=>{if(data.rows.some(row=>!creditCompositionValid(row,legacyReceivableCents(row.received_amount))))ctx.addIssue({code:'custom',message:'Composição da liquidação inválida.'});if(data.total>data.total_unfiltered||data.rows.some(row=>row.tenant_id!==data.tenant_id)||new Set(data.rows.map(row=>row.id)).size!==data.rows.length)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Lista de títulos inconsistente.'});if('origin_filter' in data&&data.rows.some(row=>!['unloading','fiscal','other'].includes(String(row.origin_kind))||(data.origin_filter!=='all'&&row.origin_kind!==data.origin_filter)))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Origem dos títulos inconsistente.'});};
export const receivablesPageSchema=pageObject.superRefine(consistency);
export const receivableOrigins=['all','unloading','fiscal','other'] as const;
const originObject=pageObject.extend({version:z.literal(2),origin_filter:z.enum(receivableOrigins)});
export const receivablesOriginPageSchema=originObject.superRefine(consistency);
export type ReceivableListFilters={search:string;status:string;client:string;from:string;to:string;origin?:string};
