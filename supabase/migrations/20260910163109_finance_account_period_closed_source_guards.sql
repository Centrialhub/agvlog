create function finance_private.closed_interval_exists(_tenant uuid,_account uuid,_from date,_to date) returns boolean language sql stable set search_path='' as $$
select exists(select 1 from public.finance_account_period_closures c where c.tenant_id=_tenant and (_account is null or c.account_id=_account)
 and (_from is null or not isfinite(_from) or c.period_end>=_from) and (_to is null or not isfinite(_to) or c.period_start<=_to)
 and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=c.tenant_id and r.closure_id=c.id))$$;
create function finance_private.assert_closed_source_mutable(_tenant uuid,_table text,_row jsonb,_depth integer default 0) returns void language plpgsql security definer set search_path='' as $$
declare account uuid;start_date date;end_date date;ref record;source_table text;source jsonb;identifier uuid;raw_date text;hit boolean:=false;outgoing public.finance_movements%rowtype;incoming public.finance_movements%rowtype;native jsonb;imp public.finance_statement_imports%rowtype;registered public.bank_accounts%rowtype;closed public.finance_account_period_closures%rowtype;anchor date;
begin
 if _row is null or _row='null'::jsonb then return;end if;
 if _table='employee_advances' and _row->>'status' is distinct from 'paid' and _row->>'paid_at' is null then return;end if;
 if _depth>8 then raise exception 'finance_closed_source_resolution_required' using errcode='55000';end if;
 if not finance_private.closed_interval_exists(_tenant,null,null,null) then return;end if;
 identifier:=nullif(_row->>'id','')::uuid;
 if exists(select 1 from public.finance_account_period_dependencies d join public.finance_account_period_closures c on c.tenant_id=d.tenant_id and c.id=d.closure_id where d.tenant_id=_tenant and d.source_kind=_table and d.source_id=identifier and d.dependency_role<>'composition_snapshot' and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=c.tenant_id and r.closure_id=c.id)) then raise exception 'finance_account_period_closed' using errcode='55000';end if;
 account:=coalesce(nullif(_row->>'bank_account_id','')::uuid,nullif(_row->>'account_id','')::uuid);
 if _table='finance_internal_transfers' then
  select * into outgoing from public.finance_movements where tenant_id=_tenant and id=(_row->>'outgoing_id')::uuid;
  select * into incoming from public.finance_movements where tenant_id=_tenant and id=(_row->>'incoming_id')::uuid;
  -- An already identified departure may arrive later. Its frozen leg stays intact.
  if finance_private.closed_interval_exists(_tenant,outgoing.bank_account_id,outgoing.occurred_on,outgoing.occurred_on) then
   if not exists(select 1 from public.finance_transfer_departures p where p.tenant_id=_tenant and p.outgoing_id=outgoing.id and p.destination_account_id=incoming.bank_account_id
    and not exists(select 1 from public.finance_account_period_closures c where c.tenant_id=_tenant and c.account_id=outgoing.bank_account_id and outgoing.occurred_on between c.period_start and c.period_end and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=c.tenant_id and r.closure_id=c.id)
      and (incoming.occurred_on<=c.period_end or not exists(select 1 from public.finance_account_period_dependencies d where d.tenant_id=_tenant and d.closure_id=c.id and d.source_kind='finance_transfer_departures' and d.source_id=p.id)))) then raise exception 'finance_account_period_closed' using errcode='55000';end if;
   perform finance_private.assert_closed_source_mutable(_tenant,'finance_movements',to_jsonb(incoming),_depth+1);return;
  end if;
 end if;
 if _table='finance_statement_verifications' then
  select * into imp from public.finance_statement_imports where tenant_id=_tenant and id=(_row->>'import_id')::uuid;
  native:=_row#>'{report,native_evidence}';
  if native is not null then
   if finance_private.closed_interval_exists(_tenant,imp.bank_account_id,(native#>>'{period,start,date}')::date,(native#>>'{period,end,date}')::date) then raise exception 'finance_account_period_closed' using errcode='55000';end if;
   anchor:=(native#>>'{ledger_balance,as_of,date}')::date;
   for closed in select c.* from public.finance_account_period_closures c where c.tenant_id=_tenant and c.account_id=imp.bank_account_id and anchor between c.period_start and c.period_end and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=c.tenant_id and r.closure_id=c.id) loop
    select * into registered from public.bank_accounts where tenant_id=_tenant and id=imp.bank_account_id;
    if anchor is distinct from closed.period_end or native#>>'{ledger_balance,amount_cents}' is distinct from closed.snapshot#>>'{balances,closing_cents}'
     or native#>>'{ledger_balance,as_of,offset_minutes}' is distinct from '-180' or native#>>'{period,start,offset_minutes}' is distinct from '-180' or native#>>'{period,end,offset_minutes}' is distinct from '-180'
     or native->>'currency' is distinct from 'BRL' or native->>'parser_version' is distinct from 'native-ofx-v1'
     or native#>>'{account,bank_id}' is distinct from btrim(registered.bank_code) or native#>>'{account,branch_id}' is distinct from btrim(registered.branch_number) or native#>>'{account,account_id}' is distinct from btrim(registered.account_number)
     or native#>>'{account,account_type}' is distinct from (case registered.account_type when 'checking' then 'CHECKING' when 'savings' then 'SAVINGS' end)
     or _row->>'outcome' is distinct from 'rows_match' or _row#>>'{report,hash_verified}' is distinct from 'true' or _row#>>'{report,actual_hash}' is distinct from imp.file_hash or _row#>>'{report,identity_trust}' is distinct from 'native_file_identifier'
     or native->>'outside_declared_period' is distinct from 'false' or native->'repeated_bank_ids' is distinct from '[]'::jsonb
    then raise exception 'finance_closed_anchor_conflict' using errcode='55000';end if;
   end loop;
  end if;
 end if;
 if _table in('finance_statement_imports','finance_statement_coverage_approvals','finance_period_evidence_reviews','finance_legacy_cut_reviews') then
  start_date:=(_row->>'period_start')::date;end_date:=(_row->>'period_end')::date;
 elsif _table='finance_account_openings' then start_date:=(_row->>'effective_from')::date;end_date:=null;
 else
  raw_date:=coalesce(_row->>'occurred_on',_row->>'posted_on',_row->>'posted_at',_row->>'received_at',_row->>'paid_at',_row->>'effective_at',_row->>'payment_date',_row->>'advance_date',_row->>'occurred_at',_row->>'competence_date');
  if raw_date is not null then start_date:=(raw_date::timestamptz at time zone 'America/Sao_Paulo')::date;
   if raw_date ~ '^\d{4}-\d{2}-\d{2}$' then start_date:=raw_date::date;end if;end_date:=start_date;end if;
 end if;
 if start_date is not null or _table in('finance_movements','finance_bank_entries','bank_transactions','receivables_payments','payables_payments','driver_settlement_payments','closing_report_payments','load_payments','employee_advances','payroll_entry_items') then
  if finance_private.closed_interval_exists(_tenant,account,start_date,end_date) then raise exception 'finance_account_period_closed' using errcode='55000';end if;
  hit:=true;
 end if;
 for ref in select key,value from jsonb_each_text(_row) where key in('import_id','first_import_id','row_id','review_id','group_id','opening_id','approval_id','bank_transaction_id','bank_entry_id','movement_id','outgoing_id','incoming_id','receivable_payment_id','payment_id') and value is not null loop
  source_table:=case ref.key when 'import_id' then case when _table='bank_transactions' then null else 'finance_statement_imports' end when 'first_import_id' then 'finance_statement_imports' when 'row_id' then 'finance_statement_rows' when 'review_id' then 'finance_statement_identity_reviews' when 'group_id' then 'finance_reconciliation_groups' when 'opening_id' then 'finance_account_openings' when 'approval_id' then 'finance_statement_coverage_approvals' when 'bank_transaction_id' then 'bank_transactions' when 'bank_entry_id' then 'finance_bank_entries' when 'movement_id' then 'finance_movements' when 'outgoing_id' then 'finance_movements' when 'incoming_id' then 'finance_movements' when 'receivable_payment_id' then 'receivables_payments' when 'payment_id' then case when _table='receivable_payment_reversals' then 'receivables_payments' end end;
  if source_table is not null then
   if _table='receivable_payment_reversals' and ref.key='payment_id' and start_date is not null then continue;end if;
   execute format('select to_jsonb(s) from public.%I s where s.tenant_id=$1 and s.id=$2',source_table) into source using _tenant,ref.value::uuid;
   if source is null then raise exception 'finance_closed_source_resolution_required' using errcode='55000';end if;
   perform finance_private.assert_closed_source_mutable(_tenant,source_table,source,_depth+1);hit:=true;
  end if;
 end loop;
 if _table='finance_reconciliation_groups' then
  for identifier in select value::uuid from jsonb_array_elements_text(_row->'movement_ids') loop select to_jsonb(m) into source from public.finance_movements m where m.tenant_id=_tenant and m.id=identifier;perform finance_private.assert_closed_source_mutable(_tenant,'finance_movements',source,_depth+1);end loop;
  for identifier in select value::uuid from jsonb_array_elements_text(_row->'bank_entry_ids') loop select to_jsonb(e) into source from public.finance_bank_entries e where e.tenant_id=_tenant and e.id=identifier;perform finance_private.assert_closed_source_mutable(_tenant,'finance_bank_entries',source,_depth+1);end loop;hit:=true;
 end if;
 if not hit then raise exception 'finance_closed_source_resolution_required' using errcode='55000';end if;
end$$;
revoke all on function finance_private.closed_interval_exists(uuid,uuid,date,date),finance_private.assert_closed_source_mutable(uuid,text,jsonb,integer) from public,anon,authenticated,service_role;

create function finance_private.guard_closed_financial_source() returns trigger language plpgsql security definer set search_path='' as $$
declare data jsonb;t uuid;identity jsonb;bank public.bank_accounts%rowtype;begin
 if tg_op='UPDATE' and to_jsonb(new)=to_jsonb(old) then return new;end if;
 for data in select value from jsonb_array_elements(case when tg_op='INSERT' then jsonb_build_array(to_jsonb(new)) when tg_op='DELETE' then jsonb_build_array(to_jsonb(old)) else jsonb_build_array(to_jsonb(old),to_jsonb(new)) end) loop
  t:=(data->>'tenant_id')::uuid;
  if t is null then raise exception 'finance_closed_source_resolution_required' using errcode='55000';end if;
  if not pg_try_advisory_xact_lock(hashtextextended(t::text||':finance',0)) then raise exception 'finance_period_source_busy' using errcode='40001';end if;
  if not finance_private.closed_interval_exists(t,null,null,null) then continue;end if;
  if tg_table_name='bank_accounts' then
   if tg_op='UPDATE' and (to_jsonb(old)-array['name','bank_name','pix_key','updated_at'])=(to_jsonb(new)-array['name','bank_name','pix_key','updated_at']) then continue;end if;
   if exists(select 1 from public.finance_account_period_closures c where c.tenant_id=t and c.account_id=(data->>'id')::uuid and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=c.tenant_id and r.closure_id=c.id)) then raise exception 'finance_account_period_closed' using errcode='55000';end if;
   if exists(select 1 from public.bank_accounts b join public.finance_account_period_closures c on c.tenant_id=b.tenant_id and c.account_id=b.id where b.tenant_id=t and b.id<>(data->>'id')::uuid and regexp_replace(coalesce(b.bank_code,''),'\D','','g')=regexp_replace(coalesce(data->>'bank_code',''),'\D','','g') and regexp_replace(coalesce(b.branch_number,''),'\D','','g')=regexp_replace(coalesce(data->>'branch_number',''),'\D','','g') and regexp_replace(coalesce(b.account_number,''),'\D','','g')=regexp_replace(coalesce(data->>'account_number',''),'\D','','g') and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=c.tenant_id and r.closure_id=c.id)) then raise exception 'finance_closed_account_identity_conflict' using errcode='55000';end if;
  elsif tg_table_name='payroll_entry_items' and data->>'nature' is distinct from 'already_paid' then continue;
  else perform finance_private.assert_closed_source_mutable(t,tg_table_name,data);end if;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end$$;
revoke all on function finance_private.guard_closed_financial_source() from public,anon,authenticated,service_role;
do $$declare t text;begin foreach t in array array['finance_movements','finance_bank_entries','finance_statement_imports','finance_statement_rows','finance_statement_verifications','finance_statement_identity_reviews','finance_statement_review_reversals','finance_reconciliation_groups','finance_reconciliation_reversals','finance_statement_coverage_approvals','finance_statement_coverage_reversals','finance_account_openings','finance_account_opening_reversals','finance_period_evidence_reviews','bank_accounts','bank_transactions','receivables_payments','receivable_payment_reversals','payables_payments','driver_settlement_payments','closing_report_payments','load_payments','employee_advances','payroll_entry_items','finance_internal_transfers','finance_transfer_departures'] loop
 execute format('create trigger finance_closed_period_source before insert or update or delete on public.%I for each row execute function finance_private.guard_closed_financial_source()',t);
end loop;end$$;
create function finance_private.account_period_guards_ready() returns boolean language sql stable set search_path='' as $$
select not exists(select 1 from unnest(array['finance_legacy_cut_reviews','finance_movements','finance_bank_entries','finance_statement_imports','finance_statement_rows','finance_statement_verifications','finance_statement_identity_reviews','finance_statement_review_reversals','finance_reconciliation_groups','finance_reconciliation_reversals','finance_statement_coverage_approvals','finance_statement_coverage_reversals','finance_account_openings','finance_account_opening_reversals','finance_period_evidence_reviews','bank_accounts','bank_transactions','receivables_payments','receivable_payment_reversals','payables_payments','driver_settlement_payments','closing_report_payments','load_payments','employee_advances','payroll_entry_items','finance_internal_transfers','finance_transfer_departures']) names(name) where not exists(select 1 from pg_catalog.pg_trigger tr join pg_catalog.pg_class tab on tab.oid=tr.tgrelid join pg_catalog.pg_namespace ns on ns.oid=tab.relnamespace where ns.nspname='public' and tab.relname=names.name and tr.tgname='finance_closed_period_source' and tr.tgenabled in('O','A') and tr.tgfoid='finance_private.guard_closed_financial_source()'::regprocedure))$$;
revoke all on function finance_private.account_period_guards_ready() from public,anon,authenticated,service_role;
-- Retention already protects originals and receipts even after reopening.
do $$declare body text;begin
 select pg_get_functiondef('finance_private.account_period_guards_ready()'::regprocedure) into body;
 execute replace(body,'select not exists(', 'select (select count(*)=2 from pg_catalog.pg_trigger tr join pg_catalog.pg_class tab on tab.oid=tr.tgrelid join pg_catalog.pg_namespace ns on ns.oid=tab.relnamespace where ns.nspname=''storage'' and tab.relname=''objects'' and tr.tgenabled in(''O'',''A'') and (tr.tgname=''preserve_finance_statement_file'' and tr.tgfoid=to_regprocedure(''finance_private.preserve_statement_file()'') or tr.tgname=''preserve_finance_receipt_object'' and tr.tgfoid=to_regprocedure(''finance_private.preserve_receipt_object()''))) and not exists(');
end$$;
