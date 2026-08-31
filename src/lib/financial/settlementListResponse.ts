import { z } from 'zod';
import type { DriverSettlementListItem } from '@/hooks/useDriverSettlements';

const amount = z.number().finite().nullable();
const count = z.number().int().nonnegative();
const itemSchema = z.object({
  id: z.string().uuid(), tenant_id: z.string().uuid(),
  status: z.enum(['pending_review', 'in_review', 'approved', 'paid', 'closed', 'reopened']),
  driver_name: z.string().nullable().optional(), vehicle_plate: z.string().nullable().optional(),
  route_name: z.string().nullable(), route_origin: z.string().nullable(), route_destination: z.string().nullable(),
  trip_completed_at: z.string().refine(value => Number.isFinite(Date.parse(value))).nullable(),
  loads_count: count, documents_count: count, total_weight_kg: amount,
  estimated_km: amount, audited_km: amount, total_goods_value: amount, total_invoice_value: amount,
  total_freight_revenue: amount, total_freight_value: amount, approved_expenses_total: amount,
  route_result: amount, operational_balance: amount, driver_payable_amount: amount,
  pending_expenses_total: amount, total_paid_amount: amount,
  km_review_status: z.enum(['pending', 'reviewed', 'disputed']).nullable(),
  needs_recalculation: z.boolean(), approved_with_exception: z.boolean(),
}).passthrough();
const responseSchema = z.object({
  items: z.array(itemSchema), total_count: count, page: count.min(1), page_size: count.min(1).max(100),
  summary: z.object({
    total_count: count, pending_count: count, in_review_count: count, approved_count: count,
    paid_closed_count: count, needs_recalculation_count: count, km_pending_count: count,
    expense_pending_count: count, total_payable: z.number().finite(), total_paid: z.number().finite(),
    payment_balance: z.number().finite(), route_result_total: z.number().finite(), approved_expenses_total: z.number().finite(),
  }),
});
export function parseSettlementList(value: unknown, tenant: string) {
  const parsed = responseSchema.parse(value);
  if (parsed.items.some(item => item.tenant_id !== tenant) || parsed.summary.total_count !== parsed.total_count) {
    throw new Error('A listagem não corresponde ao contexto solicitado.');
  }
  return { ...parsed, items: parsed.items as DriverSettlementListItem[] };
}
const filtersSchema = z.object({
  drivers: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  vehicles: z.array(z.object({ id: z.string().uuid(), plate: z.string() })),
});
export const parseSettlementFilterOptions = (value: unknown) => filtersSchema.parse(value);
