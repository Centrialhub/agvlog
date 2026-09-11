-- Keep the finance read models behind RLS even when their original migrations
-- used dynamic DDL. Explicit statements make the release gate auditable and
-- ensure a later default-privilege change cannot widen the Data API surface.
alter table public.finance_expense_batches enable row level security;
alter table public.finance_expense_items enable row level security;
alter table public.finance_expense_allocations enable row level security;
alter table public.finance_statement_imports enable row level security;
alter table public.finance_bank_entries enable row level security;
alter table public.finance_statement_rows enable row level security;
alter table public.finance_reconciliation_groups enable row level security;
alter table public.finance_reconciliation_reversals enable row level security;
alter table public.finance_account_openings enable row level security;
alter table public.finance_account_opening_reversals enable row level security;
alter table public.finance_statement_coverage_approvals enable row level security;
alter table public.finance_statement_coverage_reversals enable row level security;
alter table public.finance_legacy_receipt_movement_links enable row level security;
alter table public.finance_legacy_receipt_link_reversals enable row level security;
alter table public.finance_legacy_expense_cost_links enable row level security;
alter table public.finance_legacy_expense_cost_reversals enable row level security;
alter table public.finance_maintenance_labor_links enable row level security;
alter table public.finance_maintenance_labor_reversals enable row level security;
alter table public.finance_maintenance_direct_part_links enable row level security;
alter table public.finance_maintenance_direct_part_reversals enable row level security;
alter table public.finance_account_period_closures enable row level security;
alter table public.finance_account_period_reopenings enable row level security;
alter table public.finance_account_period_dependencies enable row level security;

revoke all on table
 public.finance_expense_batches,
 public.finance_expense_items,
 public.finance_expense_allocations,
 public.finance_statement_imports,
 public.finance_bank_entries,
 public.finance_statement_rows,
 public.finance_reconciliation_groups,
 public.finance_reconciliation_reversals,
 public.finance_account_openings,
 public.finance_account_opening_reversals,
 public.finance_statement_coverage_approvals,
 public.finance_statement_coverage_reversals,
 public.finance_legacy_receipt_movement_links,
 public.finance_legacy_receipt_link_reversals,
 public.finance_legacy_expense_cost_links,
 public.finance_legacy_expense_cost_reversals,
 public.finance_maintenance_labor_links,
 public.finance_maintenance_labor_reversals,
 public.finance_maintenance_direct_part_links,
 public.finance_maintenance_direct_part_reversals,
 public.finance_account_period_closures,
 public.finance_account_period_reopenings,
 public.finance_account_period_dependencies
from public, anon, authenticated, service_role;

-- Browser and worker access is read-only. All mutations remain behind the
-- already-defined audited RPCs/security-definer commands.
grant select on table
 public.finance_expense_batches,
 public.finance_expense_items,
 public.finance_expense_allocations,
 public.finance_statement_imports,
 public.finance_bank_entries,
 public.finance_statement_rows,
 public.finance_reconciliation_groups,
 public.finance_reconciliation_reversals,
 public.finance_account_openings,
 public.finance_account_opening_reversals,
 public.finance_statement_coverage_approvals,
 public.finance_statement_coverage_reversals,
 public.finance_legacy_receipt_movement_links,
 public.finance_legacy_receipt_link_reversals,
 public.finance_legacy_expense_cost_links,
 public.finance_legacy_expense_cost_reversals,
 public.finance_maintenance_labor_links,
 public.finance_maintenance_labor_reversals,
 public.finance_maintenance_direct_part_links,
 public.finance_maintenance_direct_part_reversals,
 public.finance_account_period_closures,
 public.finance_account_period_reopenings,
 public.finance_account_period_dependencies
to authenticated, service_role;
