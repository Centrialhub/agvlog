do $migration$
declare
  target_table text;
begin
  foreach target_table in array array[
    'asset_movements','assets','employee_documents','employees',
    'maintenance_orders','maintenance_parts','receivables','stock_items','stock_movements'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'Admins can manage ' || target_table, target_table);
    execute format('drop policy if exists %I on public.%I', 'Members can view ' || target_table, target_table);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_tenant_operator_or_admin(tenant_id))', target_table || '_internal_select', target_table);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_tenant_admin(tenant_id))', target_table || '_admin_insert', target_table);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_tenant_admin(tenant_id)) with check (public.is_tenant_admin(tenant_id))', target_table || '_admin_update', target_table);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_tenant_admin(tenant_id))', target_table || '_admin_delete', target_table);
  end loop;
end
$migration$;

drop policy if exists bank_accounts_select on public.bank_accounts;
drop policy if exists bank_transactions_select on public.bank_transactions;
drop policy if exists financial_matches_select on public.financial_matches;
drop policy if exists financial_obligations_select on public.financial_obligations;
drop policy if exists payables_select on public.payables;
drop policy if exists bank_recon_sessions_select on public.bank_reconciliation_sessions;
drop policy if exists bank_statement_imports_select on public.bank_statement_imports;

drop policy if exists "payables_payments tenant write" on public.payables_payments;
drop policy if exists "payables_payments tenant read" on public.payables_payments;
create policy payables_payments_internal_access on public.payables_payments
  for all to authenticated
  using (public.is_tenant_operator_or_admin(tenant_id))
  with check (public.is_tenant_operator_or_admin(tenant_id));

drop policy if exists "receivables_payments tenant write" on public.receivables_payments;
drop policy if exists "receivables_payments tenant read" on public.receivables_payments;
create policy receivables_payments_internal_access on public.receivables_payments
  for all to authenticated
  using (public.is_tenant_operator_or_admin(tenant_id))
  with check (public.is_tenant_operator_or_admin(tenant_id));

drop policy if exists "Users can delete cost centers for their tenant" on public.cost_centers;
drop policy if exists "Users can insert cost centers for their tenant" on public.cost_centers;
drop policy if exists "Users can view their own tenant cost centers" on public.cost_centers;
drop policy if exists "Users can update cost centers for their tenant" on public.cost_centers;
create policy cost_centers_internal_access on public.cost_centers
  for all to authenticated
  using (public.is_tenant_operator_or_admin(tenant_id))
  with check (public.is_tenant_operator_or_admin(tenant_id));

drop policy if exists employee_advances_select on public.employee_advances;
create policy employee_advances_select on public.employee_advances for select to authenticated using (public.is_tenant_operator_or_admin(tenant_id));
drop policy if exists employee_contracts_select on public.employee_contracts;
create policy employee_contracts_select on public.employee_contracts for select to authenticated using (public.is_tenant_operator_or_admin(tenant_id));
drop policy if exists payroll_entries_select on public.payroll_entries;
create policy payroll_entries_select on public.payroll_entries for select to authenticated using (public.is_tenant_operator_or_admin(tenant_id));
drop policy if exists payroll_entry_items_select on public.payroll_entry_items;
create policy payroll_entry_items_select on public.payroll_entry_items for select to authenticated using (public.is_tenant_operator_or_admin(tenant_id));
drop policy if exists payroll_periods_select on public.payroll_periods;
create policy payroll_periods_select on public.payroll_periods for select to authenticated using (public.is_tenant_operator_or_admin(tenant_id));
