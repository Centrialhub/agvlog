create function finance_private.require_access(_tenant uuid) returns void
language plpgsql stable security definer set search_path='' as $$begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
end;$$;
revoke all on function finance_private.require_access(uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.require_access(uuid) to authenticated;

-- Wrap the existing PL/pgSQL body in an outer guarded block. This preserves
-- defaults, return shape, function OID, ACLs, and the current implementation.
-- Only named financial entry points are targeted; operational trigger builders
-- such as _build_driver_settlement are intentionally not modified.
do $guard_financial_entries$
declare spec record;routine record;definition text;guarded text;expression text;required_arg text;
begin
 for spec in select * from (values
   ('create_manual_driver_settlement','tenant'),('generate_driver_settlement','tenant'),('generate_pending_driver_settlements','tenant'),
   ('generate_payroll_period','tenant'),('import_bank_statement','tenant'),('run_bank_reconciliation','tenant'),('sync_financial_obligations','tenant'),
   ('list_available_loads_for_settlement','tenant'),('list_driver_settlement_filter_options','tenant'),('list_driver_settlements','tenant'),
   ('create_manual_financial_match','tenant'),('audit_data_consistency_v2','tenant'),
   ('get_expense_creation_context','tenant'),('get_expense_receipt_status','tenant'),('inspect_expense_receipt_upload','tenant'),('list_driver_expenses','tenant'),('list_driver_expense_sources','tenant'),
   ('recalculate_manual_expense_settlement','tenant'),
   ('create_manual_expense','payload'),('create_driver_expense_command','payload'),('review_driver_expense','payload'),
   ('apply_driver_settlement_adjustment','payload'),('apply_receivable_financial_command','payload'),
   ('add_driver_settlement_adjustment','settlement'),('add_driver_settlement_manual_expense','settlement'),('attach_loads_to_driver_settlement','settlement'),
   ('delete_driver_settlement','settlement'),('detach_load_from_driver_settlement','settlement'),('register_driver_settlement_payment_v2','settlement'),
   ('remove_driver_settlement_adjustment','settlement'),('settle_zero_driver_settlement','settlement'),('update_driver_settlement_km_review','settlement'),('update_driver_settlement_status','settlement'),
   ('approve_payroll_period','period'),('close_payroll_period','period'),('add_payroll_manual_item','entry'),('recalculate_payroll_entry','entry'),('delete_payroll_entry_item','payroll_item'),
   ('register_payable_payment','payable'),('register_receivable_payment','receivable'),('reverse_payable_payment','payable_payment'),('reverse_receivable_payment','receivable_payment'),
   ('accept_financial_match','match'),('reject_financial_match','match'),('reverse_financial_match','match')
 ) s(name,kind) loop
   required_arg:=case spec.kind when 'tenant' then '_tenant_id' when 'payload' then '_payload' when 'settlement' then '_settlement_id'
     when 'period' then '_period_id' when 'entry' then '_entry_id' when 'payroll_item' then '_item_id' when 'payable' then '_payable_id'
     when 'receivable' then '_receivable_id' when 'match' then '_match_id' else '_payment_id' end;
   expression:=case spec.kind when 'tenant' then '_tenant_id' when 'payload' then '(_payload->>''tenant_id'')::uuid'
     else format('(select financial_scope.tenant_id from public.%I financial_scope where financial_scope.id=%I)',
       case spec.kind when 'settlement' then 'driver_settlements' when 'period' then 'payroll_periods' when 'entry' then 'payroll_entries'
       when 'payroll_item' then 'payroll_entry_items' when 'payable' then 'payables' when 'receivable' then 'receivables'
       when 'match' then 'financial_matches' when 'payable_payment' then 'payables_payments' else 'receivables_payments' end,required_arg) end;
   for routine in select p.*,l.lanname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
     where n.nspname in('public','expense_creation_private','settlement_adjustment_private') and p.proname=spec.name and p.prokind='f'
   loop
     -- Current hardened APIs may be SQL invoker adapters to a private body.
     -- Accept only the known one-call shape and guard that body in this loop.
     if routine.lanname='sql' and routine.prosrc ~ ('^\s*select\s+(expense_creation_private|settlement_adjustment_private)\.'||spec.name||'\([a-zA-Z0-9_,\s]*\);\s*$')
       and exists(select 1 from pg_proc impl join pg_namespace ns on ns.oid=impl.pronamespace join pg_language lang on lang.oid=impl.prolang
         where ns.nspname in('expense_creation_private','settlement_adjustment_private') and impl.proname=spec.name and impl.proargtypes=routine.proargtypes and lang.lanname='plpgsql') then continue;end if;
     if routine.lanname<>'plpgsql' or not coalesce(required_arg=any(routine.proargnames),false) or routine.prosrc~'(?m)^\s*#' then
       raise exception 'Financial entry signature requires review: %',routine.oid::regprocedure;end if;
     if position('<<finance_entry_guard>>' in routine.prosrc)>0 then raise exception 'Financial entry is already guarded: %',routine.oid::regprocedure;end if;
     definition:=pg_get_functiondef(routine.oid);
     guarded:=E'<<finance_entry_guard>>\nBEGIN\n PERFORM finance_private.require_access('||expression||E');\n <<legacy_financial_body>>\n'||routine.prosrc||
       case when right(rtrim(routine.prosrc,E' \t\n\r'),1)=';' then '' else ';' end||E'\nEND;\n';
     execute replace(definition,routine.prosrc,guarded);
   end loop;
 end loop;
end;
$guard_financial_entries$;
