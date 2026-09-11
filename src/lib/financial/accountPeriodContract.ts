import {z} from 'zod';
const cents=z.string().regex(/^-?\d+$/),count=z.number().int().nonnegative();
const totals=z.object({count,in_count:count,out_count:count,in_cents:cents,out_cents:cents,net_cents:cents});
export const accountPeriodSchema=z.object({version:z.literal(1),tenant_id:z.string().uuid(),bank_account_id:z.string().uuid(),account_name:z.string(),from:z.string(),to:z.string(),
 bank:totals,recorded:totals,difference:z.object({in_cents:cents,out_cents:cents,net_cents:cents}),
 unmatched_bank_count:count,unmatched_movement_count:count,evidence_review_count:count,cross_period_count:count,manual_group_count:count,unverified_entry_count:count,unresolved_row_count:count,
 opening_balance_cents:z.null(),closing_balance_cents:z.null(),coverage_status:z.literal('pending'),legacy_integration_status:z.literal('pending'),can_close:z.literal(false)});
