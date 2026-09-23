create function finance_private.payroll_payment_projection_page(
  _tenant uuid,_period uuid,_page integer default 1,_search text default '',_payment text default 'all',_entry_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;period_state text;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 if _page is null or _page<1 or _page>1000000 or length(coalesce(_search,''))>200
    or _payment is null or _payment not in('all','unpaid','partial','paid','review','cancelled') then
  raise exception 'finance_invalid_payroll_entry_filter' using errcode='22023';
 end if;
 select status into period_state from public.payroll_periods where id=_period and tenant_id=_tenant;
 if not found then raise exception 'finance_payroll_period_not_found' using errcode='22023';end if;

 with entries as materialized (
  select e.*,jsonb_build_object('name',emp.name,'doc_cpf',emp.doc_cpf,'branch',emp.branch,'department',emp.department) employee,
    case when e.source_summary#>>'{payroll_carryover,amount_cents}' ~ '^\d{1,14}$'
      then (e.source_summary#>>'{payroll_carryover,amount_cents}')::numeric/100 else 0 end carryover_in
  from public.payroll_entries e left join public.employees emp on emp.id=e.employee_id and emp.tenant_id=e.tenant_id
  where e.tenant_id=_tenant and e.payroll_period_id=_period
 ),titles as materialized (
  select e.id,count(p.id) title_count,coalesce(sum(p.amount) filter(where p.status<>'cancelled'),0) title_amount,
    coalesce(bool_or(p.status='cancelled'),false) cancelled_title,coalesce(bool_or(p.category<>'payroll'),false) wrong_category
  from entries e left join public.payables p on p.tenant_id=_tenant and p.source_table='payroll_entries' and p.source_id=e.id group by e.id
 ),payments as materialized (
  select e.id,coalesce(sum(pp.amount),0) paid,coalesce(bool_or(pp.amount<=0 or pp.amount<>trunc(pp.amount,2)),false) invalid_amount
  from entries e left join public.payables p on p.tenant_id=_tenant and p.source_table='payroll_entries' and p.source_id=e.id
  left join finance_private.active_payable_payments pp on pp.payable_id=p.id and pp.tenant_id=_tenant group by e.id
 ),calculated as materialized (
  select e.*,t.title_count,py.paid,greatest(e.amount_to_pay-py.paid,0) remaining,array_remove(array[
    case when e.status in('approved','closed') and e.amount_to_pay>0 and t.title_count=0 then 'missing_title' end,
    case when t.title_count>1 then 'multiple_titles' end,case when t.title_count>0 and t.title_amount<>e.amount_to_pay then 'title_amount_mismatch' end,
    case when t.cancelled_title then 'cancelled_title' end,case when t.wrong_category then 'wrong_category' end,
    case when py.invalid_amount then 'invalid_payment_amount' end,case when py.paid>e.amount_to_pay then 'overpaid' end,
    case when (e.status='cancelled' or period_state='cancelled') and py.paid>0 then 'cancelled_entry_with_payment' end,
    case when e.status not in('approved','closed','cancelled') and t.title_count>0 then 'unexpected_title' end],null) issues
  from entries e join titles t using(id) join payments py using(id)
 ),presented as materialized (
  select c.*,case when cardinality(c.issues)>0 then 'review' when c.status='cancelled' then 'cancelled'
    when c.amount_to_pay=0 or c.paid=c.amount_to_pay then 'paid' when c.paid>0 or c.already_paid_amount>0 then 'partial' else 'unpaid' end payment_status
  from calculated c
 ),filtered as materialized (
  select * from presented c where (_entry_id is null or c.id=_entry_id)
    and (_entry_id is not null or coalesce(_search,'')='' or concat_ws(' ',c.employee->>'name',c.employee_id::text,c.employee->>'department',c.employee->>'branch') ilike '%'||_search||'%')
    and (_payment='all' or c.payment_status=_payment)
 ),page_rows as materialized (
  select * from filtered order by created_at,id limit 50 offset (_page-1)*50
 )
 select jsonb_build_object('version',2,'tenant_id',_tenant,'period_id',_period,'page',_page,'page_size',50,
  'search',coalesce(_search,''),'payment_filter',_payment,'total',(select count(*) from presented),
  'filtered_total',(select count(*) from filtered),'has_more',(_page*50<(select count(*) from filtered)),
  'totals',(select jsonb_build_object('gross',coalesce(sum(gross_amount),0)::text,'discount',coalesce(sum(discount_amount),0)::text,
    'already_paid',coalesce(sum(already_paid_amount),0)::text,'carryover_in',coalesce(sum(carryover_in),0)::text,
    'carryover_out',coalesce(sum(carryover_amount),0)::text,'title_paid',coalesce(sum(paid),0)::text,'remaining',coalesce(sum(remaining),0)::text) from presented),
  'rows',coalesce((select jsonb_agg((to_jsonb(c)-'employee'-'title_count'-'paid'-'remaining'-'issues'-'payment_status'-'carryover_in')||
    jsonb_build_object('employees',c.employee,'payment_summary',jsonb_build_object('obligation_amount',c.amount_to_pay::text,
      'paid_via_titles',c.paid::text,'remaining_amount',c.remaining::text,'overpaid_amount',greatest(c.paid-c.amount_to_pay,0)::text,
      'title_count',c.title_count,'issues',to_jsonb(c.issues),'status',c.payment_status,'bank_confirmation','not_evaluated'))
    order by c.created_at,c.id) from page_rows c),'[]'::jsonb)) into result;
 return result;
end;$$;
revoke all on function finance_private.payroll_payment_projection_page(uuid,uuid,integer,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.payroll_payment_projection_page(uuid,uuid,integer,text,text,uuid) to authenticated;

create function public.get_finance_payroll_entry_page(_tenant_id uuid,_period_id uuid,_page integer default 1,_search text default '',_payment text default 'all',_entry_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as
$$select finance_private.payroll_payment_projection_page(_tenant_id,_period_id,_page,_search,_payment,_entry_id);$$;
revoke all on function public.get_finance_payroll_entry_page(uuid,uuid,integer,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_payroll_entry_page(uuid,uuid,integer,text,text,uuid) to authenticated;
