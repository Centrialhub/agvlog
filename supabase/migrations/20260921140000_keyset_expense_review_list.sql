create or replace function public.list_driver_expenses_for_review_v2(
  _tenant_id uuid,
  _status text default 'pending',
  _cursor_expense_at timestamptz default null,
  _cursor_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare
  v_rows jsonb;
  v_count bigint;
  v_has_more boolean;
  v_next_cursor jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'expense_not_authorized' using errcode='42501';
  end if;
  if _status is null or _status not in('pending','reviewed')
     or (_cursor_expense_at is null) <> (_cursor_id is null) then
    raise exception 'expense_invalid_filter' using errcode='22023';
  end if;

  select count(*) into v_count
  from public.driver_expenses expense
  where expense.tenant_id=_tenant_id
    and (case when _status='pending' then expense.approval_status='pending' else expense.approval_status<>'pending' end);

  with candidates as materialized (
    select expense.id,expense.expense_at,
      to_jsonb(expense)||jsonb_build_object('driver_name',driver.name,'review_reason',review.reason) value
    from public.driver_expenses expense
    left join public.drivers driver on driver.tenant_id=expense.tenant_id and driver.id=expense.driver_id
    left join public.driver_expense_reviews review on review.tenant_id=expense.tenant_id and review.id=expense.review_command_id
    where expense.tenant_id=_tenant_id
      and (case when _status='pending' then expense.approval_status='pending' else expense.approval_status<>'pending' end)
      and (_cursor_expense_at is null or (expense.expense_at,expense.id)<(_cursor_expense_at,_cursor_id))
    order by expense.expense_at desc,expense.id desc
    limit 51
  ), page as (
    select * from candidates order by expense_at desc,id desc limit 50
  )
  select
    coalesce((select jsonb_agg(value order by expense_at desc,id desc) from page),'[]'::jsonb),
    (select count(*)>50 from candidates),
    case when (select count(*)>50 from candidates) then
      (select jsonb_build_object('expense_at',expense_at,'id',id) from page order by expense_at,id limit 1)
    else null end
  into v_rows,v_has_more,v_next_cursor;

  return jsonb_build_object(
    'version',2,'tenant_id',_tenant_id,'actor_id',auth.uid(),
    'can_review',public.is_tenant_admin(_tenant_id),'filter',_status,
    'cursor',case when _cursor_expense_at is null then null else jsonb_build_object('expense_at',_cursor_expense_at,'id',_cursor_id) end,
    'next_cursor',v_next_cursor,'has_more',v_has_more,'total',v_count,'rows',v_rows
  );
end;
$function$;

revoke all on function public.list_driver_expenses_for_review_v2(uuid,text,timestamptz,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.list_driver_expenses_for_review_v2(uuid,text,timestamptz,uuid)
to authenticated;
