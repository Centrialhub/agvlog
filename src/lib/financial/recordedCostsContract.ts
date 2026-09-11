import {z} from 'zod';
const uuid=z.string().uuid(),count=z.number().int().nonnegative(),money=z.string().regex(/^\d+$/).nullable();
export interface RecordedCostFilters {page:number;from:string;to:string;search:string;cost_center:string;category:string}
export const recordedCostsSchema=z.object({version:z.literal(1),tenant_id:uuid,page:z.number().int().positive(),page_size:z.literal(30),total:count,total_cents:money,
 cancelled_count:count,needs_review_count:count,recorded_date_count:count,coverage:z.enum(['recorded_batches_and_manual_expenses','recorded_batches_manual_and_payroll_remuneration']),
 payroll_unclassified_count:count.default(0),payroll_unclassified_cents:z.string().regex(/^-?\d+$/).default('0'),
 cost_centers:z.array(z.object({cost_center_id:uuid.nullable(),cost_center_name:z.string().nullable(),amount_cents:money,item_count:count})),
 categories:z.array(z.object({category:z.string(),amount_cents:money,item_count:count})),
 rows:z.array(z.object({source:z.enum(['expense_batch','manual_expense','payroll_item']),id:uuid,description:z.string(),supplier_name:z.string(),category:z.string(),occurred_on:z.string(),date_basis:z.enum(['expense_date','competence_date','recorded_date','payroll_period']),amount_cents:money,cost_center_id:uuid.nullable(),cost_center_name:z.string().nullable(),payable_id:uuid.nullable(),cancelled:z.boolean(),needs_review:z.boolean()})).max(30),
});
