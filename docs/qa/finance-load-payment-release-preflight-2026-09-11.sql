select jsonb_build_object(
 'canonical_command',to_regprocedure('public.apply_receivable_financial_command(jsonb)') is not null,
 'finance_boundary',to_regprocedure('finance_private.require_access(uuid)') is not null,
 'unapplied',to_regclass('private.load_payment_commands') is null and to_regprocedure('public.apply_load_payment_command(jsonb)') is null,
 'columns_absent',(select count(*)=0 from information_schema.columns where table_schema='public' and table_name='load_payments' and column_name in ('load_payment_command_id','receivable_payment_id','bank_transaction_id')),
 'tables',(select jsonb_agg(jsonb_build_object('table',x.name,'exists',to_regclass('public.'||x.name) is not null)) from unnest(array['loads','load_payments','load_status_history','receivables','receivables_payments','bank_accounts','bank_transactions','receivable_financial_commands']) x(name)),
 'tenant_unique_keys',(select jsonb_agg(jsonb_build_object('table',t.relname,'columns',pg_get_indexdef(i.indexrelid))) from pg_index i join pg_class t on t.oid=i.indrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname='public' and t.relname=any(array['loads','receivables','receivables_payments','bank_accounts','bank_transactions','receivable_financial_commands']) and i.indisunique),
 'history_columns',(select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='load_status_history')
) as load_payment_preflight;
