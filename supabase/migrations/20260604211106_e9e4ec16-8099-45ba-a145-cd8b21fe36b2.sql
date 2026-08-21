-- =========================================
-- 1) trip_routes
-- =========================================
CREATE TABLE IF NOT EXISTS public.trip_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  trip_id uuid NOT NULL REFERENCES public.dispatch_trips(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'osrm',
  geometry_geojson jsonb NOT NULL,
  encoded_polyline text,
  distance_meters numeric,
  duration_seconds numeric,
  origin_lat numeric,
  origin_lng numeric,
  destination_lat numeric,
  destination_lng numeric,
  waypoints jsonb,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_routes TO authenticated;
GRANT ALL ON public.trip_routes TO service_role;

ALTER TABLE public.trip_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_routes_select_member"
  ON public.trip_routes FOR SELECT
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "trip_routes_write_member"
  ON public.trip_routes FOR ALL
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE INDEX IF NOT EXISTS idx_trip_routes_tenant_trip ON public.trip_routes (tenant_id, trip_id);

CREATE TRIGGER trg_trip_routes_updated_at
  BEFORE UPDATE ON public.trip_routes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- 2) trip_live_status
-- =========================================
CREATE TABLE IF NOT EXISTS public.trip_live_status (
  tenant_id uuid NOT NULL,
  trip_id uuid NOT NULL REFERENCES public.dispatch_trips(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'normal',
  severity text NOT NULL DEFAULT 'info',
  current_stop_id uuid,
  next_stop_id uuid,
  distance_from_route_meters numeric,
  delay_minutes numeric,
  stopped_minutes numeric,
  average_speed_kmh numeric,
  eta_next_stop_at timestamptz,
  last_signal_at timestamptz,
  last_signal_age_seconds numeric,
  message text,
  metadata jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, trip_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_live_status TO authenticated;
GRANT ALL ON public.trip_live_status TO service_role;

ALTER TABLE public.trip_live_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_live_status_select_member"
  ON public.trip_live_status FOR SELECT
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "trip_live_status_write_member"
  ON public.trip_live_status FOR ALL
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE INDEX IF NOT EXISTS idx_trip_live_status_tenant_state ON public.trip_live_status (tenant_id, state);

-- =========================================
-- 3) trip_alerts
-- =========================================
CREATE TABLE IF NOT EXISTS public.trip_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  trip_id uuid REFERENCES public.dispatch_trips(id) ON DELETE CASCADE,
  vehicle_id uuid,
  type text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  title text NOT NULL,
  message text,
  status text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  closed_at timestamptz,
  metadata jsonb
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_alerts TO authenticated;
GRANT ALL ON public.trip_alerts TO service_role;

ALTER TABLE public.trip_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_alerts_select_member"
  ON public.trip_alerts FOR SELECT
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "trip_alerts_write_member"
  ON public.trip_alerts FOR ALL
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE INDEX IF NOT EXISTS idx_trip_alerts_tenant_status ON public.trip_alerts (tenant_id, status, severity);
CREATE INDEX IF NOT EXISTS idx_trip_alerts_trip_type_open
  ON public.trip_alerts (tenant_id, trip_id, type)
  WHERE status = 'open';

-- =========================================
-- 4) RPC consolidada para o painel
-- =========================================
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
      d.full_name AS driver_name,
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
      -- next stop
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
      -- previous stops
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
      -- pending stops
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
      -- loads
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

GRANT EXECUTE ON FUNCTION public.get_active_trips_live(uuid) TO authenticated;

-- RPC para listar alertas abertos
CREATE OR REPLACE FUNCTION public.get_open_trip_alerts(_tenant_id uuid)
RETURNS SETOF public.trip_alerts
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.trip_alerts
  WHERE tenant_id = _tenant_id
    AND status = 'open'
    AND public.is_tenant_member(_tenant_id)
  ORDER BY
    CASE severity
      WHEN 'critical' THEN 1
      WHEN 'danger' THEN 2
      WHEN 'warning' THEN 3
      WHEN 'info' THEN 4
      WHEN 'success' THEN 5
      ELSE 6
    END,
    opened_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_open_trip_alerts(uuid) TO authenticated;