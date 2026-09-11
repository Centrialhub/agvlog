-- Late allocation to money already frozen is composition, not a new bank event.
-- INSERT proof is deferred until canonical links are present; no caller flag or
-- payload can waive the proof. New finance_movements remain immediately guarded.
create function finance_private.frozen_movement(_tenant uuid,_movement uuid) returns boolean language sql stable set search_path='' as $$
select exists(select 1 from public.finance_account_period_dependencies d join public.finance_account_period_closures c on c.tenant_id=d.tenant_id and c.id=d.closure_id join public.finance_movements m on m.tenant_id=d.tenant_id and m.id=d.source_id
 where d.tenant_id=_tenant and d.source_kind='finance_movements' and d.source_id=_movement and d.dependency_role='money'
 and m.bank_account_id=c.account_id and m.occurred_on between c.period_start and c.period_end
 and not exists(select 1 from public.finance_account_period_reopenings r where r.tenant_id=c.tenant_id and r.closure_id=c.id))$$;
create function finance_private.late_payment_composition_proved(_tenant uuid,_table text,_row jsonb,_depth integer default 0) returns boolean language plpgsql stable security definer set search_path='' as $$
declare source jsonb;link record;m public.finance_movements%rowtype;amount numeric;day date;account uuid;matches integer:=0;identifier uuid;used numeric;
begin
 if _depth>3 then return false;end if;
 identifier:=(_row->>'id')::uuid;amount:=(_row->>'amount')::numeric*100;
 if not coalesce(amount>0 and amount=trunc(amount) and amount<=99999999999999,false) then return false;end if;
 account:=(_row->>'bank_account_id')::uuid;
 day:=case when _table in('load_payments','closing_report_payments') then (_row->>'payment_date')::date else (coalesce(_row->>'received_at',_row->>'paid_at',_row->>'posted_at')::timestamptz at time zone 'America/Sao_Paulo')::date end;
 if day is null or not isfinite(day) then return false;end if;
 if _table in('load_payments','closing_report_payments') then
  select to_jsonb(p) into source from public.receivables_payments p where p.tenant_id=_tenant and p.id=(case when _table='load_payments' then _row->>'receivable_payment_id' else _row->>'canonical_receivable_payment_id' end)::uuid;
  return source is not null and source->>'receivable_id' is not distinct from _row->>'receivable_id' and (source->>'amount')::numeric*100=amount and source->>'bank_account_id' is not distinct from _row->>'bank_account_id'
   and ((source->>'received_at')::timestamptz at time zone 'America/Sao_Paulo')::date=day and finance_private.late_payment_composition_proved(_tenant,'receivables_payments',source,_depth+1);
 elsif _table='bank_transactions' then
  for link in select l.* from public.finance_receivable_movement_links l where l.tenant_id=_tenant and l.bank_transaction_id=identifier and l.action='receive' loop
   select to_jsonb(p) into source from public.receivables_payments p where p.tenant_id=_tenant and p.id=link.payment_id and p.financial_command_id=link.command_id and p.bank_transaction_id=identifier;
   if source is not null and _row->>'transaction_type'='credit' and (source->>'amount')::numeric*100=amount and source->>'bank_account_id'=_row->>'bank_account_id'
    and ((source->>'received_at')::timestamptz at time zone 'America/Sao_Paulo')::date=day and finance_private.late_payment_composition_proved(_tenant,'receivables_payments',source,_depth+1) then matches:=matches+1;end if;
  end loop;return matches=1;
 elsif _table='receivables_payments' then
  if exists(select 1 from public.finance_receipt_allocation_corrections c where c.tenant_id=_tenant and c.payment_id=identifier) then return false;end if;
  for link in select l.* from public.finance_receivable_movement_links l where l.tenant_id=_tenant and l.payment_id=identifier and l.action='receive' and l.command_id=(_row->>'financial_command_id')::uuid and l.bank_transaction_id=(_row->>'bank_transaction_id')::uuid loop
   select * into m from public.finance_movements where tenant_id=_tenant and id=link.movement_id;
   if found and m.direction='in' and m.bank_account_id=account and m.occurred_on=day and finance_private.frozen_movement(_tenant,m.id) then
    used:=finance_private.receipt_movement_used_cents(_tenant,m.id);
    if used>=amount and used<=m.amount_cents then matches:=matches+1;end if;
   end if;
  end loop;return matches=1;
 elsif _table='payables_payments' then
  if _row->>'bank_transaction_id' is not null then return false;end if;
  for link in select l.* from public.finance_payable_movement_links l where l.tenant_id=_tenant and l.payment_id=identifier and l.payable_id=(_row->>'payable_id')::uuid and l.origin='canonical' and l.amount_cents=amount and not exists(select 1 from public.finance_payable_link_reversals r where r.tenant_id=_tenant and r.link_id=l.id) loop
   select * into m from public.finance_movements where tenant_id=_tenant and id=link.movement_id;
   if found and m.direction='out' and m.bank_account_id=account and m.occurred_on=day and finance_private.frozen_movement(_tenant,m.id) then
    used:=finance_private.movement_used_cents(_tenant,m.id);if used>=amount and used<=m.amount_cents then matches:=matches+1;end if;
   end if;
  end loop;return matches=1;
 elsif _table='driver_settlement_payments' then
  for link in select l.* from public.finance_settlement_movement_links l where l.tenant_id=_tenant and l.payment_id=identifier and l.settlement_id=(_row->>'settlement_id')::uuid and l.amount_cents=amount and not exists(select 1 from public.finance_settlement_link_reversals r where r.tenant_id=_tenant and r.link_id=l.id) loop
   select * into m from public.finance_movements where tenant_id=_tenant and id=link.movement_id;
   if found and m.direction='out' and m.occurred_on=day and finance_private.frozen_movement(_tenant,m.id) then
    used:=finance_private.movement_used_cents(_tenant,m.id);if used>=amount and used<=m.amount_cents then matches:=matches+1;end if;
   end if;
  end loop;return matches=1;
 end if;
 return false;
end$$;
revoke all on function finance_private.frozen_movement(uuid,uuid),finance_private.late_payment_composition_proved(uuid,text,jsonb,integer) from public,anon,authenticated,service_role;
create function finance_private.guard_late_payment_composition() returns trigger language plpgsql security definer set search_path='' as $$
declare current_row jsonb;actor_name text;begin
 if not pg_try_advisory_xact_lock(hashtextextended(new.tenant_id::text||':finance',0)) then raise exception 'finance_period_source_busy' using errcode='40001';end if;
 execute format('select to_jsonb(p) from public.%I p where p.tenant_id=$1 and p.id=$2',tg_table_name) into current_row using new.tenant_id,new.id;
 if current_row is null then return new;end if;
 if finance_private.closed_interval_exists(new.tenant_id,null,null,null) and finance_private.late_payment_composition_proved(new.tenant_id,tg_table_name,current_row) then
  if not finance_private.can_access(new.tenant_id) then raise exception 'finance_access_denied' using errcode='42501';end if;
  select coalesce(nullif(raw_user_meta_data->>'full_name',''),email,auth.uid()::text) into actor_name from auth.users where id=auth.uid();
  insert into public.finance_events(tenant_id,entity_type,entity_id,action,actor_id,actor_name,reason,after_data) values(new.tenant_id,'late_period_composition',new.id,'closed_period_composition_recorded',auth.uid(),coalesce(actor_name,auth.uid()::text),'Detalhamento posterior vinculado a dinheiro já congelado',jsonb_build_object('source_table',tg_table_name,'source_id',new.id,'cash_changed',false,'source',current_row));
  return new;
 end if;
 perform finance_private.assert_closed_source_mutable(new.tenant_id,tg_table_name,current_row);return new;
end$$;
revoke all on function finance_private.guard_late_payment_composition() from public,anon,authenticated,service_role;
do $$declare t text;body text;needle text;begin
 foreach t in array array['payables_payments','receivables_payments','driver_settlement_payments','bank_transactions','load_payments','closing_report_payments'] loop
  execute format('create constraint trigger finance_late_payment_composition after insert on public.%I deferrable initially deferred for each row execute function finance_private.guard_late_payment_composition()',t);
 end loop;
 select pg_get_functiondef('finance_private.guard_closed_financial_source()'::regprocedure) into body;
 needle:='if not finance_private.closed_interval_exists(t,null,null,null) then continue;end if;';
 if position(needle in body)=0 then raise exception 'finance_closed_source_guard_contract_changed';end if;
 execute replace(body,needle,needle||' if tg_op=''INSERT'' and tg_table_name in(''payables_payments'',''receivables_payments'',''driver_settlement_payments'',''bank_transactions'',''load_payments'',''closing_report_payments'') then continue;end if;');
 select pg_get_functiondef('finance_private.assert_closed_source_mutable(uuid,text,jsonb,integer)'::regprocedure) into body;
 needle:='if _table=''finance_internal_transfers'' then';
 if position(needle in body)=0 then raise exception 'finance_closed_account_resolution_contract_changed';end if;
 execute replace(body,needle,'if account is not null and not exists(select 1 from public.bank_accounts a where a.tenant_id=_tenant and a.id=account) then account:=null;end if; '||needle);
 select pg_get_functiondef('finance_private.account_period_guards_ready()'::regprocedure) into body;
 needle:='select (select count(*)=2';
 if position(needle in body)=0 then raise exception 'finance_closed_guard_readiness_contract_changed';end if;
 execute replace(body,needle,'select (select count(*)=6 from pg_catalog.pg_trigger tr join pg_catalog.pg_class c on c.oid=tr.tgrelid join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname=''public'' and c.relname in(''payables_payments'',''receivables_payments'',''driver_settlement_payments'',''bank_transactions'',''load_payments'',''closing_report_payments'') and tr.tgname=''finance_late_payment_composition'' and tr.tgdeferrable and tr.tginitdeferred and tr.tgenabled in(''O'',''A'') and tr.tgfoid=''finance_private.guard_late_payment_composition()''::regprocedure) and (select count(*)=2');
end$$;
