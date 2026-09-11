import {z} from 'zod';
const uuid=z.string().uuid();
export const expenseComplementExtinctionSchema=z.object({id:uuid,regularization_id:uuid,request_id:uuid,actor_id:uuid,reason:z.string(),created_at:z.string().datetime({offset:true}),cancelled_nominal_cents:z.string().regex(/^[1-9]\d*$/),residual_cents:z.string().regex(/^(0|[1-9]\d*)$/)}).strict();
export type ExpenseComplementExtinction=z.infer<typeof expenseComplementExtinctionSchema>;
