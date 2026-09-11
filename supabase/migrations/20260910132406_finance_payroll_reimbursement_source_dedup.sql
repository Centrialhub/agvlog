-- Preserve the generator's contract; identify reimbursement coverage by source IDs.
-- No historical payroll, payment, advance, or expense is changed by this migration.
create function finance_private.deduplicate_payroll_reimbursements(_tenant uuid,_period uuid) returns void
language plpgsql security definer set search_path='' as $$
declare entry record;credit record;s public.driver_settlements%rowtype;part record;covered jsonb;total numeric;cnt bigint;distinct_cnt bigint;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if not exists(select 1 from public.payroll_periods where id=_period and tenant_id=_tenant and status in('draft','calculated')) then
  raise exception 'finance_payroll_generation_locked' using errcode='55000';end if;
 for entry in select * from public.payroll_entries where tenant_id=_tenant and payroll_period_id=_period and status in('draft','calculated') order by id for update loop
  -- Older payroll credits lack frozen coverage. A mutable settlement cannot
  -- retroactively prove which expense IDs a historical payroll consumed.
  if exists(select 1 from public.payroll_entry_items current_item where current_item.tenant_id=_tenant and current_item.payroll_entry_id=entry.id
      and current_item.item_type in('driver_settlement','driver_expense_reimbursement') and current_item.nature='credit')
    and exists(select 1 from public.payroll_entry_items other
      join public.payroll_entries pe on pe.id=other.payroll_entry_id and pe.tenant_id=_tenant
      join public.payroll_periods pp on pp.id=other.payroll_period_id and pp.tenant_id=_tenant
      where other.tenant_id=_tenant and other.payroll_entry_id<>entry.id and pe.employee_id=entry.employee_id
       and ((pp.status<>'cancelled' and pe.status<>'cancelled') or exists(select 1 from public.payables paid_title join finance_private.active_payable_payments paid_record on paid_record.tenant_id=paid_title.tenant_id and paid_record.payable_id=paid_title.id where paid_title.tenant_id=_tenant and paid_title.source_table='payroll_entries' and paid_title.source_id=pe.id and paid_record.amount>0)) and other.item_type='driver_settlement' and other.nature='credit'
       and jsonb_typeof(other.source_metadata->'reimbursement_sources') is distinct from 'array') then
   raise exception 'finance_payroll_historical_source_review' using errcode='23514';end if;
  for credit in select * from public.payroll_entry_items where tenant_id=_tenant and payroll_entry_id=entry.id and item_type='driver_settlement' and nature='credit' order by id loop
   select * into s from public.driver_settlements where id=credit.source_id and tenant_id=_tenant for share;
   if not found or credit.source_table is distinct from 'driver_settlements' or s.driver_id is distinct from entry.driver_id
     or s.needs_recalculation or s.status not in('approved','paid','closed') or credit.amount<>coalesce(s.driver_payable_amount,s.final_amount,0) then
    raise exception 'finance_payroll_settlement_source_review' using errcode='23514';end if;
   -- Missing or ambiguous source metadata must not be inferred from equal amounts.
   if exists(select 1 from public.driver_settlement_items x where x.tenant_id=_tenant and x.settlement_id=s.id and x.item_type='expense'
     and (x.source_table is distinct from 'driver_expenses' or x.source_id is null or x.metadata->>'approval_status' is null
       or jsonb_typeof(x.metadata->'reimbursable') is distinct from 'boolean')) then
    raise exception 'finance_payroll_reimbursement_source_review' using errcode='23514';end if;
   select coalesce(sum(x.amount),0),count(*),count(distinct x.source_id),coalesce(jsonb_agg(jsonb_build_object('expense_id',x.source_id,'amount',x.amount) order by x.source_id),'[]')
    into total,cnt,distinct_cnt,covered from public.driver_settlement_items x
    where x.tenant_id=_tenant and x.settlement_id=s.id and x.item_type='expense' and x.source_table='driver_expenses'
      and x.metadata->>'approval_status'='approved' and x.metadata->>'reimbursable'='true';
   if cnt<>distinct_cnt or total is distinct from s.driver_reimbursement_total then
    raise exception 'finance_payroll_reimbursement_source_review' using errcode='23514';end if;
   -- An aggregate settlement credit cannot be safely reduced after another payroll
   -- has consumed its sources. Preserve both histories and require audited resolution.
   if exists(select 1 from public.payroll_entry_items other
      join public.payroll_entries pe on pe.id=other.payroll_entry_id and pe.tenant_id=_tenant
      join public.payroll_periods pp on pp.id=other.payroll_period_id and pp.tenant_id=_tenant
      where other.tenant_id=_tenant and other.id<>credit.id and ((pp.status<>'cancelled' and pe.status<>'cancelled') or exists(select 1 from public.payables paid_title join finance_private.active_payable_payments paid_record on paid_record.tenant_id=paid_title.tenant_id and paid_record.payable_id=paid_title.id where paid_title.tenant_id=_tenant and paid_title.source_table='payroll_entries' and paid_title.source_id=pe.id and paid_record.amount>0))
       and other.item_type='driver_settlement' and other.nature='credit' and other.source_table='driver_settlements' and other.source_id=s.id) then
    raise exception 'finance_payroll_reimbursement_already_claimed' using errcode='23514';end if;
   for part in select * from jsonb_to_recordset(covered) as c(expense_id uuid,amount numeric) loop
    if not exists(select 1 from public.driver_expenses e where e.id=part.expense_id and e.tenant_id=_tenant and e.driver_id=entry.driver_id)
      or part.amount<=0 or part.amount<>trunc(part.amount,2) then
     raise exception 'finance_payroll_reimbursement_source_review' using errcode='23514';end if;
    if exists(select 1 from public.payroll_entry_items other
      join public.payroll_entries pe on pe.id=other.payroll_entry_id and pe.tenant_id=_tenant
      join public.payroll_periods pp on pp.id=other.payroll_period_id and pp.tenant_id=_tenant
      where other.tenant_id=_tenant and other.id<>credit.id and ((pp.status<>'cancelled' and pe.status<>'cancelled') or exists(select 1 from public.payables paid_title join finance_private.active_payable_payments paid_record on paid_record.tenant_id=paid_title.tenant_id and paid_record.payable_id=paid_title.id where paid_title.tenant_id=_tenant and paid_title.source_table='payroll_entries' and paid_title.source_id=pe.id and paid_record.amount>0)) and other.nature='credit'
       and ((other.source_table='driver_expenses' and other.source_id=part.expense_id and other.payroll_entry_id<>entry.id)
         or (other.source_table='driver_settlements' and jsonb_typeof(other.source_metadata->'reimbursement_sources') is distinct from 'array' and exists(select 1 from public.driver_settlement_items x where x.tenant_id=_tenant and x.settlement_id=other.source_id
              and x.item_type='expense' and x.source_table='driver_expenses' and x.source_id=part.expense_id and x.metadata->>'approval_status'='approved' and x.metadata->>'reimbursable'='true'))
         or other.source_metadata->'reimbursement_sources' @> jsonb_build_array(jsonb_build_object('expense_id',part.expense_id)))) then
     raise exception 'finance_payroll_reimbursement_already_claimed' using errcode='23514';end if;
    if exists(select 1 from public.payroll_entry_items x where x.tenant_id=_tenant and x.payroll_entry_id=entry.id and x.item_type='driver_expense_reimbursement'
       and x.source_table='driver_expenses' and x.source_id=part.expense_id and (x.nature<>'credit' or x.amount<>part.amount or x.locked)) then
     raise exception 'finance_payroll_reimbursement_source_review' using errcode='23514';end if;
    delete from public.payroll_entry_items where tenant_id=_tenant and payroll_entry_id=entry.id and item_type='driver_expense_reimbursement'
      and nature='credit' and source_table='driver_expenses' and source_id=part.expense_id and amount=part.amount and not locked;
   end loop;
   update public.payroll_entry_items set source_metadata=coalesce(source_metadata,'{}'::jsonb)||jsonb_build_object('reimbursement_sources',covered,'reimbursement_dedup_version',1)
     where id=credit.id and tenant_id=_tenant;
  end loop;
  -- Standalone expenses cannot also be claimed by another active payroll.
  if exists(select 1 from public.payroll_entry_items current_item join public.payroll_entry_items other on other.tenant_id=_tenant and other.id<>current_item.id
    join public.payroll_entries pe on pe.id=other.payroll_entry_id and pe.tenant_id=_tenant
    join public.payroll_periods pp on pp.id=other.payroll_period_id and pp.tenant_id=_tenant
    where current_item.tenant_id=_tenant and current_item.payroll_entry_id=entry.id and current_item.item_type='driver_expense_reimbursement'
     and current_item.source_table='driver_expenses' and other.nature='credit' and ((pp.status<>'cancelled' and pe.status<>'cancelled') or exists(select 1 from public.payables paid_title join finance_private.active_payable_payments paid_record on paid_record.tenant_id=paid_title.tenant_id and paid_record.payable_id=paid_title.id where paid_title.tenant_id=_tenant and paid_title.source_table='payroll_entries' and paid_title.source_id=pe.id and paid_record.amount>0))
     and ((other.source_table='driver_expenses' and other.source_id=current_item.source_id)
      or other.source_metadata->'reimbursement_sources' @> jsonb_build_array(jsonb_build_object('expense_id',current_item.source_id))
      or (other.source_table='driver_settlements' and jsonb_typeof(other.source_metadata->'reimbursement_sources') is distinct from 'array' and exists(select 1 from public.driver_settlement_items x where x.tenant_id=_tenant and x.settlement_id=other.source_id
        and x.item_type='expense' and x.source_table='driver_expenses' and x.source_id=current_item.source_id and x.metadata->>'approval_status'='approved' and x.metadata->>'reimbursable'='true')))) then
   raise exception 'finance_payroll_reimbursement_already_claimed' using errcode='23514';end if;
  perform public.recompute_payroll_entry_totals(entry.id);
 end loop;
end$$;
revoke all on function finance_private.deduplicate_payroll_reimbursements(uuid,uuid) from public,anon,authenticated,service_role;

-- Replace exact anchors in the currently installed function (including its
-- financial access wrapper), retaining signature, defaults, identity and ACLs.
do $patch$
declare definition text;start_anchor text:=E'  SELECT id INTO _period_id\n  FROM public.payroll_periods';end_anchor text:='  RETURN _period_id;';preflight text;
begin
 select pg_get_functiondef('public.generate_payroll_period(uuid,date,date,text,boolean,boolean)'::regprocedure) into definition;
 if position(start_anchor in definition)=0 or position(end_anchor in definition)=0 or position('deduplicate_payroll_reimbursements' in definition)>0 then
  raise exception 'finance_payroll_generator_contract_changed';end if;
 preflight:=$preflight$
  perform finance_private.require_access(_tenant_id);
  perform pg_advisory_xact_lock(hashtextextended(_tenant_id::text||':finance',0));
  perform finance_private.require_access(_tenant_id);
  perform id from public.payroll_periods where tenant_id=_tenant_id order by id for update;
  if exists(select 1 from public.payroll_periods where tenant_id=_tenant_id and period_start=_period_start and period_end=_period_end and status not in('draft','calculated','cancelled')) then
    raise exception 'finance_payroll_generation_locked' using errcode='55000';
  end if;
  if exists(select 1 from public.payroll_periods pp join public.payroll_entries pe on pe.tenant_id=pp.tenant_id and pe.payroll_period_id=pp.id
    where pp.tenant_id=_tenant_id and pp.period_start=_period_start and pp.period_end=_period_end and pp.status in('draft','calculated')
      and pe.status in('approved','locked','closed')) then
    raise exception 'finance_payroll_generation_locked' using errcode='55000';
  end if;
  if exists(select 1 from public.payroll_periods pp
    join public.payroll_entries pe on pe.tenant_id=pp.tenant_id and pe.payroll_period_id=pp.id
    join public.payables p on p.tenant_id=pe.tenant_id and p.source_table='payroll_entries' and p.source_id=pe.id
    join finance_private.active_payable_payments payment on payment.tenant_id=p.tenant_id and payment.payable_id=p.id
    where pp.tenant_id=_tenant_id and pp.status='cancelled' and pp.period_start=_period_start and pp.period_end=_period_end and payment.amount>0) then
    raise exception 'finance_payroll_cancelled_payment_review' using errcode='23514';
  end if;
$preflight$;
 definition:=replace(definition,start_anchor,preflight||start_anchor);
 definition:=replace(definition,end_anchor,E'  perform finance_private.deduplicate_payroll_reimbursements(_tenant_id,_period_id);\n'||end_anchor);
 execute definition;
end;
$patch$;
