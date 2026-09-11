-- Additional restrictive boundary: preserve each table's existing role rules
-- while denying driver identities, including mixed driver/internal accounts.
create function finance_private.not_driver(_tenant uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select _tenant is not null and auth.uid() is not null
   and not exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role::text='driver')
   and not exists(select 1 from public.drivers d where d.tenant_id=_tenant and d.user_id=auth.uid() and d.active);
$$;
revoke all on function finance_private.not_driver(uuid) from public,anon,authenticated,service_role;
grant usage on schema finance_private to anon;
grant execute on function finance_private.not_driver(uuid) to anon,authenticated;
do $$declare t record;begin
 for t in select c.table_name from information_schema.columns c join information_schema.tables tb using(table_catalog,table_schema,table_name)
   where c.table_schema='public' and c.column_name='tenant_id' and tb.table_type='BASE TABLE' and
   (c.table_name in('bank_accounts','bank_transactions','bank_statement_imports','bank_reconciliation_sessions','bank_reconciliation_audit',
     'financial_matches','financial_obligations','payables','payables_payments','receivables','receivables_payments','load_payments','load_unloading_charges','closing_report_payments')
    or c.table_name ~ '^(driver_expens|driver_settlement|payroll_|expense_creation_|expense_review_|settlement_adjustment_|receivable_financial_)')
 loop
   execute format('alter table public.%I enable row level security',t.table_name);
   execute format('create policy finance_no_driver_boundary on public.%I as restrictive for all to anon,authenticated using(finance_private.not_driver(tenant_id)) with check(finance_private.not_driver(tenant_id))',t.table_name);

 end loop;
end;$$;
do $$declare routine record;begin
 for routine in select p.oid::regprocedure identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='driver_create_expense'
 loop execute format('revoke all on function %s from public,anon,authenticated',routine.identity);end loop;
end;$$;
