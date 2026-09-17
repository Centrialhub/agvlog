import {z} from 'zod';
const uuid=z.string().uuid(),count=z.number().int().nonnegative(),money=z.string().regex(/^\d+$/);
const coverage=z.object({covered_count:count,pending_count:count});
export const recordedCostOperationalCoverageSchema=z.object({
 version:z.literal(1),tenant_id:uuid,from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
 filter_scope:z.literal('period_only'),coverage_complete:z.literal(false),totals_additive:z.literal(false),double_counted_cents:z.literal('0'),
 recognized_cost_count:count,recognized_cost_needs_review_count:count,recognized_cost_cents:money.nullable(),review_pending_count:count,
 maintenance:z.object({labor:coverage,direct_parts:coverage,stock_acquisitions:coverage,stock_consumptions:coverage.extend({attribution_count:count,attributed_cents:money}),ambiguous_order_count:count}),
 legacy_driver_expenses:coverage,
 detail_readers:z.tuple([
  z.literal('get_finance_legacy_cost_inventory'),z.literal('get_finance_maintenance_cost_context'),z.literal('get_finance_maintenance_labor_context'),
  z.literal('get_finance_maintenance_direct_part_context'),z.literal('get_finance_stock_acquisition_inventory'),z.literal('get_finance_stock_consumption_context')
 ])
}).superRefine((data,ctx)=>{
 const pending=data.maintenance.labor.pending_count+data.maintenance.direct_parts.pending_count+data.maintenance.stock_acquisitions.pending_count+data.maintenance.stock_consumptions.pending_count+data.maintenance.ambiguous_order_count+data.legacy_driver_expenses.pending_count;
 if(pending!==data.review_pending_count||data.recognized_cost_needs_review_count>data.recognized_cost_count||(data.recognized_cost_needs_review_count===0)!==(data.recognized_cost_cents!==null))ctx.addIssue({code:z.ZodIssueCode.custom,message:'Cobertura operacional inconsistente.'});
});
export type RecordedCostOperationalCoverage=z.infer<typeof recordedCostOperationalCoverageSchema>;
