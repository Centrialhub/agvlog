create or replace function public.get_operations_load_counts_v1(_tenant_id uuid)
returns table(active_count bigint,in_transit_count bigint,delayed_count bigint)
language sql
stable
security invoker
set search_path to ''
as $function$
  select
    count(*) filter(where l.status not in('delivered','cancelled')),
    count(*) filter(where l.status='in_transit'),
    count(*) filter(where l.status not in('delivered','cancelled') and (
      (l.status='in_transit' and coalesce(l.estimated_arrival_at,l.arrival_at) is not null
        and coalesce(l.estimated_arrival_at,l.arrival_at) < now())
      or
      (l.status<>'in_transit' and (
        (coalesce(l.scheduled_load_at,l.schedule_at) is not null
          and coalesce(l.scheduled_load_at,l.schedule_at) < now())
        or
        (l.scheduled_load_at is null and l.schedule_at is null and l.load_date is not null
          and l.load_date < timezone(coalesce(t.timezone,'America/Sao_Paulo'),now())::date)
      ))
    ))
  from public.loads l
  join public.tenants t on t.id=l.tenant_id
  where l.tenant_id=_tenant_id;
$function$;

revoke all on function public.get_operations_load_counts_v1(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_operations_load_counts_v1(uuid)
  to authenticated, service_role;

comment on function public.get_operations_load_counts_v1(uuid) is
  'Counts active, in-transit, and operationally delayed loads from scheduled/deadline timestamps rather than row updated_at.';
