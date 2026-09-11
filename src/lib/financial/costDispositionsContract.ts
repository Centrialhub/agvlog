import {z} from 'zod';
import {expenseCostCoverageSchema,costReturnTotalsFields} from './expenseCostFundingContract';
const uuid=z.string().uuid(),count=z.number().int().nonnegative(),cents=z.string().regex(/^\d+$/).nullable();
export const costDispositionsSchema=z.object({...costReturnTotalsFields,version:z.literal(1),tenant_id:uuid,page:z.number().int().positive(),page_size:z.literal(30),total:count,revision:z.string().regex(/^[a-f0-9]{32}$/),needs_review_count:count,gross_reserved_cents:cents,applied_cents:cents,residual_cents:cents,driver_custody_cents:cents,payment_recovery_cents:cents,rows:z.array(z.object({expense_id:uuid,charge_id:uuid,payable_id:uuid.nullable(),description:z.string().nullable(),occurred_on:z.string().nullable(),coverage:expenseCostCoverageSchema}).strict()).max(30)}).strict();
export type CostDispositions=z.infer<typeof costDispositionsSchema>;
