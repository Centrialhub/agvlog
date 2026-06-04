CREATE OR REPLACE FUNCTION public.get_active_trips_live(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result jsonb;
BEGIN
  IF NOT public.is_tenant_member(_tenant_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_jsonb(t)), '[]'::jsonb)
  INTO _result
  FROM (
    SELECT
      dt.id AS trip_id,
      COALESCE(l.load_number, dt.id::text) AS trip_code,
      dt.vehicle_id,
      v.plate AS vehicle_plate,
      v.nickname AS vehicle_name,
      dt.driver_id,
      d.name AS driver_name,
      d.phone AS driver_phone,
      pl.lat,
      pl.lng,
      COALESCE(pl.speed, 0) AS speed_kmh,
      pl.heading,
      COALESCE(tls.state, 'normal') AS state,
      COALESCE(tls.severity, 'info') AS severity,
      tls.message AS status_message,
      tr.geometry_geojson AS route_geometry_geojson,
      tls.distance_from_route_meters,
      tls.delay_minutes,
      tls.stopped_minutes,
      tls.average_speed_kmh,
      tls.eta_next_stop_at,
      tls.last_signal_at,
      tls.last_signal_age_seconds,
      pl.captured_at AS position_captured_at,
      (
        SELECT row_to_jsonb(ns) FROM (
          SELECT s.id, s.stop_order AS sequence, s.destination AS client_name,
                 s.planned_arrival_at, s.status
          FROM public.dispatch_stops s
          WHERE s.dispatch_trip_id = dt.id
            AND s.status IN ('pending','arriving','in_progress')
          ORDER BY s.stop_order ASC
          LIMIT 1
        ) ns
      ) AS next_stop,
      (
        SELECT COALESCE(jsonb_agg(row_to_jsonb(ps) ORDER BY (ps->>'sequence')::int), '[]'::jsonb)
        FROM (
          SELECT s.id, s.stop_order AS sequence, s.destination AS client_name,
                 s.actual_arrival_at, s.actual_departure_at, s.status
          FROM public.dispatch_stops s
          WHERE s.dispatch_trip_id = dt.id
            AND s.status IN ('completed','skipped','failed')
          ORDER BY s.stop_order ASC
        ) ps
      ) AS previous_stops,
      (
        SELECT COALESCE(jsonb_agg(row_to_jsonb(pe) ORDER BY (pe->>'sequence')::int), '[]'::jsonb)
        FROM (
          SELECT s.id, s.stop_order AS sequence, s.destination AS client_name,
                 s.planned_arrival_at, s.status
          FROM public.dispatch_stops s
          WHERE s.dispatch_trip_id = dt.id
            AND s.status IN ('pending','arriving','in_progress')
          ORDER BY s.stop_order ASC
        ) pe
      ) AS pending_stops,
      (
        SELECT COALESCE(jsonb_agg(row_to_jsonb(ld)), '[]'::jsonb)
        FROM (
          SELECT lo.id, lo.load_number AS code,
                 (SELECT count(*) FROM public.load_items li WHERE li.load_id = lo.id) AS documents_count,
                 lo.total_weight_kg AS total_weight
          FROM public.dispatch_trip_loads dtl
          JOIN public.loads lo ON lo.id = dtl.load_id
          WHERE dtl.dispatch_trip_id = dt.id
        ) ld
      ) AS loads
    FROM public.dispatch_trips dt
    LEFT JOIN public.loads l ON l.id = dt.load_id
    LEFT JOIN public.vehicles v ON v.id = dt.vehicle_id
    LEFT JOIN public.drivers d ON d.id = dt.driver_id
    LEFT JOIN public.positions_last pl ON pl.vehicle_id = dt.vehicle_id AND pl.tenant_id = dt.tenant_id
    LEFT JOIN public.trip_live_status tls ON tls.trip_id = dt.id AND tls.tenant_id = dt.tenant_id
    LEFT JOIN public.trip_routes tr ON tr.trip_id = dt.id AND tr.tenant_id = dt.tenant_id AND tr.provider = 'osrm'
    WHERE dt.tenant_id = _tenant_id
      AND dt.status IN ('planned','in_progress','loading','dispatched')
  ) t;

  RETURN COALESCE(_result, '[]'::jsonb);
END;
$$;