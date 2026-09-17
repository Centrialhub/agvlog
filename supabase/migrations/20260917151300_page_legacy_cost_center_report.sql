create or replace function public.get_legacy_cost_center_report_v1(
  _tenant_id uuid,
  _from date default null,
  _cost_center text default null,
  _page integer default 1,
  _page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $function$
declare result jsonb;
begin
  perform finance_private.require_access(_tenant_id);
  if _page not between 1 and 1000000
     or _page_size not between 1 and 100
     or length(coalesce(_cost_center,''))>300
     or (_from is not null and _from>current_date) then
    raise exception 'invalid_legacy_cost_center_filters' using errcode='22023';
  end if;

  with source_rows as materialized (
    select payable.id,-payable.amount::numeric amount,payable.description,
      payable.cost_center,payable.created_at::timestamptz occurred_at,'Pagável'::text source_type
    from public.payables payable
    where payable.tenant_id=_tenant_id and payable.cost_center is not null
      and (_from is null or payable.created_at>=_from::timestamptz)
      and (_cost_center is null or payable.cost_center=_cost_center)
    union all
    select receivable.id,receivable.amount::numeric,receivable.description,
      receivable.cost_center,receivable.created_at::timestamptz,'Recebível'
    from public.receivables receivable
    where receivable.tenant_id=_tenant_id and receivable.cost_center is not null
      and (_from is null or receivable.created_at>=_from::timestamptz)
      and (_cost_center is null or receivable.cost_center=_cost_center)
    union all
    select bank_entry.id,bank_entry.amount::numeric,bank_entry.description,
      bank_entry.cost_center,bank_entry.posted_at::timestamptz,'Banco'
    from public.bank_transactions bank_entry
    where bank_entry.tenant_id=_tenant_id and bank_entry.cost_center is not null
      and (_from is null or bank_entry.posted_at>=_from::timestamptz)
      and (_cost_center is null or bank_entry.cost_center=_cost_center)
    union all
    select expense.id,-expense.amount::numeric,expense.category,
      expense.cost_center,expense.expense_at::timestamptz,'Despesa'
    from public.driver_expenses expense
    where expense.tenant_id=_tenant_id and expense.cost_center is not null
      and (_from is null or expense.expense_at>=_from::timestamptz)
      and (_cost_center is null or expense.cost_center=_cost_center)
    union all
    select maintenance.id,-coalesce(maintenance.total_cost,0)::numeric,maintenance.maintenance_type,
      maintenance.cost_center,maintenance.created_at::timestamptz,'Manutenção'
    from public.maintenance_orders maintenance
    where maintenance.tenant_id=_tenant_id and maintenance.cost_center is not null
      and (_from is null or maintenance.created_at>=_from::timestamptz)
      and (_cost_center is null or maintenance.cost_center=_cost_center)
  ),
  paged as materialized (
    select * from source_rows
    order by occurred_at desc,source_type,id
    limit _page_size offset (_page-1)*_page_size
  ),
  by_center as materialized (
    select cost_center name,sum(abs(amount)) value
    from source_rows where amount<0
    group by cost_center
  )
  select jsonb_build_object(
    'tenant_id',_tenant_id,'page',_page,'page_size',_page_size,
    'total',(select count(*) from source_rows),
    'total_outflow',coalesce((select sum(abs(amount)) from source_rows where amount<0),0),
    'total_inflow',coalesce((select sum(amount) from source_rows where amount>0),0),
    'chart_data',coalesce((select jsonb_agg(jsonb_build_object('name',name,'value',value) order by value desc,name) from by_center),'[]'::jsonb),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'amount',amount,'description',description,'cost_center',cost_center,
      'date',occurred_at,'type',source_type
    ) order by occurred_at desc,source_type,id) from paged),'[]'::jsonb)
  ) into result;
  return result;
end;
$function$;

revoke all on function public.get_legacy_cost_center_report_v1(uuid,date,text,integer,integer)
from public,anon,authenticated,service_role;
grant execute on function public.get_legacy_cost_center_report_v1(uuid,date,text,integer,integer)
to authenticated;
