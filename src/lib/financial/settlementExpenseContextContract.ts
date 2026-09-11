import {expenseCostCoverageSchema} from './expenseCostFundingContract';
import {expenseCostOriginSchema} from './unloadingCostCorrectionContract';
import {z} from 'zod';
const uuid=z.string().uuid(),cents=z.string().regex(/^\d+$/).nullable(),count=z.number().int().nonnegative();
export const settlementExpenseContextSchema=z.object({version:z.literal(1),tenant_id:uuid,settlement_id:uuid,trip_id:uuid.nullable(),page:z.number().int().positive(),page_size:z.literal(30),total:count,total_cents:cents,allocated_cents:cents,payable_cents:cents,paid_cents:cents,outstanding_cents:cents,needs_review_count:count,
 rows:z.array(z.object({id:uuid,batch_id:uuid,coverage:expenseCostCoverageSchema.optional(),complement_cents:cents.optional(),cost_origin:expenseCostOriginSchema.nullable().optional(),category:z.string(),description:z.string(),occurred_on:z.string(),amount_cents:cents,allocated_cents:cents,payable_id:uuid.nullable(),payee_type:z.enum(['driver','supplier','none','unknown']),payee_name:z.string().nullable(),payable_cents:cents,paid_cents:cents,outstanding_cents:cents,payable_status:z.string().nullable(),needs_review:z.boolean()})).max(30)});
