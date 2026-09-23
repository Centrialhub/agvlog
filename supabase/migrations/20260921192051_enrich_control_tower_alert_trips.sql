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
  v_total integer;
begin
  v_trips:=public.get_active_trips_live(_tenant_id);

  select coalesce(jsonb_agg(to_jsonb(alert)||jsonb_build_object(
    'trip_code',trip.code,
    'trip_status',trip.status,
    'vehicle_plate',vehicle.plate,
    'driver_name',driver.name
  ) order by
    case alert.severity when 'critical' then 1 when 'danger' then 2 when 'warning' then 3
      when 'info' then 4 when 'success' then 5 else 6 end,
    alert.opened_at desc,alert.id),'[]'::jsonb)
  into v_alerts
  from public.get_open_trip_alerts(_tenant_id) alert
  left join public.dispatch_trips trip on trip.tenant_id=alert.tenant_id and trip.id=alert.trip_id
  left join public.vehicles vehicle on vehicle.tenant_id=trip.tenant_id and vehicle.id=trip.vehicle_id
  left join public.drivers driver on driver.tenant_id=trip.tenant_id and driver.id=trip.driver_id;

  select count(*)::integer into v_total
  from public.dispatch_trips trip
  where trip.tenant_id=_tenant_id
    and trip.status in ('planned','loading','dispatched','in_progress','in_transit');

  return jsonb_build_object(
    'version',1,'tenant_id',_tenant_id,'read_at',statement_timestamp(),
    'trip_limit',200,'trip_total',v_total,'truncated',v_total>jsonb_array_length(v_trips),
    'trips',v_trips,'alerts',v_alerts
  );
end;
$function$;

comment on function public.get_control_tower_snapshot_v1(uuid) is
  'Returns the bounded live-trip snapshot and self-identifying open alerts, including trips outside the bounded live array.';
