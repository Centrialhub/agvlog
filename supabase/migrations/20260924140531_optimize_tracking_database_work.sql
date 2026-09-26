-- Service-only helpers. Deploy this migration before the three tracking Edges.
-- Preserve polling cadence and UTC daily boundaries; remove repeated REST work.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create function public.replace_ssx_tracking_reference_catalog_v2(
  _integration_account_id uuid, _resource_type text, _items jsonb
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare v_count integer;
begin
  -- Concurrent refreshes of the same resource must replace complete snapshots.
  perform pg_advisory_xact_lock(hashtextextended(
    'ssx:reference-catalog:' || _integration_account_id::text || ':' || _resource_type, 0));
  -- Keep validation, account scope, empty snapshots and received_at semantics.
  -- Both catalogs commit together; a failed compatibility write rolls back v1.
  v_count := public.replace_ssx_tracking_reference_catalog_v1(
    _integration_account_id, _resource_type, _items
  );
  if _resource_type = 'telemetry' then
    insert into public.telemetry_catalog as existing
      (provider, telemetry_id, name, description, raw, updated_at)
    select 'SSX', btrim(item->>'external_id'), nullif(btrim(item->>'name'), ''),
      nullif(btrim(item->>'name'), ''),
      jsonb_build_object('IdTelemetry', (item->>'external_id')::numeric,
        'Name', nullif(btrim(item->>'name'), '')), clock_timestamp()
    from jsonb_array_elements(_items) item
    order by btrim(item->>'external_id')
    on conflict (provider, telemetry_id) do update
    set name = excluded.name, description = excluded.description,
      raw = excluded.raw, updated_at = excluded.updated_at
    where (existing.name, existing.description, existing.raw)
      is distinct from (excluded.name, excluded.description, excluded.raw);
  end if;
  return v_count;
end;
$$;
revoke all on function public.replace_ssx_tracking_reference_catalog_v2(uuid,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.replace_ssx_tracking_reference_catalog_v2(uuid,text,jsonb)
  to service_role;

-- One coherent read immediately before each vehicle calculation. Keep the
-- time-dependent state machine in the Edge, including vehicles with no new fix.
create function public.get_vehicle_state_inputs_v1(_tenant_id uuid, _vehicle_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'vehicle_id', v.id,
    'position', (select jsonb_build_object('lat', p.lat, 'lng', p.lng,
      'speed', p.speed, 'heading', p.heading, 'captured_at', p.captured_at)
      from public.positions_last p
      where p.tenant_id = _tenant_id and p.vehicle_id = v.id),
    'previous_state', to_jsonb(s),
    'raw_positions', (select coalesce(jsonb_agg(to_jsonb(p)
      order by p.captured_at desc, p.id desc), '[]'::jsonb)
      from (select r.id, r.captured_at, r.lat, r.lng, r.speed, r.heading
        from public.positions_raw r
        where r.tenant_id = _tenant_id and r.vehicle_id = v.id
        order by r.captured_at desc, r.id desc limit 2) p)
  )
  from public.vehicles v
  left join public.vehicles_state s on s.vehicle_id = v.id and s.tenant_id = _tenant_id
  where v.tenant_id = _tenant_id and v.id = _vehicle_id;
$$;
revoke all on function public.get_vehicle_state_inputs_v1(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_vehicle_state_inputs_v1(uuid,uuid) to service_role;

create function public.aggregate_vehicle_metrics_daily_v1(_tenant_id uuid, _day date)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz;
  v_aggregated integer;
  v_changed integer;
begin
  if _tenant_id is null or _day is null or not isfinite(_day) then
    raise exception 'tracking_daily_scope_invalid' using errcode = '22023';
  end if;
  -- Serialize same-day writers before taking the source snapshot, so an older
  -- aggregation cannot overwrite a newer one after waiting on row conflicts.
  perform pg_advisory_xact_lock(hashtextextended(
    'tracking:daily:' || _tenant_id::text || ':' || _day::text, 0));
  v_start := _day::timestamp at time zone 'UTC';
  v_end := v_start + interval '1 day' - interval '1 millisecond';
  v_now := clock_timestamp();

  with fleet as materialized (
    select id from public.vehicles where tenant_id = _tenant_id and active
  ), offline_rules as materialized (
    select id from public.alert_rules
    where tenant_id = _tenant_id and rule_type = 'offline' and enabled
  ), calculated as materialized (
    select _tenant_id as tenant_id, v.id as vehicle_id, _day as day,
      floor(t.km * 100 + 0.5) / 100 as km_estimated,
      t.moving as moving_time_seconds, t.stopped as stopped_time_seconds,
      t.total as trips_count, s.total as stops_count,
      floor(a.minutes + 0.5)::integer as offline_minutes,
      e.overspeed as overspeed_events,
      floor(coalesce(p.max_speed, 0) + 0.5)::integer as max_speed_kmh,
      floor(coalesce(p.avg_speed, 0) + 0.5)::integer as avg_speed_kmh,
      floor(e.minutes + 0.5)::integer as overspeed_minutes,
      s.overnight as overnight_stops_count,
      e.deviations as route_deviation_events,
      first_fuel.fuel_value as fuel_start, last_fuel.fuel_value as fuel_end,
      floor((first_fuel.fuel_value - last_fuel.fuel_value) * 100 + 0.5) / 100 as fuel_consumed,
      f.refuels as fuel_refuel_events, f.drains as fuel_drain_events
    from fleet v
    cross join lateral (
      select coalesce(sum(distance_km_estimated), 0) as km,
        coalesce(sum(moving_time_seconds), 0)::integer as moving,
        coalesce(sum(stopped_time_seconds), 0)::integer as stopped, count(*)::integer as total
      from public.trips where tenant_id = _tenant_id and vehicle_id = v.id
        and start_at >= v_start and start_at <= v_end
    ) t
    cross join lateral (
      select count(*)::integer as total,
        count(*) filter (where stop_class = 'overnight')::integer as overnight
      from public.trip_stops where tenant_id = _tenant_id and vehicle_id = v.id
        and start_at >= v_start and start_at <= v_end
    ) s
    cross join lateral (
      select count(*) filter (where event_type = 'overspeed')::integer as overspeed,
        count(*) filter (where event_type = 'route_deviation')::integer as deviations,
        coalesce(sum(case when event_type = 'overspeed'
          and pg_input_is_valid(payload->>'start_at', 'timestamp with time zone')
          and pg_input_is_valid(payload->>'end_at', 'timestamp with time zone')
          then case when isfinite((payload->>'start_at')::timestamptz)
              and isfinite((payload->>'end_at')::timestamptz)
            then greatest(0, extract(epoch from ((payload->>'end_at')::timestamptz
              - (payload->>'start_at')::timestamptz)) / 60) else 0 end
          else 0 end), 0) as minutes
      from public.events where tenant_id = _tenant_id and vehicle_id = v.id
        and source = 'engine' and event_type in ('overspeed', 'route_deviation')
        and event_at >= v_start and event_at <= v_end
    ) e
    cross join lateral (
      select coalesce(sum(greatest(0, extract(epoch from (
        least(coalesce(closed_at, v_now), v_end) - greatest(opened_at, v_start))) / 60)), 0) as minutes
      from public.alert_instances where tenant_id = _tenant_id and vehicle_id = v.id
        and source = 'engine' and rule_id in (select id from offline_rules)
        and opened_at <= v_end and (closed_at is null or closed_at >= v_start)
    ) a
    cross join lateral (
      select max(speed) as max_speed, avg(speed) as avg_speed
      from public.positions_raw where tenant_id = _tenant_id and vehicle_id = v.id
        and captured_at >= v_start and captured_at <= v_end and speed is not null
    ) p
    left join lateral (
      select fuel_value from public.fuel_readings
      where tenant_id = _tenant_id and vehicle_id = v.id
        and captured_at >= v_start and captured_at <= v_end
      order by captured_at asc limit 1
    ) first_fuel on true
    left join lateral (
      select fuel_value from public.fuel_readings
      where tenant_id = _tenant_id and vehicle_id = v.id
        and captured_at >= v_start and captured_at <= v_end
      order by captured_at desc limit 1
    ) last_fuel on true
    cross join lateral (
      select count(*) filter (where event_type = 'refuel')::integer as refuels,
        count(*) filter (where event_type = 'drain')::integer as drains
      from public.fuel_events where tenant_id = _tenant_id and vehicle_id = v.id
        and event_type in ('refuel', 'drain') and event_at >= v_start and event_at <= v_end
    ) f
  ), written as (
    insert into public.metrics_daily as existing (
      tenant_id, vehicle_id, day, km_estimated, moving_time_seconds, stopped_time_seconds,
      trips_count, stops_count, offline_minutes, overspeed_events, max_speed_kmh,
      avg_speed_kmh, overspeed_minutes, overnight_stops_count, route_deviation_events,
      fuel_start, fuel_end, fuel_consumed, fuel_refuel_events, fuel_drain_events
    ) select * from calculated order by vehicle_id
    on conflict (tenant_id, vehicle_id, day) do update set
      km_estimated = excluded.km_estimated, moving_time_seconds = excluded.moving_time_seconds,
      stopped_time_seconds = excluded.stopped_time_seconds, trips_count = excluded.trips_count,
      stops_count = excluded.stops_count, offline_minutes = excluded.offline_minutes,
      overspeed_events = excluded.overspeed_events, max_speed_kmh = excluded.max_speed_kmh,
      avg_speed_kmh = excluded.avg_speed_kmh, overspeed_minutes = excluded.overspeed_minutes,
      overnight_stops_count = excluded.overnight_stops_count,
      route_deviation_events = excluded.route_deviation_events,
      fuel_start = excluded.fuel_start, fuel_end = excluded.fuel_end,
      fuel_consumed = excluded.fuel_consumed, fuel_refuel_events = excluded.fuel_refuel_events,
      fuel_drain_events = excluded.fuel_drain_events
    where (existing.km_estimated, existing.moving_time_seconds, existing.stopped_time_seconds,
      existing.trips_count, existing.stops_count, existing.offline_minutes,
      existing.overspeed_events, existing.max_speed_kmh, existing.avg_speed_kmh,
      existing.overspeed_minutes, existing.overnight_stops_count, existing.route_deviation_events,
      existing.fuel_start, existing.fuel_end, existing.fuel_consumed,
      existing.fuel_refuel_events, existing.fuel_drain_events)
    is distinct from (excluded.km_estimated, excluded.moving_time_seconds, excluded.stopped_time_seconds,
      excluded.trips_count, excluded.stops_count, excluded.offline_minutes,
      excluded.overspeed_events, excluded.max_speed_kmh, excluded.avg_speed_kmh,
      excluded.overspeed_minutes, excluded.overnight_stops_count, excluded.route_deviation_events,
      excluded.fuel_start, excluded.fuel_end, excluded.fuel_consumed,
      excluded.fuel_refuel_events, excluded.fuel_drain_events)
    returning 1
  ) select (select count(*) from calculated), (select count(*) from written)
    into v_aggregated, v_changed;
  return jsonb_build_object('aggregated', v_aggregated, 'changed', v_changed);
end;
$$;
revoke all on function public.aggregate_vehicle_metrics_daily_v1(uuid,date)
  from public, anon, authenticated, service_role;
grant execute on function public.aggregate_vehicle_metrics_daily_v1(uuid,date) to service_role;
