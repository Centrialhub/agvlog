
-- Waypoint types enum
CREATE TYPE public.waypoint_type AS ENUM (
  'origin', 'destination', 'fueling', 'overnight', 'meal', 'client', 'checkpoint', 'other'
);

-- Route waypoints table
CREATE TABLE public.route_waypoints (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES public.route_templates(id) ON DELETE CASCADE,
  waypoint_order integer NOT NULL DEFAULT 0,
  waypoint_type public.waypoint_type NOT NULL DEFAULT 'checkpoint',
  label text,
  address text,
  lat double precision,
  lng double precision,
  poi_id uuid REFERENCES public.pois(id) ON DELETE SET NULL,
  geofence_id uuid REFERENCES public.geofences(id) ON DELETE SET NULL,
  estimated_duration_min integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.route_waypoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage route_waypoints"
  ON public.route_waypoints FOR ALL
  TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Members can view route_waypoints"
  ON public.route_waypoints FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE INDEX idx_route_waypoints_route ON public.route_waypoints(route_id, waypoint_order);
