create or replace function public.get_client_portal_reports_summary_raw_20260917(
  _tenant_id uuid,
  _client_id uuid default null,
  _start_date date default null,
  _end_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_start date := coalesce(_start_date, (now() - interval '90 days')::date);
  v_end date := coalesce(_end_date, now()::date);
begin
  perform public._portal_assert_client_access(_tenant_id, _client_id);

  with allowed as (
    select unnest(public._portal_user_client_ids(_tenant_id)) as client_id
  ),
  document_deliveries as (
    select
      f.id as fiscal_document_id,
      f.load_id,
      f.status as document_status,
      f.recipient_city,
      f.recipient_state,
      f.updated_at,
      resolved.stop_id,
      resolved.stop_status,
      resolved.planned_arrival_at,
      resolved.actual_arrival_at,
      resolved.trip_started_at,
      coalesce(
        'stop:' || resolved.stop_id::text,
        'load:' || f.load_id::text,
        'document:' || f.id::text
      ) as delivery_key
    from public.fiscal_documents f
    left join lateral (
      select
        ds.id as stop_id,
        ds.status as stop_status,
        ds.planned_arrival_at,
        ds.actual_arrival_at,
        dt.actual_start_at as trip_started_at
      from public.current_dispatch_stop_documents dsd
      join public.dispatch_stops ds
        on ds.id = dsd.dispatch_stop_id
       and ds.tenant_id = _tenant_id
      left join public.dispatch_trips dt
        on dt.id = ds.dispatch_trip_id
       and dt.tenant_id = _tenant_id
      where dsd.tenant_id = _tenant_id
        and dsd.fiscal_document_id = f.id
      order by dsd.created_at desc, dsd.id desc
      limit 1
    ) resolved on true
    where f.tenant_id = _tenant_id
      and f.client_id in (select client_id from allowed)
      and (_client_id is null or f.client_id = _client_id)
      and coalesce(f.issue_date, f.created_at::date) between v_start and v_end
  ),
  deliveries as (
    select distinct on (delivery_key)
      delivery_key,
      coalesce(stop_status, document_status, 'sem_status') as status,
      coalesce(recipient_city, '—') as city,
      coalesce(recipient_state, '') as state,
      planned_arrival_at,
      actual_arrival_at,
      trip_started_at
    from document_deliveries
    order by delivery_key, updated_at desc, fiscal_document_id desc
  ),
  by_status as (
    select status, count(*)::int as total
    from deliveries
    group by status
  ),
  delayed as (
    select count(*)::int as total
    from deliveries
    where planned_arrival_at is not null
      and (
        (actual_arrival_at is null and planned_arrival_at < now())
        or actual_arrival_at > planned_arrival_at + interval '30 minutes'
      )
  ),
  pending_pods as (
    select count(*)::int as total
    from deliveries delivery
    where delivery.status in ('delivered', 'completed', 'delivered_total')
      and not exists (
        select 1
        from document_deliveries document
        join public.available_delivery_proofs pod
          on pod.fiscal_document_id = document.fiscal_document_id
        where document.delivery_key = delivery.delivery_key
      )
  ),
  occ_by_type as (
    select coalesce(event_type, 'outros') as event_type, count(*)::int as total
    from public.operational_events
    where tenant_id = _tenant_id
      and client_id in (select client_id from allowed)
      and (_client_id is null or client_id = _client_id)
      and (visible_to_client = true or client_opened = true)
      and created_at::date between v_start and v_end
    group by 1
    order by total desc
    limit 20
  ),
  pickups_by as (
    select coalesce(status, 'sem_status') as status, count(*)::int as total
    from public.pickup_orders
    where tenant_id = _tenant_id
      and remitter_client_id in (select client_id from allowed)
      and (_client_id is null or remitter_client_id = _client_id)
      and created_at::date between v_start and v_end
    group by 1
  ),
  top_cities as (
    select city, state, count(*)::int as total
    from deliveries
    group by city, state
    order by total desc
    limit 15
  ),
  avg_time as (
    select coalesce(
      round(avg(extract(epoch from (actual_arrival_at - coalesce(trip_started_at, planned_arrival_at))) / 86400.0)::numeric, 2),
      0
    ) as avg_days
    from deliveries
    where actual_arrival_at is not null
  )
  select jsonb_build_object(
    'period_start', v_start,
    'period_end', v_end,
    'deliveries_total', (select count(*)::int from deliveries),
    'deliveries_by_status', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'total', total)) from by_status), '[]'::jsonb),
    'deliveries_delayed', (select total from delayed),
    'pending_pods', (select total from pending_pods),
    'occurrences_by_type', coalesce((select jsonb_agg(jsonb_build_object('event_type', event_type, 'total', total)) from occ_by_type), '[]'::jsonb),
    'pickups_by_status', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'total', total)) from pickups_by), '[]'::jsonb),
    'top_cities', coalesce((select jsonb_agg(jsonb_build_object('city', city, 'state', state, 'total', total)) from top_cities), '[]'::jsonb),
    'avg_delivery_days', (select avg_days from avg_time)
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on function public.get_client_portal_reports_summary_raw_20260917(uuid, uuid, date, date)
from public, anon, authenticated, service_role;
