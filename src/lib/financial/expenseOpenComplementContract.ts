import {z} from 'zod';
const uuid=z.string().uuid(),cents=z.string().regex(/^[1-9]\d{0,13}$/),revision=z.string().regex(/^[a-f0-9]{32}$/);
export const expenseOpenComplementEventSchema=z.object({id:uuid,ordinal:z.number().int().positive(),previous_id:uuid.nullable(),request_id:uuid,actor_id:uuid,actor_name:z.string().nullable(),reason:z.string(),created_at:z.string(),cost_before_cents:cents,cost_after_cents:cents,complement_before_cents:cents,complement_after_cents:cents,allocated_reserved_cents:cents,approval_reset:z.boolean(),revision_after:revision}).strict();
export const expenseOpenComplementSchema=expenseOpenComplementEventSchema.extend({history:z.array(expenseOpenComplementEventSchema)});
export type ExpenseOpenComplement=z.infer<typeof expenseOpenComplementSchema>;
