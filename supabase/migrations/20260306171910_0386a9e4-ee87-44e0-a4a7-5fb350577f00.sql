
-- Phase 2: Intelligence tables

-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1) events
CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  vehicle_id uuid REFERENCES public.vehicles(id),
  event_type text NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now(),
  severity text NOT NULL DEFAULT 'info',
  payload jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view events" ON public.events FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Admins can manage events" ON public.events FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE INDEX idx_events_tenant_at ON public.events (tenant_id, event_at DESC);
CREATE INDEX idx_events_tenant_vehicle_at ON public.events (tenant_id, vehicle_id, event_at DESC);

-- 2) alert_rules
CREATE TABLE public.alert_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  rule_type text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  requires_capabilities jsonb DEFAULT '[]',
  requires_feature_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.alert_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view alert_rules" ON public.alert_rules FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Admins can manage alert_rules" ON public.alert_rules FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

-- 3) alert_instances
CREATE TABLE public.alert_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  rule_id uuid REFERENCES public.alert_rules(id),
  vehicle_id uuid REFERENCES public.vehicles(id),
  status text NOT NULL DEFAULT 'open',
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  last_event_id uuid REFERENCES public.events(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.alert_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view alert_instances" ON public.alert_instances FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Admins can manage alert_instances" ON public.alert_instances FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE INDEX idx_alert_instances_status ON public.alert_instances (tenant_id, status, opened_at DESC);

-- 4) geofences (PostGIS)
CREATE TABLE public.geofences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  category text DEFAULT 'general',
  geometry geometry(Polygon, 4326) NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.geofences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view geofences" ON public.geofences FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Admins can manage geofences" ON public.geofences FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE INDEX idx_geofences_geom ON public.geofences USING GIST (geometry);

-- 5) geofence_events
CREATE TABLE public.geofence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  geofence_id uuid NOT NULL REFERENCES public.geofences(id),
  direction text NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb DEFAULT '{}'
);
ALTER TABLE public.geofence_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view geofence_events" ON public.geofence_events FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- 6) trips
CREATE TABLE public.trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  distance_km_estimated double precision,
  moving_time_seconds integer,
  stopped_time_seconds integer,
  detection_mode text NOT NULL DEFAULT 'basic',
  confidence_score numeric DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view trips" ON public.trips FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Admins can manage trips" ON public.trips FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE INDEX idx_trips_tenant_vehicle ON public.trips (tenant_id, vehicle_id, start_at DESC);

-- 7) trip_stops
CREATE TABLE public.trip_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  trip_id uuid REFERENCES public.trips(id),
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz,
  duration_seconds integer,
  stop_class text NOT NULL DEFAULT 'short',
  poi_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trip_stops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view trip_stops" ON public.trip_stops FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Admins can manage trip_stops" ON public.trip_stops FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

-- 8) pois
CREATE TABLE public.pois (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text,
  category text DEFAULT 'unknown',
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  radius_m double precision DEFAULT 80,
  source text NOT NULL DEFAULT 'auto',
  confidence_score numeric DEFAULT 0.3,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pois ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view pois" ON public.pois FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Admins can manage pois" ON public.pois FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

-- 9) telemetry_observations
CREATE TABLE public.telemetry_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  canonical_key text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  times_seen integer NOT NULL DEFAULT 1,
  last_value_type text,
  UNIQUE(tenant_id, vehicle_id, canonical_key)
);
ALTER TABLE public.telemetry_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view telemetry_observations" ON public.telemetry_observations FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- 10) vehicle_capabilities
CREATE TABLE public.vehicle_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) UNIQUE,
  capabilities jsonb NOT NULL DEFAULT '{}',
  confidence_score numeric DEFAULT 0.5,
  last_detected_at timestamptz DEFAULT now()
);
ALTER TABLE public.vehicle_capabilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view vehicle_capabilities" ON public.vehicle_capabilities FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- 11) metrics_daily
CREATE TABLE public.metrics_daily (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  day date NOT NULL,
  km_estimated double precision DEFAULT 0,
  moving_time_seconds integer DEFAULT 0,
  stopped_time_seconds integer DEFAULT 0,
  trips_count integer DEFAULT 0,
  stops_count integer DEFAULT 0,
  offline_minutes integer DEFAULT 0,
  overspeed_events integer DEFAULT 0,
  PRIMARY KEY (tenant_id, vehicle_id, day)
);
ALTER TABLE public.metrics_daily ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view metrics_daily" ON public.metrics_daily FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Admins can manage metrics_daily" ON public.metrics_daily FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

-- RPC to insert geofence with GeoJSON
CREATE OR REPLACE FUNCTION public.upsert_geofence(
  _id uuid,
  _tenant_id uuid,
  _name text,
  _category text,
  _geojson text,
  _enabled boolean
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _result_id uuid;
BEGIN
  IF NOT is_tenant_admin(_tenant_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  
  IF _id IS NOT NULL THEN
    UPDATE public.geofences
    SET name = _name, category = _category,
        geometry = ST_GeomFromGeoJSON(_geojson),
        enabled = _enabled
    WHERE id = _id AND tenant_id = _tenant_id
    RETURNING id INTO _result_id;
  END IF;
  
  IF _result_id IS NULL THEN
    INSERT INTO public.geofences (tenant_id, name, category, geometry, enabled)
    VALUES (_tenant_id, _name, _category, ST_GeomFromGeoJSON(_geojson), _enabled)
    RETURNING id INTO _result_id;
  END IF;
  
  RETURN _result_id;
END;
$$;
