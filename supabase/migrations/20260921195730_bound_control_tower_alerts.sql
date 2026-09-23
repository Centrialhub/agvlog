create or replace function public.get_control_tower_snapshot_v1(_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_trips jsonb;
  v_alerts jsonb;
  v_trip_total integer;
  v_alert_total integer;
begin
  v_trips:=public.get_active_trips_live(_tenant_id);

  with prioritized as materialized (
    select alert.*,count(*) over()::integer alert_total
    from public.get_open_trip_alerts(_tenant_id) alert
    order by
      case alert.severity when 'critical' then 1 when 'danger' then 2 when 'warning' then 3
        when 'info' then 4 when 'success' then 5 else 6 end,
      alert.opened_at desc,alert.id
    limit 200
  )
  select coalesce(jsonb_agg(to_jsonb(alert)-'alert_total'||jsonb_build_object(
    'trip_code',coalesce(trip_label.code,trip.id::text),'trip_status',trip.status,'vehicle_plate',vehicle.plate,'driver_name',driver.name
  ) order by
    case alert.severity when 'critical' then 1 when 'danger' then 2 when 'warning' then 3
      when 'info' then 4 when 'success' then 5 else 6 end,
    alert.opened_at desc,alert.id),'[]'::jsonb),coalesce(max(alert.alert_total),0)
  into v_alerts,v_alert_total
  from prioritized alert
  left join public.dispatch_trips trip on trip.tenant_id=alert.tenant_id and trip.id=alert.trip_id
  left join lateral (
    select load.load_number code
    from public.loads load
    where load.tenant_id=trip.tenant_id and (
      load.id=trip.load_id or exists(
        select 1 from public.dispatch_trip_loads link
        where link.tenant_id=trip.tenant_id and link.dispatch_trip_id=trip.id and link.load_id=load.id
      )
    )
    order by load.load_number,load.id limit 1
  ) trip_label on true
  left join public.vehicles vehicle on vehicle.tenant_id=trip.tenant_id and vehicle.id=trip.vehicle_id
  left join public.drivers driver on driver.tenant_id=trip.tenant_id and driver.id=trip.driver_id;

  select count(*)::integer into v_trip_total
  from public.dispatch_trips trip
  where trip.tenant_id=_tenant_id
    and trip.status in ('planned','loading','dispatched','in_progress','in_transit');

  return jsonb_build_object(
    'version',1,'tenant_id',_tenant_id,'read_at',statement_timestamp(),
    'trip_limit',200,'trip_total',v_trip_total,'truncated',v_trip_total>jsonb_array_length(v_trips),
    'alert_limit',200,'alert_total',v_alert_total,'alerts_truncated',v_alert_total>jsonb_array_length(v_alerts),
    'trips',v_trips,'alerts',v_alerts
  );
end;
$function$;

comment on function public.get_control_tower_snapshot_v1(uuid) is
  'Returns bounded live trips and the 200 highest-priority open alerts with explicit totals and truncation flags.';
