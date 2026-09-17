create or replace function public.get_finance_payroll_period_page_v2(
  _tenant_id uuid,
  _page integer default 1,
  _page_size integer default 30,
  _filters jsonb default '{}'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  result jsonb;
  search_text text := btrim(coalesce(_filters->>'search',''));
  status_filter text := coalesce(nullif(_filters->>'status',''),'all');
  payment_filter text := coalesce(nullif(_filters->>'payment',''),'all');
  snapshot_at timestamptz := coalesce(nullif(_filters->>'snapshot_at','')::timestamptz,statement_timestamp());
  expected_revision text := nullif(_filters->>'collection_revision','');
  current_revision text;
begin
  if not finance_private.can_access(_tenant_id) then
    raise exception 'finance_access_denied' using errcode='42501';
  end if;
  if jsonb_typeof(_filters) is distinct from 'object'
     or _page not between 1 and 1000000
     or _page_size not between 1 and 100
     or length(search_text)>200
     or not isfinite(snapshot_at)
     or snapshot_at>statement_timestamp()+interval '5 minutes'
     or (expected_revision is not null and expected_revision !~ '^[0-9a-f]{64}$')
     or status_filter not in('all','draft','calculated','under_review','approved','closed','cancelled')
     or payment_filter not in('all','unpaid','partial','paid','review','cancelled') then
    raise exception 'finance_invalid_filters' using errcode='22023';
  end if;

  with candidates as materialized (
    select period.*
    from public.payroll_periods period
    where period.tenant_id=_tenant_id
      and period.created_at<=snapshot_at
      and (status_filter='all' or period.status=status_filter)
      and (
        search_text=''
        or period.period_name ilike '%'||replace(replace(search_text,'\','\\'),'%','\%')||'%' escape '\'
        or period.period_start::text ilike '%'||search_text||'%'
        or period.period_end::text ilike '%'||search_text||'%'
      )
  ),
  entries as materialized (
    select entry.*
    from public.payroll_entries entry
    join candidates period on period.id=entry.payroll_period_id
    where entry.tenant_id=_tenant_id
  ),
  titles as materialized (
    select entry.id,
      count(payable.id) title_count,
      coalesce(sum(payable.amount) filter(where payable.status<>'cancelled'),0) title_amount,
      coalesce(bool_or(payable.status='cancelled'),false) cancelled_title,
      coalesce(bool_or(payable.category<>'payroll'),false) wrong_category
    from entries entry
    left join public.payables payable
      on payable.tenant_id=_tenant_id
     and payable.source_table='payroll_entries'
     and payable.source_id=entry.id
    group by entry.id
  ),
  payments as materialized (
    select entry.id,
      coalesce(sum(payment.amount),0) paid,
      coalesce(bool_or(payment.amount<=0 or payment.amount<>trunc(payment.amount,2)),false) invalid_amount
    from entries entry
    left join public.payables payable
      on payable.tenant_id=_tenant_id
     and payable.source_table='payroll_entries'
     and payable.source_id=entry.id
    left join public.payables_payments payment
      on payment.payable_id=payable.id
     and payment.tenant_id=_tenant_id
    group by entry.id
  ),
  entry_metrics as materialized (
    select entry.id,entry.payroll_period_id,
      greatest(entry.amount_to_pay-payment.paid,0) remaining,
      payment.paid+entry.already_paid_amount paid,
      (
        (entry.status in('approved','closed') and entry.amount_to_pay>0 and title.title_count=0)
        or title.title_count>1
        or (title.title_count>0 and title.title_amount<>entry.amount_to_pay)
        or title.cancelled_title
        or title.wrong_category
        or payment.invalid_amount
        or payment.paid>entry.amount_to_pay
        or ((entry.status='cancelled' or period.status='cancelled') and payment.paid>0)
        or (entry.status not in('approved','closed','cancelled') and title.title_count>0)
      ) has_issue
    from entries entry
    join candidates period on period.id=entry.payroll_period_id
    join titles title on title.id=entry.id
    join payments payment on payment.id=entry.id
  ),
  period_metrics as materialized (
    select period.id,
      count(metric.id)::bigint entries,
      coalesce(sum(metric.remaining),0) remaining,
      coalesce(sum(metric.paid),0) paid,
      count(metric.id) filter(where metric.has_issue)::bigint issues
    from candidates period
    left join entry_metrics metric on metric.payroll_period_id=period.id
    group by period.id
  ),
  classified as materialized (
    select period.*,
      metric.entries,metric.remaining,metric.paid,metric.issues,
      case
        when metric.issues>0 then 'review'
        when period.status='cancelled' then 'cancelled'
        when metric.entries=0 then 'unpaid'
        when metric.remaining=0 then 'paid'
        when metric.paid>0 then 'partial'
        else 'unpaid'
      end computed_payment_status
    from candidates period
    join period_metrics metric using(id)
  ),
  revision as materialized (
    select encode(
      extensions.digest(
        convert_to(coalesce(string_agg(
          concat_ws('|',id::text,period_start::text,status,updated_at::text,computed_payment_status,
            entries::text,remaining::text,paid::text,issues::text),
          E'\n'
          order by id
        ),'empty'),'UTF8'),
        'sha256'
      ),
      'hex'
    ) value
    from classified
  ),
  matched as materialized (
    select * from classified
    where payment_filter='all' or computed_payment_status=payment_filter
  ),
  page_ids as materialized (
    select id,period_start
    from matched
    order by period_start desc,id
    limit _page_size offset (_page-1)*_page_size
  ),
  projected as materialized (
    select page_ids.id,page_ids.period_start,
      finance_private.payroll_period_projection(_tenant_id,page_ids.id)->'rows'->0 row
    from page_ids
  )
  select jsonb_build_object(
      'version',1,
      'tenant_id',_tenant_id,
      'page',_page,
      'page_size',_page_size,
      'total',(select count(*) from matched),
      'snapshot_at',snapshot_at,
      'collection_revision',(select value from revision),
      'rows',coalesce((
        select jsonb_agg(row order by period_start desc,id)
        from projected
      ),'[]'::jsonb)
    ),
    (select value from revision)
  into result,current_revision;

  if expected_revision is not null
     and expected_revision is distinct from current_revision then
    raise exception 'payroll_period_collection_changed' using errcode='40001';
  end if;

  return result;
end;
$function$;

revoke all on function public.get_finance_payroll_period_page_v2(uuid,integer,integer,jsonb)
from public,anon,authenticated,service_role;
grant execute on function public.get_finance_payroll_period_page_v2(uuid,integer,integer,jsonb)
to authenticated;
