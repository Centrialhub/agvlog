
-- 1. vehicles_state — single source of truth for vehicle state
CREATE TABLE public.vehicles_state (
  vehicle_id uuid PRIMARY KEY REFERENCES public.vehicles(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  last_position_id uuid REFERENCES public.positions_raw(id),
  lat double precision,
  lng double precision,
  speed double precision NOT NULL DEFAULT 0,
  heading double precision,
  movement_state text NOT NULL DEFAULT 'unknown'
    CHECK (movement_state IN ('moving', 'stopped', 'idle', 'offline', 'unknown')),
  last_movement_at timestamptz,
  last_position_at timestamptz,
  stopped_since timestamptz,
  stopped_duration_seconds integer DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vehicles_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view vehicles_state"
  ON public.vehicles_state FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Service can manage vehicles_state"
  ON public.vehicles_state FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE INDEX idx_vehicles_state_tenant ON public.vehicles_state(tenant_id);
CREATE INDEX idx_vehicles_state_movement ON public.vehicles_state(tenant_id, movement_state);

-- 2. vehicle_events — detected state transitions
CREATE TABLE public.vehicle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('stop_detected', 'movement_resumed', 'went_offline', 'came_online', 'idle_detected')),
  event_at timestamptz NOT NULL DEFAULT now(),
  lat double precision,
  lng double precision,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vehicle_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view vehicle_events"
  ON public.vehicle_events FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Service can manage vehicle_events"
  ON public.vehicle_events FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE INDEX idx_vehicle_events_vehicle ON public.vehicle_events(tenant_id, vehicle_id, event_at DESC);
CREATE INDEX idx_vehicle_events_type ON public.vehicle_events(tenant_id, event_type, event_at DESC);
