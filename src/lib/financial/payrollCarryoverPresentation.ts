type PayrollCarryoverEntry = { source_summary?: unknown };
type PayrollCarryoverItem = {
  item_type: string;
  source_table?: string | null;
  source_metadata?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function payrollCarryoverInAmount(entry: PayrollCarryoverEntry): number {
  const summary = record(entry.source_summary);
  const carryover = record(summary?.payroll_carryover);
  const cents = carryover?.amount_cents;
  return typeof cents === 'string' && /^[0-9]{1,14}$/.test(cents) ? Number(cents) / 100 : 0;
}

export function isPayrollCarryoverItem(item: PayrollCarryoverItem): boolean {
  return item.item_type === 'other'
    && item.source_table === 'payroll_entries'
    && record(record(item.source_metadata)?.payroll_carryover) !== null;
}

export function payrollItemTypeLabel(item: PayrollCarryoverItem, labels: Record<string, string>): string {
  return isPayrollCarryoverItem(item) ? 'Saldo transportado' : labels[item.item_type] ?? item.item_type;
}
