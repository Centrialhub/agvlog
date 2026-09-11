-- Complete aggregate of the same canonical cost families as recorded_costs130032.
-- No payment/advance/bank row is added as a second expense.
create function finance_private.recorded_cost_summary(_tenant uuid,_from date,_to date,_category text,_center text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;center_id uuid;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if (_from is not null and not isfinite(_from)) or (_to is not null and not isfinite(_to)) or _from>_to or length(_category)>100 then raise exception 'finance_invalid_cost_filters' using errcode='22023';end if;
 if _center is not null and _center<>'unassigned' then
  if _center !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'finance_invalid_cost_filters' using errcode='22023';end if;
  center_id:=_center::uuid;
  if not exists(select 1 from public.cost_centers c where c.tenant_id=_tenant and c.id=center_id) then raise exception 'finance_invalid_cost_center' using errcode='22023';end if;
 end if;
with payroll as materialized (
  select pi.*,emp.name employee_name,coalesce(pi.competence_date,pp.period_start) cost_date,
   pe.id is not null and pp.id is not null and emp.id is not null and pi.item_type in('base_salary','daily','hourly','commission','bonus') and pi.nature='credit' and pi.amount>0 and pi.amount=trunc(pi.amount,2) and pi.amount*100<=99999999999999 remuneration
  from public.payroll_entry_items pi
  left join public.payroll_entries pe on pe.tenant_id=pi.tenant_id and pe.id=pi.payroll_entry_id and pe.payroll_period_id=pi.payroll_period_id and pe.employee_id=pi.employee_id
  left join public.payroll_periods pp on pp.tenant_id=pi.tenant_id and pp.id=pi.payroll_period_id
  left join public.employees emp on emp.tenant_id=pi.tenant_id and emp.id=pi.employee_id
  where pi.tenant_id=_tenant and ((pe.status in('approved','closed') and pp.status in('approved','closed')) or pe.id is null or pp.id is null or emp.id is null)
 ), sources as (
  select 'expense_batch'::text source,e.id,e.description,e.supplier_name,e.category,e.occurred_on,'expense_date'::text date_basis,
   e.amount_cents::numeric amount_cents,e.cost_center_id,c.name cost_center_name,e.payable_id,
   false cancelled,false needs_review
  from public.finance_expense_items e left join public.cost_centers c on c.tenant_id=e.tenant_id and c.id=e.cost_center_id where e.tenant_id=_tenant
  union all
  select 'manual_expense',cmd.request_id,cmd.payload->>'description',cmd.payload->>'supplier_name',cmd.payload->>'category',
   coalesce(nullif(cmd.payload->>'competence_date','')::date,(cmd.created_at at time zone 'America/Sao_Paulo')::date),
   case when nullif(cmd.payload->>'competence_date','') is null then 'recorded_date' else 'competence_date' end,
   (cmd.payload->>'amount_cents')::numeric,nullif(cmd.payload->>'cost_center_id','')::uuid,case when nullif(cmd.payload->>'cost_center_id','') is not null then coalesce(c.name,p.cost_center) end,p.id,
   coalesce(p.status='cancelled',false),p.id is null or p.amount*100 is distinct from(cmd.payload->>'amount_cents')::numeric
  from public.finance_commands cmd left join public.payables p on p.tenant_id=cmd.tenant_id and p.id=(cmd.result->>'payable_id')::uuid
  left join public.cost_centers c on c.tenant_id=cmd.tenant_id and c.id=nullif(cmd.payload->>'cost_center_id','')::uuid
  where cmd.tenant_id=_tenant and cmd.action='record_manual_expense'
   and not exists(select 1 from public.finance_expense_items e where e.tenant_id=_tenant and e.payable_id=p.id)
  union all
  select 'payroll_item',pi.id,pi.description,pi.employee_name,'payroll',pi.cost_date,
   case when pi.competence_date is null then 'payroll_period' else 'competence_date' end,
   pi.amount*100,null::uuid,null::text,null::uuid,false,not pi.remuneration
  from payroll pi where pi.nature='credit'
  )

 , filtered as materialized(
  select s.*,coalesce(not s.needs_review and s.occurred_on is not null and isfinite(s.occurred_on)
   and s.amount_cents>0 and s.amount_cents=trunc(s.amount_cents) and s.amount_cents<=99999999999999
   and s.category is not null and (s.cost_center_id is null or exists(select 1 from public.cost_centers c where c.tenant_id=_tenant and c.id=s.cost_center_id)),false) valid
  from sources s where (s.occurred_on is null or not isfinite(s.occurred_on) or ((_from is null or s.occurred_on>=_from) and (_to is null or s.occurred_on<=_to)))
   and (_category is null or s.category=_category)
   and (_center is null or (_center='unassigned' and s.cost_center_id is null) or s.cost_center_id=center_id)
 ), summary as(
  select count(*) total,count(*) filter(where cancelled) cancelled,count(*) filter(where not cancelled and not valid) invalid,
   count(*) filter(where source='payroll_item' and needs_review) unclassified,count(*) filter(where date_basis='recorded_date') recorded,
   coalesce(sum(amount_cents) filter(where not cancelled and valid),0) amount from filtered
 ), categories as(
  select category,count(*) item_count,coalesce(sum(amount_cents) filter(where not cancelled and valid),0) amount from filtered group by category
 ), centers as(
  select cost_center_id,cost_center_name,count(*) item_count,coalesce(sum(amount_cents) filter(where not cancelled and valid),0) amount from filtered group by cost_center_id,cost_center_name
 ), months as(
  select case when occurred_on is not null and isfinite(occurred_on) then to_char(occurred_on,'YYYY-MM') end as month_key,
   count(*) item_count,coalesce(sum(amount_cents) filter(where not cancelled and valid),0) amount from filtered group by 1
 )
 select jsonb_build_object('version',1,'tenant_id',_tenant,'from',_from,'to',_to,'category',_category,'cost_center',_center,
  'coverage','recorded_batches_manual_and_payroll_remuneration','coverage_complete',false,'excludes_bank_cash',true,
  'excluded_sources',jsonb_build_array('legacy_driver_expenses','maintenance_orders','settlement_composition','payroll_reimbursements_and_advances'),
  'total_count',s.total,'cancelled_count',s.cancelled,'invalid_count',s.invalid,'payroll_unclassified_count',s.unclassified,'recorded_date_count',s.recorded,
  'totals_valid',s.invalid=0,'total_cents',case when s.invalid=0 then trunc(s.amount)::text end,
  'categories',coalesce((select jsonb_agg(jsonb_build_object('category',g.category,'item_count',g.item_count,'amount_cents',case when s.invalid=0 then trunc(g.amount)::text end) order by g.category) from categories g),'[]'),
  'cost_centers',coalesce((select jsonb_agg(jsonb_build_object('cost_center_id',g.cost_center_id,'cost_center_name',g.cost_center_name,'item_count',g.item_count,'amount_cents',case when s.invalid=0 then trunc(g.amount)::text end) order by g.cost_center_name nulls last,g.cost_center_id) from centers g),'[]'),
  'months',coalesce((select jsonb_agg(jsonb_build_object('month',g.month_key,'item_count',g.item_count,'amount_cents',case when s.invalid=0 then trunc(g.amount)::text end) order by g.month_key nulls last) from months g),'[]')) into result from summary s;
 return result;
end$$;
revoke all on function finance_private.recorded_cost_summary(uuid,date,date,text,text) from public,anon,authenticated,service_role;
grant execute on function finance_private.recorded_cost_summary(uuid,date,date,text,text) to authenticated;
create function public.get_finance_recorded_cost_summary(_tenant_id uuid,_from date default null,_to date default null,_category text default null,_cost_center text default null)
returns jsonb language sql stable security invoker set search_path='' as $$ select finance_private.recorded_cost_summary(_tenant_id,_from,_to,_category,_cost_center) $$;
revoke all on function public.get_finance_recorded_cost_summary(uuid,date,date,text,text) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_recorded_cost_summary(uuid,date,date,text,text) to authenticated;
