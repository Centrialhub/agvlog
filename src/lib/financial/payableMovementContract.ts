import {z} from 'zod';
const uuid=z.string().uuid(),cents=z.string().regex(/^\d+$/);
export const payableMovementCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,payable_id:uuid,movement_id:uuid,
 amount_cents:z.number().int().positive().max(99999999999999),method:z.enum(['pix','boleto','ted','doc','dinheiro','cartao','debito_automatico','other']),reason:z.string().trim().min(5).max(2000)}).strict();
export type PayableMovementCommand=z.infer<typeof payableMovementCommandSchema>;
export const payableMovementOptionSchema=z.object({id:uuid,beneficiary_name:z.string(),description:z.string(),occurred_on:z.string(),
 bank_reference:z.string().nullable(),bank_account_id:uuid,account_name:z.string(),amount_cents:cents,remaining_cents:cents});
export type PayableMovementOption=z.infer<typeof payableMovementOptionSchema>;
export const payableMovementOptionsSchema=z.object({version:z.literal(1),tenant_id:uuid,payable_id:uuid,page:z.number().int().positive(),total:z.number().int().nonnegative(),
 payable_status:z.string(),payable_name:z.string(),remaining_cents:cents,can_apply:z.boolean(),rows:z.array(payableMovementOptionSchema)});
export const payableMovementResultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,payment_id:uuid,link_id:uuid,payable_id:uuid,movement_id:uuid,amount_cents:cents,bank_confirmation:z.literal('not_evaluated')});
export const payableReversalCommandSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,link_id:uuid,reason:z.string().trim().min(10).max(2000)}).strict();
export type PayableReversalCommand=z.infer<typeof payableReversalCommandSchema>;
export const payableReversalResultSchema=z.object({version:z.literal(1),tenant_id:uuid,request_id:uuid,reversal_id:uuid,link_id:uuid,payment_id:uuid,payable_id:uuid,movement_id:uuid,released_cents:cents});
export const payablePaymentHistorySchema=z.object({version:z.literal(1),tenant_id:uuid,payable_id:uuid,page:z.number().int().positive(),total:z.number().int().nonnegative(),rows:z.array(z.object({
 id:uuid,tenant_id:uuid,payable_id:uuid,amount:z.number(),paid_at:z.string(),method:z.string(),notes:z.string().nullable(),account_name:z.string().nullable(),link_id:uuid.nullable(),movement_id:uuid.nullable(),link_origin:z.enum(['canonical','legacy_adoption']).nullable(),
 reversal:z.object({id:uuid,actor_id:uuid,actor_name:z.string(),reason:z.string(),created_at:z.string()}).nullable(),
}))});
