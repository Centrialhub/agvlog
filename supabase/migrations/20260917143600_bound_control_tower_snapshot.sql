-- Restore the complete Control Tower read contract after the catalog repair
-- accidentally replaced it with an older, permissive live-position query.

create or replace function public.get_active_trips_live(_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  _result jsonb;
  _tracking boolean;
  _read_at timestamptz := statement_timestamp();
begin
  if auth.uid() is null
    or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false)
  then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select
    exists (
      select 1
      from public.tenant_feature_policy policy
      where policy.tenant_id = _tenant_id
        and policy.feature_key = 'ssx_enabled'
        and policy.enabled
    )
    and not exists (
      select 1
      from public.tenant_feature_policy policy
      where policy.tenant_id = _tenant_id
        and policy.feature_key = 'ssx_kill_switch'
        and policy.enabled
    )
  into _tracking;

  select coalesce(jsonb_agg(to_jsonb(trip) order by trip.trip_id), '[]'::jsonb)
  into _result
  from (
    select
      dispatch_trip.id as trip_id,
      dispatch_trip.tenant_id,
      dispatch_trip.status as trip_status,
      dispatch_trip.actual_start_at,
      coalesce(loads.items -> 0 ->> 'code', dispatch_trip.id::text) as trip_code,
      dispatch_trip.vehicle_id,
      vehicle.plate as vehicle_plate,
      vehicle.nickname as vehicle_name,
      dispatch_trip.driver_id,
      driver.name as driver_name,
      driver.phone as driver_phone,
      _tracking as tracking_enabled,
      case when position_state.fresh then position.lat end as lat,
      case when position_state.fresh then position.lng end as lng,
      case when position_state.fresh then position.speed end as speed_kmh,
      case when position_state.fresh then position.heading end as heading,
      case
        when dispatch_trip.status not in ('in_transit', 'in_progress') then 'planned'
        when not _tracking then 'tracking_disabled'
        when not coalesce(position_state.fresh, false) then 'no_signal'
        when live_status.trip_id is null then 'unknown'
        else live_status.state
      end as state,
      case
        when dispatch_trip.status not in ('in_transit', 'in_progress') or not _tracking then 'info'
        when not coalesce(position_state.fresh, false) then 'danger'
        when live_status.trip_id is null then 'info'
        else live_status.severity
      end as severity,
      case
        when dispatch_trip.status not in ('in_transit', 'in_progress') then 'Viagem ainda não iniciada'
        when not _tracking then 'SSX desativado; dados operacionais disponíveis'
        when not coalesce(position_state.fresh, false) then 'Sem posição recente válida'
        when live_status.trip_id is null then 'Aguardando avaliação da posição atual'
        else live_status.message
      end as status_message,
      route.geometry_geojson as route_geometry_geojson,
      live_status.distance_from_route_meters,
      live_status.delay_minutes,
      live_status.stopped_minutes,
      live_status.average_speed_kmh,
      live_status.eta_next_stop_at,
      position.captured_at as last_signal_at,
      case
        when position.captured_at <= _read_at
          then extract(epoch from _read_at - position.captured_at)::integer
      end as last_signal_age_seconds,
      position.captured_at as position_captured_at,
      pending_stops.items -> 0 as next_stop,
      previous_stops.items as previous_stops,
      pending_stops.items as pending_stops,
      loads.items as loads
    from public.dispatch_trips dispatch_trip
    left join public.vehicles vehicle
      on vehicle.id = dispatch_trip.vehicle_id
      and vehicle.tenant_id = dispatch_trip.tenant_id
    left join public.drivers driver
      on driver.id = dispatch_trip.driver_id
      and driver.tenant_id = dispatch_trip.tenant_id
    left join public.positions_last position
      on position.vehicle_id = dispatch_trip.vehicle_id
      and position.tenant_id = dispatch_trip.tenant_id
      and _tracking
    cross join lateral (
      select coalesce(
        _tracking
          and position.captured_at between _read_at - interval '15 minutes' and _read_at
          and position.lat between -90 and 90
          and position.lng between -180 and 180,
        false
      ) as fresh
    ) position_state
    left join public.trip_live_status live_status
      on live_status.trip_id = dispatch_trip.id
      and live_status.tenant_id = dispatch_trip.tenant_id
      and live_status.vehicle_id = dispatch_trip.vehicle_id
      and position_state.fresh
      and dispatch_trip.status in ('in_transit', 'in_progress')
      and live_status.last_signal_at = position.captured_at
      and live_status.updated_at >= position.captured_at
      and live_status.updated_at between _read_at - interval '15 minutes' and _read_at
      and live_status.metadata ->> 'context_revision'
        = control_tower_private.context_revision(dispatch_trip.tenant_id, dispatch_trip.id)
    left join public.trip_routes route
      on route.trip_id = dispatch_trip.id
      and route.tenant_id = dispatch_trip.tenant_id
      and route.provider = 'osrm'
      and route.plan_revision
        = control_tower_private.route_plan_revision(dispatch_trip.tenant_id, dispatch_trip.id)
    cross join lateral (
      select coalesce(jsonb_agg(to_jsonb(stop) order by stop.sequence, stop.id), '[]'::jsonb) as items
      from (
        select
          dispatch_stop.id,
          dispatch_stop.stop_order as sequence,
          dispatch_stop.destination as client_name,
          dispatch_stop.status,
          dispatch_stop.planned_arrival_at,
          dispatch_stop.actual_arrival_at,
          dispatch_stop.actual_departure_at,
          dispatch_stop.latitude,
          dispatch_stop.longitude
        from public.dispatch_stops dispatch_stop
        where dispatch_stop.dispatch_trip_id = dispatch_trip.id
          and dispatch_stop.tenant_id = dispatch_trip.tenant_id
          and not (dispatch_stop.status = any(public.stop_terminal_statuses()))
      ) stop
    ) pending_stops
    cross join lateral (
      select coalesce(jsonb_agg(to_jsonb(stop) order by stop.sequence, stop.id), '[]'::jsonb) as items
      from (
        select
          dispatch_stop.id,
          dispatch_stop.stop_order as sequence,
          dispatch_stop.destination as client_name,
          dispatch_stop.status,
          dispatch_stop.planned_arrival_at,
          dispatch_stop.actual_arrival_at,
          dispatch_stop.actual_departure_at,
          dispatch_stop.latitude,
          dispatch_stop.longitude
        from public.dispatch_stops dispatch_stop
        where dispatch_stop.dispatch_trip_id = dispatch_trip.id
          and dispatch_stop.tenant_id = dispatch_trip.tenant_id
          and dispatch_stop.status = any(public.stop_terminal_statuses())
      ) stop
    ) previous_stops
    cross join lateral (
      select coalesce(jsonb_agg(to_jsonb(load) order by load.code, load.id), '[]'::jsonb) as items
      from (
        select
          linked_load.id,
          linked_load.load_number as code,
          linked_load.total_weight_kg as total_weight,
          linked_load.status,
          (
            select count(distinct load_item.fiscal_document_id)
            from public.load_items load_item
            where load_item.load_id = linked_load.id
              and load_item.tenant_id = dispatch_trip.tenant_id
          ) as documents_count
        from public.loads linked_load
        where linked_load.tenant_id = dispatch_trip.tenant_id
          and exists (
            select 1
            from public.dispatch_trip_loads trip_load
            where trip_load.dispatch_trip_id = dispatch_trip.id
              and trip_load.tenant_id = dispatch_trip.tenant_id
              and trip_load.load_id = linked_load.id
          )
      ) load
    ) loads
    where dispatch_trip.tenant_id = _tenant_id
      and dispatch_trip.status in ('planned', 'loading', 'dispatched', 'in_progress', 'in_transit')
    order by dispatch_trip.id
    limit 200
  ) trip;

  return _result;
end;
$function$;

-- Automatic warnings are only open while the current, policy-compliant live
-- snapshot still confirms the same trip condition.
create or replace function public.get_open_trip_alerts(_tenant_id uuid)
returns setof public.trip_alerts
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  _trips jsonb;
begin
  _trips := public.get_active_trips_live(_tenant_id);

  return query
  select alert.*
  from public.trip_alerts alert
  where alert.tenant_id = _tenant_id
    and alert.status = 'open'
    and (
      alert.type not in ('off_route', 'no_signal', 'delayed', 'stopped')
      or (
        alert.metadata ->> 'context_revision'
          = control_tower_private.context_revision(alert.tenant_id, alert.trip_id)
        and exists (
          select 1
          from jsonb_array_elements(_trips) trip
          where trip ->> 'trip_id' = alert.trip_id::text
            and (trip ->> 'tracking_enabled')::boolean
            and trip ->> 'trip_status' in ('in_transit', 'in_progress')
            and trip ->> 'state' = alert.type
        )
      )
    )
  order by
    case alert.severity
      when 'critical' then 1
      when 'danger' then 2
      when 'warning' then 3
      when 'info' then 4
      when 'success' then 5
      else 6
    end,
    alert.opened_at desc,
    alert.id;
end;
$function$;

revoke all on function public.get_active_trips_live(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.get_open_trip_alerts(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_active_trips_live(uuid)
to authenticated, service_role;
grant execute on function public.get_open_trip_alerts(uuid)
to authenticated, service_role;

comment on function public.get_active_trips_live(uuid) is
  'Control Tower live view with tenant authorization, explicit tracking policy, fresh positions and canonical active-trip statuses.';
comment on function public.get_open_trip_alerts(uuid) is
  'Control Tower open alerts reconciled against the current authorized live-trip snapshot.';



-- Avoid rebuilding the complete trip JSON merely to reconcile automatic alerts.
create or replace function public.get_open_trip_alerts(_tenant_id uuid)
returns setof public.trip_alerts
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false)
  then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return query
  select alert.*
  from public.trip_alerts alert
  where alert.tenant_id = _tenant_id
    and alert.status = 'open'
    and (
      alert.type not in ('off_route', 'no_signal', 'delayed', 'stopped')
      or (
        alert.metadata ->> 'context_revision'
          = control_tower_private.context_revision(alert.tenant_id, alert.trip_id)
        and exists (
          select 1
          from public.dispatch_trips trip
          where trip.id = alert.trip_id
            and trip.tenant_id = alert.tenant_id
            and trip.status in ('in_transit', 'in_progress')
            and exists (
              select 1 from public.tenant_feature_policy policy
              where policy.tenant_id = trip.tenant_id
                and policy.feature_key = 'ssx_enabled' and policy.enabled
            )
            and not exists (
              select 1 from public.tenant_feature_policy policy
              where policy.tenant_id = trip.tenant_id
                and policy.feature_key = 'ssx_kill_switch' and policy.enabled
            )
            and (
              (
                alert.type = 'no_signal'
                and not exists (
                  select 1 from public.positions_last position
                  where position.tenant_id = trip.tenant_id
                    and position.vehicle_id = trip.vehicle_id
                    and position.captured_at between statement_timestamp() - interval '15 minutes' and statement_timestamp()
                    and position.lat between -90 and 90
                    and position.lng between -180 and 180
                )
              )
              or (
                alert.type <> 'no_signal'
                and exists (
                  select 1
                  from public.positions_last position
                  join public.trip_live_status live_status
                    on live_status.trip_id = trip.id
                    and live_status.tenant_id = trip.tenant_id
                    and live_status.vehicle_id = trip.vehicle_id
                    and live_status.last_signal_at = position.captured_at
                    and live_status.updated_at >= position.captured_at
                    and live_status.updated_at between statement_timestamp() - interval '15 minutes' and statement_timestamp()
                    and live_status.metadata ->> 'context_revision'
                      = control_tower_private.context_revision(trip.tenant_id, trip.id)
                    and live_status.state = alert.type
                  where position.tenant_id = trip.tenant_id
                    and position.vehicle_id = trip.vehicle_id
                    and position.captured_at between statement_timestamp() - interval '15 minutes' and statement_timestamp()
                    and position.lat between -90 and 90
                    and position.lng between -180 and 180
                )
              )
            )
        )
      )
    )
  order by
    case alert.severity
      when 'critical' then 1
      when 'danger' then 2
      when 'warning' then 3
      when 'info' then 4
      when 'success' then 5
      else 6
    end,
    alert.opened_at desc,
    alert.id;
end;
$function$;

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
  v_trips := public.get_active_trips_live(_tenant_id);

  select coalesce(jsonb_agg(to_jsonb(alert) order by
    case alert.severity
      when 'critical' then 1 when 'danger' then 2 when 'warning' then 3
      when 'info' then 4 when 'success' then 5 else 6 end,
    alert.opened_at desc, alert.id), '[]'::jsonb)
  into v_alerts
  from public.get_open_trip_alerts(_tenant_id) alert;

  select count(*)::integer into v_total
  from public.dispatch_trips trip
  where trip.tenant_id = _tenant_id
    and trip.status in ('planned', 'loading', 'dispatched', 'in_progress', 'in_transit');

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'read_at', statement_timestamp(),
    'trip_limit', 200,
    'trip_total', v_total,
    'truncated', v_total > jsonb_array_length(v_trips),
    'trips', v_trips,
    'alerts', v_alerts
  );
end;
$function$;

revoke all on function public.get_open_trip_alerts(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.get_control_tower_snapshot_v1(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_open_trip_alerts(uuid)
to authenticated, service_role;
grant execute on function public.get_control_tower_snapshot_v1(uuid)
to authenticated, service_role;

comment on function public.get_active_trips_live(uuid) is
  'Control Tower live view with revision guards and a hard 200-trip response bound.';
comment on function public.get_open_trip_alerts(uuid) is
  'Control Tower open alerts reconciled from lightweight current telemetry without rebuilding the trip catalog.';
comment on function public.get_control_tower_snapshot_v1(uuid) is
  'Returns the bounded live-trip catalog and reconciled alerts from one polling request.';
