create function finance_private.list_fiscal_queue_v2(
  _tenant uuid,
  _status text,
  _cursor_observed_order bigint default null,
  _cursor_observation_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  rows jsonb;
  total bigint;
  counts jsonb;
  scheduler_active boolean:=false;
  has_more boolean;
  next_cursor jsonb;
begin
  if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
  if _status is null or _status not in('','pending','review','applied','superseded')
     or (_cursor_observed_order is null) <> (_cursor_observation_id is null) then
    raise exception 'finance_invalid_fiscal_queue_filter' using errcode='22023';
  end if;

  select count(*) into total from public.finance_fiscal_projection_jobs
  where tenant_id=_tenant and (_status='' or status=_status);
  select jsonb_build_object('pending',count(*) filter(where status='pending'),'review',count(*) filter(where status='review'),
    'applied',count(*) filter(where status='applied'),'superseded',count(*) filter(where status='superseded')) into counts
  from public.finance_fiscal_projection_jobs where tenant_id=_tenant;

  with candidates as materialized (
    select o.observed_order,j.observation_id,jsonb_build_object(
      'observation_id',j.observation_id,'tenant_id',j.tenant_id,'status',j.status,
      'document_type',o.snapshot->>'doc_type','document_number',o.snapshot->>'number','fiscal_status',o.snapshot->>'status',
      'attempts',j.attempts,'automatic_failures',j.automatic_failures,'issue',j.issue,'available_at',j.available_at,
      'created_at',j.created_at,'updated_at',j.updated_at,'receivable_id',j.result->>'receivable_id') row_data
    from public.finance_fiscal_projection_jobs j
    join public.finance_fiscal_observations o on o.id=j.observation_id and o.tenant_id=j.tenant_id
    where j.tenant_id=_tenant and (_status='' or j.status=_status)
      and (_cursor_observed_order is null or (o.observed_order,j.observation_id)<(_cursor_observed_order,_cursor_observation_id))
    order by o.observed_order desc,j.observation_id desc limit 31
  ), page as (
    select * from candidates order by observed_order desc,observation_id desc limit 30
  )
  select coalesce((select jsonb_agg(row_data order by observed_order desc,observation_id desc) from page),'[]'::jsonb),
    (select count(*)>30 from candidates),
    case when (select count(*)>30 from candidates) then
      (select jsonb_build_object('observed_order',observed_order::text,'observation_id',observation_id)
       from page order by observed_order,observation_id limit 1)
    else null end
  into rows,has_more,next_cursor;

  if to_regclass('cron.job') is not null then
    execute $query$select exists(select 1 from cron.job where jobname='finance-fiscal-projection-every-minute' and active
      and command='SET statement_timeout = ''25s''; SELECT finance_private.run_fiscal_queue(50);')$query$ into scheduler_active;
  end if;
  return jsonb_build_object('version',2,'tenant_id',_tenant,'page_size',30,'status_filter',_status,'total',total,
    'cursor',case when _cursor_observed_order is null then null else jsonb_build_object('observed_order',_cursor_observed_order::text,'observation_id',_cursor_observation_id) end,
    'next_cursor',next_cursor,'has_more',has_more,'counts',counts,'scheduler_active',scheduler_active,'rows',rows);
end;$$;

revoke all on function finance_private.list_fiscal_queue_v2(uuid,text,bigint,uuid) from public,anon,authenticated,service_role;
create function public.list_finance_fiscal_queue_v2(
  _tenant_id uuid,
  _status text default '',
  _cursor_observed_order bigint default null,
  _cursor_observation_id uuid default null
) returns jsonb
language sql stable security invoker set search_path='' as
$$select finance_private.list_fiscal_queue_v2(_tenant_id,_status,_cursor_observed_order,_cursor_observation_id);$$;
revoke all on function public.list_finance_fiscal_queue_v2(uuid,text,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_finance_fiscal_queue_v2(uuid,text,bigint,uuid),finance_private.list_fiscal_queue_v2(uuid,text,bigint,uuid) to authenticated;
