import {z} from 'zod';
import {expenseCancellationEventSchema} from './expenseCancellationContract';
const uuid=z.string().uuid(),money=z.number().int().nonnegative().max(99999999999999),total=z.string().regex(/^\d+$/);
export interface ExpenseFilters {page:number;page_size:number;from:string;to:string;search:string;category:string;context:string;missing_receipt:boolean;cost_center?:string}
export const expenseHistorySchema=z.object({version:z.literal(1),tenant_id:uuid,page:z.number().int().positive(),page_size:z.number().int().positive().max(100),
  active_count:z.number().int().nonnegative(),cancelled_count:z.number().int().nonnegative(),historical_total_cents:total,cancelled_total_cents:total,total:z.number().int().nonnegative(),total_cents:total,allocated_cents:total,complement_cents:total,missing_receipt_count:z.number().int().nonnegative(),
  categories:z.array(z.object({category:z.string(),amount_cents:total,item_count:z.number().int().nonnegative()})),
  cost_centers:z.array(z.object({cost_center_id:uuid.nullable(),cost_center_name:z.string().nullable(),amount_cents:total,item_count:z.number().int().nonnegative()})).default([]),
  rows:z.array(z.object({cancelled:z.boolean(),cancellation:expenseCancellationEventSchema.nullable(),id:uuid,tenant_id:uuid,batch_id:uuid,category:z.string(),description:z.string(),amount_cents:money,occurred_on:z.string(),
    supplier_name:z.string(),document_number:z.string().nullable(),receipt_path:z.string().nullable(),no_receipt_reason:z.string().nullable(),
    context:z.string(),trip_id:uuid.nullable(),driver_id:uuid.nullable(),batch_description:z.string(),cost_center_name:z.string().nullable(),
    allocated_cents:money,payable_id:uuid.nullable(),payable_status:z.string().nullable(),unloading_id:uuid.nullable(),receivable_id:uuid.nullable(),
    reimbursement_supplier_id:uuid.nullable(),reimbursement_supplier_name:z.string().nullable(),receivable_status:z.string().nullable(),
    created_by:uuid,created_at:z.string(),
    allocations:z.array(z.object({movement_id:uuid,amount_cents:money,movement_amount_cents:money,beneficiary_name:z.string(),occurred_on:z.string(),bank_reference:z.string().nullable()})),
    history:z.array(z.object({id:uuid,actor_id:uuid,actor_name:z.string(),action:z.string(),reason:z.string(),created_at:z.string()})),
  })),
});
export type ExpenseHistoryRow=z.infer<typeof expenseHistorySchema>['rows'][number];
