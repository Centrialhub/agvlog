-- Read the obligation and its payments in one snapshot. Never create a second
-- expense or movement, and never fold title payments into already_paid items.
create function finance_private.payroll_payment_projection(_tenant uuid, _period uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; period_state text;
begin
 if not finance_private.can_access(_tenant) then
  raise exception 'finance_access_denied' using errcode='42501';
 end if;
 select status into period_state from public.payroll_periods where id=_period and tenant_id=_tenant;
 if not found then
  raise exception 'finance_payroll_period_not_found' using errcode='22023';
 end if;
 with entries as (
  select e.*, jsonb_build_object('name',emp.name,'doc_cpf',emp.doc_cpf,
    'branch',emp.branch,'department',emp.department) employee
  from public.payroll_entries e left join public.employees emp
    on emp.id=e.employee_id and emp.tenant_id=e.tenant_id
  where e.tenant_id=_tenant and e.payroll_period_id=_period
 ), titles as (
  select e.id, count(p.id) title_count,
    coalesce(sum(p.amount) filter(where p.status<>'cancelled'),0) title_amount,
    coalesce(bool_or(p.status='cancelled'),false) cancelled_title,
    coalesce(bool_or(p.category<>'payroll'),false) wrong_category
  from entries e left join public.payables p on p.tenant_id=_tenant
    and p.source_table='payroll_entries' and p.source_id=e.id group by e.id
 ), payments as (
  select e.id,coalesce(sum(pp.amount),0) paid,
    coalesce(bool_or(pp.amount<=0 or pp.amount<>trunc(pp.amount,2)),false) invalid_amount
  from entries e left join public.payables p on p.tenant_id=_tenant
    and p.source_table='payroll_entries' and p.source_id=e.id
  left join public.payables_payments pp on pp.payable_id=p.id and pp.tenant_id=_tenant
  group by e.id
 ), calculated as (
  select e.*, t.title_count, py.paid, greatest(e.amount_to_pay-py.paid,0) remaining,
    array_remove(array[
      case when e.status in ('approved','closed') and e.amount_to_pay>0 and t.title_count=0 then 'missing_title' end,
      case when t.title_count>1 then 'multiple_titles' end,
      case when t.title_count>0 and t.title_amount<>e.amount_to_pay then 'title_amount_mismatch' end,
      case when t.cancelled_title then 'cancelled_title' end,
      case when t.wrong_category then 'wrong_category' end,
      case when py.invalid_amount then 'invalid_payment_amount' end,
      case when py.paid>e.amount_to_pay then 'overpaid' end,
      case when (e.status='cancelled' or period_state='cancelled') and py.paid>0 then 'cancelled_entry_with_payment' end,
      case when e.status not in ('approved','closed','cancelled') and t.title_count>0 then 'unexpected_title' end
    ],null) issues
  from entries e join titles t using(id) join payments py using(id)
 )
 select jsonb_build_object('version',1,'tenant_id',_tenant,'period_id',_period,
  'rows',coalesce(jsonb_agg(
    (to_jsonb(c)-'employee'-'title_count'-'paid'-'remaining'-'issues') ||
    jsonb_build_object('employees',c.employee,'payment_summary',jsonb_build_object(
      'obligation_amount',c.amount_to_pay::text,'paid_via_titles',c.paid::text,
      'remaining_amount',c.remaining::text,'overpaid_amount',greatest(c.paid-c.amount_to_pay,0)::text,
      'title_count',c.title_count,'issues',to_jsonb(c.issues),
      'status',case when cardinality(c.issues)>0 then 'review'
        when c.status='cancelled' then 'cancelled'
        when c.amount_to_pay=0 or c.paid=c.amount_to_pay then 'paid'
        when c.paid>0 or c.already_paid_amount>0 then 'partial' else 'unpaid' end,
      'bank_confirmation','not_evaluated')) order by c.created_at,c.id),'[]'::jsonb))
 into result from calculated c;
 return result;
end;
$$;
revoke all on function finance_private.payroll_payment_projection(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.payroll_payment_projection(uuid,uuid) to authenticated;
create function public.get_finance_payroll_entries(_tenant_id uuid,_period_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select finance_private.payroll_payment_projection(_tenant_id,_period_id);
$$;
revoke all on function public.get_finance_payroll_entries(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_payroll_entries(uuid,uuid) to authenticated;

create function finance_private.payroll_period_projection(_tenant uuid,_period uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
 select jsonb_build_object('version',1,'tenant_id',_tenant,'rows',coalesce(jsonb_agg(
  to_jsonb(p)||jsonb_build_object('payment_status',case
    when totals.issues>0 then 'review'
    when p.status='cancelled' then 'cancelled'
    when totals.entries=0 then 'unpaid'
    when totals.remaining=0 then 'paid'
    when totals.paid>0 then 'partial' else 'unpaid' end,
    'payment_issues_count',totals.issues,'remaining_amount',totals.remaining::text,
    'bank_confirmation','not_evaluated') order by p.period_start desc,p.id),'[]'::jsonb)) into result
 from public.payroll_periods p
 cross join lateral (
  select count(*) entries,
   coalesce(sum((r->'payment_summary'->>'remaining_amount')::numeric),0) remaining,
   coalesce(sum((r->'payment_summary'->>'paid_via_titles')::numeric+(r->>'already_paid_amount')::numeric),0) paid,
   count(*) filter(where jsonb_array_length(r->'payment_summary'->'issues')>0) issues
  from jsonb_array_elements(finance_private.payroll_payment_projection(_tenant,p.id)->'rows') r
 ) totals
 where p.tenant_id=_tenant and (_period is null or p.id=_period);
 return result;
end;
$$;
revoke all on function finance_private.payroll_period_projection(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.payroll_period_projection(uuid,uuid) to authenticated;
create function public.get_finance_payroll_periods(_tenant_id uuid,_period_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select finance_private.payroll_period_projection(_tenant_id,_period_id);
$$;
revoke all on function public.get_finance_payroll_periods(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_finance_payroll_periods(uuid,uuid) to authenticated;

-- Keep existing role/MFA wrappers and ACLs. Change only the stale balance
-- calculation in the legacy close command; fail migration on unexpected body.
do $patch_close$
declare old_body text; new_body text;
 old_query text := E'SELECT COALESCE(SUM(amount_to_pay),0) INTO _open_balance\n    FROM public.payroll_entries WHERE payroll_period_id = _period_id AND payment_status <> ''paid'';';
begin
 select pg_get_functiondef('public.close_payroll_period(uuid,text)'::regprocedure) into old_body;
 if position(old_query in old_body)=0 then raise exception 'finance_payroll_close_contract_changed';end if;
 new_body:=replace(old_body,old_query,$replacement$
 DECLARE projection jsonb;
 BEGIN
  PERFORM 1 FROM public.payroll_periods WHERE id=_period_id AND tenant_id=_tenant AND status='approved' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'finance_payroll_close_requires_approved' USING ERRCODE='22023';END IF;
  projection:=finance_private.payroll_payment_projection(_tenant,_period_id);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(projection->'rows') r
    WHERE jsonb_array_length(r->'payment_summary'->'issues')>0) THEN
   RAISE EXCEPTION 'finance_payroll_payment_review_required' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(sum((r->'payment_summary'->>'remaining_amount')::numeric),0)
    INTO _open_balance FROM jsonb_array_elements(projection->'rows') r;
 END;
 $replacement$);
 execute new_body;
end;
$patch_close$;
