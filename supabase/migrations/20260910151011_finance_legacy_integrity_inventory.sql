-- Tenant-wide read-only diagnostics; no inferred money or approval of adoption.
create function finance_private.legacy_integrity_reference(_tenant uuid,_table text,_id text)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
 if _id is null then return null;end if;
 if _table is null or _table not in ('receivables','receivables_payments','payables','payables_payments','driver_settlements','driver_settlement_payments','closing_reports','loads','employees','employee_advances','payroll_entries','payroll_periods','bank_transactions','bank_statement_imports','financial_obligations','receivable_financial_commands') then return null;end if;
 execute format('select to_jsonb(s) from public.%I s where tenant_id=$1 and id=$2',_table) into result using _tenant,_id::uuid;
 return result;
end$$;
revoke all on function finance_private.legacy_integrity_reference(uuid,text,text) from public,anon,authenticated,service_role;

create function finance_private.legacy_integrity_rows(_tenant uuid)
returns table(source_table text,source_id uuid,date_status text,occurred_on text,raw_date text,account_id uuid,account_status text,amount_cents text,raw_amount text,direction text,issues text[],context jsonb)
language plpgsql stable set search_path='' as $$
declare r record;s jsonb;parent jsonb;bank jsonb;alias_row jsonb;reference_row jsonb;ref record;
 d date; cents numeric;parent_table text;parent_key text;alias_key text;bank_id text;money boolean;
begin
 for r in
  select 'receivables_payments'::text kind,to_jsonb(x) payload,(x.received_at at time zone 'America/Sao_Paulo')::date as source_day,x.received_at::text date_text from public.receivables_payments x where tenant_id=_tenant
  union all select 'receivable_payment_reversals',to_jsonb(x),(x.effective_at at time zone 'America/Sao_Paulo')::date,x.effective_at::text from public.receivable_payment_reversals x where tenant_id=_tenant
  union all select 'payables_payments',to_jsonb(x),(x.paid_at at time zone 'America/Sao_Paulo')::date,x.paid_at::text from public.payables_payments x where tenant_id=_tenant
  union all select 'driver_settlement_payments',to_jsonb(x),(x.paid_at at time zone 'America/Sao_Paulo')::date,x.paid_at::text from public.driver_settlement_payments x where tenant_id=_tenant
  union all select 'closing_report_payments',to_jsonb(x),x.payment_date,x.payment_date::text from public.closing_report_payments x where tenant_id=_tenant
  union all select 'load_payments',to_jsonb(x),x.payment_date,x.payment_date::text from public.load_payments x where tenant_id=_tenant
  union all select 'employee_advances',to_jsonb(x),coalesce((x.paid_at at time zone 'America/Sao_Paulo')::date,x.advance_date),coalesce(x.paid_at::text,x.advance_date::text) from public.employee_advances x where tenant_id=_tenant and status='paid'
  union all select 'payroll_entry_items',to_jsonb(x),coalesce((x.occurred_at at time zone 'America/Sao_Paulo')::date,x.competence_date),coalesce(x.occurred_at::text,x.competence_date::text) from public.payroll_entry_items x where tenant_id=_tenant and nature='already_paid'
  union all select 'bank_transactions',to_jsonb(x),(x.posted_at at time zone 'America/Sao_Paulo')::date,x.posted_at::text from public.bank_transactions x where tenant_id=_tenant
 loop
  s:=r.payload;source_table:=r.kind;source_id:=(s->>'id')::uuid;d:=r.source_day;raw_date:=r.date_text;
  issues:='{}';context:='{}';account_id:=(s->>'bank_account_id')::uuid;raw_amount:=s->>'amount';amount_cents:=null;
  date_status:=case when d is null then 'missing' when not isfinite(d) then 'nonfinite' else 'valid' end;
  occurred_on:=case when date_status='valid' then to_char(d,'YYYY-MM-DD') end;
  if date_status<>'valid' then issues:=array_append(issues,'date_'||date_status);end if;
  direction:=case when source_table in ('receivables_payments','closing_report_payments','load_payments') then 'in' when source_table='bank_transactions' then case s->>'transaction_type' when 'credit' then 'in' when 'debit' then 'out' else 'unknown' end when source_table='payroll_entry_items' then 'unknown' else 'out' end;
  money:=source_table not in ('employee_advances','payroll_entry_items');
  cents:=case when raw_amount is not null then raw_amount::numeric*100 end;
  if cents>0 and cents=trunc(cents) and cents<=99999999999999 then
   if money then amount_cents:=trunc(cents)::text;end if;
  else issues:=array_append(issues,'amount_invalid');end if;
  if direction='unknown' and source_table='bank_transactions' then issues:=array_append(issues,'direction_unknown');end if;
  parent_table:=case source_table when 'receivables_payments' then 'receivables' when 'receivable_payment_reversals' then 'receivables_payments' when 'payables_payments' then 'payables' when 'driver_settlement_payments' then 'driver_settlements' when 'closing_report_payments' then 'closing_reports' when 'load_payments' then 'loads' when 'employee_advances' then 'employees' when 'payroll_entry_items' then 'payroll_entries' end;
  parent_key:=case source_table when 'receivables_payments' then 'receivable_id' when 'receivable_payment_reversals' then 'payment_id' when 'payables_payments' then 'payable_id' when 'driver_settlement_payments' then 'settlement_id' when 'closing_report_payments' then 'closing_report_id' when 'load_payments' then 'load_id' when 'employee_advances' then 'employee_id' when 'payroll_entry_items' then 'payroll_entry_id' end;
  parent:=null;
  if parent_table is not null then
   parent:=finance_private.legacy_integrity_reference(_tenant,parent_table,s->>parent_key);
   context:=context||jsonb_build_object('parent_table',parent_table,'parent_id',s->parent_key);
   if parent is null then issues:=array_append(issues,'parent_not_in_tenant');end if;
  end if;
  if source_table='receivable_payment_reversals' then account_id:=(parent->>'bank_account_id')::uuid;end if;
  -- Only an exact active canonical association can supply the account for a settlement.
  if source_table='driver_settlement_payments' then
   select m.bank_account_id into account_id from public.finance_settlement_movement_links l join public.finance_movements m on m.tenant_id=l.tenant_id and m.id=l.movement_id where l.tenant_id=_tenant and l.payment_id=source_id and not exists(select 1 from public.finance_settlement_link_reversals z where z.tenant_id=l.tenant_id and z.link_id=l.id) order by l.id limit 1;
  end if;
  account_status:=case when account_id is null then 'unresolved' when exists(select 1 from public.bank_accounts a where a.tenant_id=_tenant and a.id=account_id) then 'identified' else 'not_in_tenant' end;
  -- Projection rows are not independent cash and lack a direct account by design.
  if account_status<>'identified' and money then issues:=array_append(issues,'account_'||account_status);end if;
  if source_table in ('closing_report_payments','load_payments') then
   alias_key:=case source_table when 'load_payments' then 'receivable_payment_id' else 'canonical_receivable_payment_id' end;
   alias_row:=finance_private.legacy_integrity_reference(_tenant,'receivables_payments',s->>alias_key);
   context:=context||jsonb_build_object('receipt_id',s->alias_key);
   if alias_row is null then issues:=array_append(issues,'receipt_alias_missing');
   elsif (alias_row->>'amount')::numeric is distinct from (s->>'amount')::numeric or alias_row->>'bank_account_id' is distinct from s->>'bank_account_id' or ((alias_row->>'received_at')::timestamptz at time zone 'America/Sao_Paulo')::date is distinct from d or (s->>'receivable_id' is not null and s->>'receivable_id' is distinct from alias_row->>'receivable_id') or (s->>'bank_transaction_id' is not null and s->>'bank_transaction_id' is distinct from alias_row->>'bank_transaction_id') then issues:=array_append(issues,'receipt_alias_mismatch');end if;
  end if;
  if source_table='payroll_entry_items' then
   reference_row:=finance_private.legacy_integrity_reference(_tenant,s->>'source_table',s->>'source_id');
   if s->>'source_table' not in ('driver_settlement_payments','employee_advances','payables_payments') or reference_row is null then issues:=array_append(issues,'money_source_missing');end if;
   if finance_private.legacy_integrity_reference(_tenant,'employees',s->>'employee_id') is null or finance_private.legacy_integrity_reference(_tenant,'payroll_periods',s->>'payroll_period_id') is null then issues:=array_append(issues,'payroll_origin_not_in_tenant');end if;
  end if;
  if source_table='employee_advances' and s->>'payable_id' is not null and finance_private.legacy_integrity_reference(_tenant,'payables',s->>'payable_id') is null then issues:=array_append(issues,'payable_not_in_tenant');end if;
  if source_table in ('receivable_payment_reversals','closing_report_payments','load_payments') and s->>'receivable_id' is not null then
   if finance_private.legacy_integrity_reference(_tenant,'receivables',s->>'receivable_id') is null then issues:=array_append(issues,'receivable_not_in_tenant');end if;
  end if;
  if source_table='receivable_payment_reversals' and parent is not null and parent->>'receivable_id' is distinct from s->>'receivable_id' then issues:=array_append(issues,'parent_reference_mismatch');end if;
  if source_table='payroll_entry_items' and parent is not null and (parent->>'employee_id' is distinct from s->>'employee_id' or parent->>'payroll_period_id' is distinct from s->>'payroll_period_id') then issues:=array_append(issues,'parent_reference_mismatch');end if;
  context:=context||jsonb_build_object('origin_ids',jsonb_strip_nulls(jsonb_build_object('receivable_id',s->'receivable_id','payable_id',s->'payable_id','employee_id',s->'employee_id','payroll_period_id',s->'payroll_period_id','source_table',s->'source_table','source_id',s->'source_id','import_id',s->'import_id')));
  bank_id:=s->>'bank_transaction_id';
  if bank_id is not null then
   bank:=finance_private.legacy_integrity_reference(_tenant,'bank_transactions',bank_id);
   context:=context||jsonb_build_object('bank_transaction_id',bank_id);
   if bank is null then issues:=array_append(issues,'bank_source_not_in_tenant');
   elsif bank->>'bank_account_id' is distinct from account_id::text or (bank->>'amount')::numeric is distinct from (s->>'amount')::numeric or ((bank->>'posted_at')::timestamptz at time zone 'America/Sao_Paulo')::date is distinct from d or bank->>'transaction_type' is distinct from (case direction when 'in' then 'credit' else 'debit' end) then issues:=array_append(issues,'bank_source_mismatch');end if;
  end if;
  if source_table='bank_transactions' then
   if s->>'import_id' is not null and finance_private.legacy_integrity_reference(_tenant,'bank_statement_imports',s->>'import_id') is null then issues:=array_append(issues,'import_not_in_tenant');end if;
   for ref in
    select p.amount,p.bank_account_id,(p.received_at at time zone 'America/Sao_Paulo')::date as source_day,'credit'::text kind from public.receivables_payments p where p.tenant_id=_tenant and p.bank_transaction_id=source_id
    union all select p.amount,p.bank_account_id,(p.paid_at at time zone 'America/Sao_Paulo')::date,'debit' from public.payables_payments p where p.tenant_id=_tenant and p.bank_transaction_id=source_id
    union all select p.amount,p.bank_account_id,p.payment_date,'credit' from public.load_payments p where p.tenant_id=_tenant and p.bank_transaction_id=source_id
    union all select p.amount,(select x.bank_account_id from public.receivables_payments x where x.tenant_id=_tenant and x.id=p.payment_id),(p.effective_at at time zone 'America/Sao_Paulo')::date,'debit' from public.receivable_payment_reversals p where p.tenant_id=_tenant and p.bank_transaction_id=source_id
   loop
    if ref.amount is distinct from (s->>'amount')::numeric or ref.bank_account_id is distinct from account_id or ref.source_day is distinct from d or ref.kind is distinct from s->>'transaction_type' then issues:=array_append(issues,'referencing_source_mismatch');exit;end if;
   end loop;
  end if;
  context:=context||jsonb_build_object('amount_status',case when not money then 'projection_not_independent_money' when amount_cents is null then 'invalid_or_unknown' else 'exact_declared_cents' end);
  if cardinality(issues)>0 then return next;end if;
 end loop;
end$$;
revoke all on function finance_private.legacy_integrity_rows(uuid) from public,anon,authenticated,service_role;

create function finance_private.legacy_integrity_inventory(_tenant uuid,_page integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page not between 1 and 1000000 then raise exception 'finance_invalid_filters' using errcode='22023';end if;
 with rows as materialized(select * from finance_private.legacy_integrity_rows(_tenant)),
 identified as(select * from rows where account_status='identified'),unknowns as(select * from rows where account_status<>'identified'),
 ip as(select * from identified order by source_table,source_id limit 30 offset (_page-1)*30),
 up as(select * from unknowns order by source_table,source_id limit 30 offset (_page-1)*30)
 select jsonb_build_object('version',1,'tenant_id',_tenant,'scope','tenant','page',_page,'page_size',30,'total',(select count(*) from rows),
 'counts_by_source',coalesce((select jsonb_object_agg(source_table,n) from(select source_table,count(*) n from rows group by source_table)x),'{}'),
 'counts_by_issue',coalesce((select jsonb_object_agg(issue,n) from(select issue,count(*) n from rows cross join lateral unnest(issues) issue group by issue)x),'{}'),
 'identified_account',jsonb_build_object('total',(select count(*) from identified),'rows',coalesce((select jsonb_agg(to_jsonb(ip) order by source_table,source_id) from ip),'[]')),
 'unknown_account',jsonb_build_object('scope','tenant','not_additive_across_accounts',true,'total',(select count(*) from unknowns),'rows',coalesce((select jsonb_agg(to_jsonb(up) order by source_table,source_id) from up),'[]')),
 'legacy_integration_status','not_reviewed','can_close',false) into result;
 return result;
end$$;
revoke all on function finance_private.legacy_integrity_inventory(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function finance_private.legacy_integrity_inventory(uuid,integer) to authenticated;
create function public.get_finance_legacy_integrity_inventory(_tenant_id uuid,_page integer default 1)
returns jsonb language sql stable security invoker set search_path='' as $$select finance_private.legacy_integrity_inventory(_tenant_id,_page)$$;
revoke all on function public.get_finance_legacy_integrity_inventory(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_legacy_integrity_inventory(uuid,integer) to authenticated;
