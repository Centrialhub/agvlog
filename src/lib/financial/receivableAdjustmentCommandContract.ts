import {z} from 'zod';
const id=z.string().uuid();
export const receivableAdjustmentKindSchema=z.enum(['discount','loss']);
export const receivableAdjustmentCommandSchema=z.object({version:z.literal(1),tenant_id:id,request_id:id,receivable_id:id,action:z.enum(['apply','reverse']),kind:receivableAdjustmentKindSchema,adjustment_id:id.nullable(),amount_cents:z.string().regex(/^[1-9]\d{0,13}$/),effective_on:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),expected_revision:z.string().regex(/^[a-f0-9]{32}$/),reason:z.string().refine(value=>value.trim().length>=5&&value.trim().length<=2000)}).strict().refine(value=>(value.action==='apply')===(value.adjustment_id===null),'A reversão deve identificar o ajuste original.');
export type ReceivableAdjustmentCommand=z.infer<typeof receivableAdjustmentCommandSchema>;
