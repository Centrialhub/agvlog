import {z} from 'zod';
const uuid=z.string().uuid(),cents=z.number().int().nonnegative().max(99999999999999);
const intervention=z.object({id:uuid,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string()});
const common={link_id:uuid,payment_id:uuid,receivable_id:uuid,reference:z.string(),created_at:z.string(),amount_cents:cents,
 credit:z.object({id:uuid,amount_cents:cents,created_at:z.string()}).nullable(),reversal_id:uuid.nullable(),
};
export const movementReceiptTraceRowSchema=z.discriminatedUnion('origin',[
 z.object({...common,origin:z.literal('canonical'),command_id:uuid,action:z.enum(['receive','reverse']),correction:intervention.nullable(),association:z.null(),association_reversal:z.null()}),
 z.object({...common,origin:z.literal('legacy_adoption'),command_id:z.null(),action:z.literal('receive'),correction:z.null(),association:z.object({actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string(),existing_receipt_confirmed:z.literal(true)}),association_reversal:intervention.nullable()}),
]).superRefine((row,ctx)=>{if(row.origin==='canonical'&&row.link_id!==row.command_id)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Vínculo canônico fora do comando.'});});
export const movementReceiptTraceSchema=z.object({version:z.literal(1),tenant_id:uuid,movement_id:uuid,page:z.number().int().positive(),page_size:z.literal(20),total:z.number().int().nonnegative(),rows:z.array(movementReceiptTraceRowSchema).max(20)});
