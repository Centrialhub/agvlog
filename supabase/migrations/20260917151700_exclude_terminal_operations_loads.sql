create or replace function public.get_operations_load_counts_v1(_tenant_id uuid)
returns table(active_count bigint,in_transit_count bigint,delayed_count bigint)
language sql
stable
security invoker
set search_path to ''
as $function$
  with scoped as (
    select l.*,t.timezone
    from public.loads l
    join public.tenants t on t.id=l.tenant_id
    where l.tenant_id=_tenant_id
      and l.status not in(
        'delivered','partial_delivery','returned','refused','failed','cancelled','divergent'
      )
  )
  select
    count(*),
    count(*) filter(where scoped.status='in_transit'),
    count(*) filter(where
      (scoped.status='in_transit'
        and coalesce(scoped.estimated_arrival_at,scoped.arrival_at) is not null
        and coalesce(scoped.estimated_arrival_at,scoped.arrival_at)<now())
      or
      (scoped.status<>'in_transit' and (
        (coalesce(scoped.scheduled_load_at,scoped.schedule_at) is not null
          and coalesce(scoped.scheduled_load_at,scoped.schedule_at)<now())
        or
        (scoped.scheduled_load_at is null and scoped.schedule_at is null and scoped.load_date is not null
          and scoped.load_date<timezone(coalesce(scoped.timezone,'America/Sao_Paulo'),now())::date)
      ))
    )
  from scoped;
$function$;

revoke all on function public.get_operations_load_counts_v1(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_operations_load_counts_v1(uuid)
  to authenticated,service_role;

comment on function public.get_operations_load_counts_v1(uuid) is
  'Counts only non-terminal, non-divergent loads; delayed_count uses the same active universe and operational deadlines.';
