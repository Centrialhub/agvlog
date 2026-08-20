
-- Phase 1: Fuel, Routes, Extended Metrics

-- A) Vehicle config columns
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS tank_capacity_liters double precision,
  ADD COLUMN IF NOT EXISTS speed_limit_kmh int,
  ADD COLUMN IF NOT EXISTS fuel_canonical_key text;

-- B) Fuel tables
CREATE TABLE public.fuel_readings (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  captured_at timestamptz NOT NULL,
  fuel_value double precision NOT NULL,
  fuel_unit text NOT NULL DEFAULT 'percent',
  source_key text,
  raw jsonb DEFAULT '{}',
  PRIMARY KEY (tenant_id, vehicle_id, captured_at)
);
ALTER TABLE public.fuel_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view fuel_readings" ON public.fuel_readings FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Admins can manage fuel_readings" ON public.fuel_readings FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE INDEX idx_fuel_readings_vehicle_time ON public.fuel_readings(tenant_id, vehicle_id, captured_at DESC);

CREATE TABLE public.fuel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  event_type text NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now(),
  delta double precision,
  start_value double precision,
  end_value double precision,
  payload jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.fuel_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view fuel_events" ON public.fuel_events FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Admins can manage fuel_events" ON public.fuel_events FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE UNIQUE INDEX IF NOT EXISTS idx_fuel_events_dedupe ON public.fuel_events(tenant_id, vehicle_id, event_type, event_at);

-- C) Routes
CREATE TABLE public.route_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  corridor_geofence_id uuid REFERENCES public.geofences(id),
  start_poi_id uuid REFERENCES public.pois(id),
  end_poi_id uuid REFERENCES public.pois(id),
  corridor_inside_ratio_threshold numeric DEFAULT 0.85,
  allowed_outside_minutes int DEFAULT 5,
  route_speed_limit_kmh int,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.route_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view route_templates" ON public.route_templates FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Admins can manage route_templates" ON public.route_templates FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE INDEX idx_route_templates_tenant ON public.route_templates(tenant_id);

CREATE TABLE public.route_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES public.route_templates(id) ON DELETE CASCADE,
  inside_ratio numeric,
  outside_minutes int,
  status text NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, trip_id, route_id)
);
ALTER TABLE public.route_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view route_runs" ON public.route_runs FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Admins can manage route_runs" ON public.route_runs FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

-- D) Extend metrics_daily
ALTER TABLE public.metrics_daily
  ADD COLUMN IF NOT EXISTS max_speed_kmh int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_speed_kmh int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overspeed_minutes int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overnight_stops_count int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS route_deviation_events int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fuel_start double precision,
  ADD COLUMN IF NOT EXISTS fuel_end double precision,
  ADD COLUMN IF NOT EXISTS fuel_consumed double precision,
  ADD COLUMN IF NOT EXISTS fuel_refuel_events int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fuel_drain_events int DEFAULT 0;

-- E) RPC for corridor check
CREATE OR REPLACE FUNCTION public.count_points_in_geofence(
  _geofence_id uuid,
  _points jsonb
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
  SET search_path = public
SET search_path TO 'public','extensions'
AS $$
DECLARE
  i int;
  total int := 0;
  inside int := 0;
  p jsonb;
  lng double precision;
  lat double precision;
  is_in boolean;
BEGIN
  IF _points IS NULL THEN
    RETURN jsonb_build_object('total',0,'inside',0);
  END IF;
  total := jsonb_array_length(_points);
  IF total = 0 THEN
    RETURN jsonb_build_object('total',0,'inside',0);
  END IF;
  FOR i IN 0..total-1 LOOP
    p := _points->i;
    lng := (p->>'lng')::double precision;
    lat := (p->>'lat')::double precision;
    SELECT extensions.ST_Contains(
      (SELECT geometry FROM public.geofences WHERE id=_geofence_id),
      extensions.ST_SetSRID(extensions.ST_Point(lng, lat), 4326)
    ) INTO is_in;
    IF COALESCE(is_in,false) THEN inside := inside + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('total', total, 'inside', inside);
END;
$$;
