create or replace function finance_private.recorded_costs(_tenant uuid,_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare page integer:=coalesce((_filters->>'page')::integer,1);from_date date:=nullif(_filters->>'from','')::date;to_date date:=nullif(_filters->>'to','')::date;
 search text:=lower(coalesce(_filters->>'search',''));center text:=coalesce(_filters->>'cost_center','');result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if jsonb_typeof(_filters) is distinct from 'object' or page not between 1 and 1000000 or from_date>to_date or length(search)>200
 or exists(select 1 from jsonb_object_keys(_filters) k where k not in('page','from','to','search','cost_center','category')) then raise exception 'finance_invalid_cost_filters' using errcode='22023';end if;
 with payroll as materialized (
  select pi.*,emp.name employee_name,coalesce(pi.competence_date,pp.period_start) cost_date,
   pi.item_type in('base_salary','daily','hourly','commission','bonus') and pi.nature='credit' and pi.amount>0 and pi.amount=trunc(pi.amount,2) remuneration
  from public.payroll_entry_items pi
  join public.payroll_entries pe on pe.tenant_id=pi.tenant_id and pe.id=pi.payroll_entry_id and pe.payroll_period_id=pi.payroll_period_id and pe.employee_id=pi.employee_id
  join public.payroll_periods pp on pp.tenant_id=pi.tenant_id and pp.id=pi.payroll_period_id
  join public.employees emp on emp.tenant_id=pi.tenant_id and emp.id=pi.employee_id
  where pi.tenant_id=_tenant and pe.status in('approved','closed') and pp.status in('approved','closed')
 ), sources as (
  select 'expense_batch'::text source,e.id,e.description,e.supplier_name,e.category,e.occurred_on,'expense_date'::text date_basis,
   e.amount_cents::numeric amount_cents,e.cost_center_id,c.name cost_center_name,e.payable_id,
   false cancelled,false needs_review
  from public.finance_expense_items e left join public.cost_centers c on c.tenant_id=e.tenant_id and c.id=e.cost_center_id where e.tenant_id=_tenant
  union all
  select 'manual_expense',p.id,cmd.payload->>'description',cmd.payload->>'supplier_name',cmd.payload->>'category',
   coalesce(nullif(cmd.payload->>'competence_date','')::date,(cmd.created_at at time zone 'America/Sao_Paulo')::date),
   case when nullif(cmd.payload->>'competence_date','') is null then 'recorded_date' else 'competence_date' end,
   (cmd.payload->>'amount_cents')::numeric,nullif(cmd.payload->>'cost_center_id','')::uuid,case when nullif(cmd.payload->>'cost_center_id','') is not null then coalesce(c.name,p.cost_center) end,p.id,
   p.status='cancelled',p.amount*100<>(cmd.payload->>'amount_cents')::numeric
  from public.finance_commands cmd join public.payables p on p.tenant_id=cmd.tenant_id and p.id=(cmd.result->>'payable_id')::uuid
  left join public.cost_centers c on c.tenant_id=cmd.tenant_id and c.id=nullif(cmd.payload->>'cost_center_id','')::uuid
  where cmd.tenant_id=_tenant and cmd.action='record_manual_expense'
   and not exists(select 1 from public.finance_expense_items e where e.tenant_id=_tenant and e.payable_id=p.id)
  union all
  select 'payroll_item',pi.id,pi.description,pi.employee_name,'payroll',pi.cost_date,
   case when pi.competence_date is null then 'payroll_period' else 'competence_date' end,
   (pi.amount*100)::bigint::numeric,null::uuid,null::text,null::uuid,false,false
  from payroll pi where pi.remuneration
 ), filtered as materialized (
  select * from sources s where (from_date is null or s.occurred_on>=from_date) and (to_date is null or s.occurred_on<=to_date)
   and (center='' or (center='unassigned' and s.cost_center_id is null) or s.cost_center_id=nullif(nullif(center,''),'unassigned')::uuid)
   and (nullif(_filters->>'category','') is null or s.category=_filters->>'category')
   and position(search in lower(concat_ws(' ',s.description,s.supplier_name,s.cost_center_name)))>0
 ), centers as (
  select cost_center_id,cost_center_name,coalesce(sum(amount_cents) filter(where not cancelled),0)::text amount_cents,count(*) item_count
  from filtered group by cost_center_id,cost_center_name
 ), categories as (
  select category,coalesce(sum(amount_cents) filter(where not cancelled),0)::text amount_cents,count(*) item_count from filtered group by category
 ), paged as (
  select source,id,description,supplier_name,category,occurred_on,date_basis,amount_cents::text amount_cents,cost_center_id,cost_center_name,payable_id,cancelled,needs_review
  from filtered order by occurred_on desc,source,id limit 30 offset ((page-1)*30)
 ) select jsonb_build_object('version',1,'tenant_id',_tenant,'page',page,'page_size',30,
  'total',(select count(*) from filtered),'total_cents',(select coalesce(sum(amount_cents) filter(where not cancelled),0)::text from filtered),
  'cancelled_count',(select count(*) from filtered where cancelled),'needs_review_count',(select count(*) from filtered where needs_review),
  'recorded_date_count',(select count(*) from filtered where date_basis='recorded_date'),
  'coverage','recorded_batches_manual_and_payroll_remuneration',
  'payroll_unclassified_count',(select count(*) from payroll p where p.nature='credit' and not p.remuneration and (from_date is null or p.cost_date>=from_date) and (to_date is null or p.cost_date<=to_date)),
  'payroll_unclassified_cents',(select coalesce(sum((p.amount*100)::bigint),0)::text from payroll p where p.nature='credit' and not p.remuneration and (from_date is null or p.cost_date>=from_date) and (to_date is null or p.cost_date<=to_date)),
  'cost_centers',coalesce((select jsonb_agg(to_jsonb(c) order by cost_center_name nulls last,cost_center_id) from centers c),'[]'),
  'categories',coalesce((select jsonb_agg(to_jsonb(c) order by category) from categories c),'[]'),
  'rows',coalesce((select jsonb_agg(to_jsonb(p) order by occurred_on desc,source,id) from paged p),'[]')) into result;
 return result;
end$$;
