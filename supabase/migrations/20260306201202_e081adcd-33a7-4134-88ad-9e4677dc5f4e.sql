-- FASE 2: Pipeline support tables and indexes

-- A) vehicle_processing_queue
CREATE TABLE IF NOT EXISTS public.vehicle_processing_queue (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  queued_at timestamptz NOT NULL DEFAULT now(),
  last_position_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  processed_at timestamptz,
  last_error text,
  PRIMARY KEY (tenant_id, vehicle_id)
);
ALTER TABLE public.vehicle_processing_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view queue" ON public.vehicle_processing_queue FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Admins can manage queue" ON public.vehicle_processing_queue FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

-- B) geofence_states
CREATE TABLE IF NOT EXISTS public.geofence_states (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  geofence_id uuid NOT NULL REFERENCES public.geofences(id) ON DELETE CASCADE,
  is_inside boolean NOT NULL DEFAULT false,
  last_changed_at timestamptz,
  last_checked_at timestamptz,
  PRIMARY KEY (tenant_id, vehicle_id, geofence_id)
);
ALTER TABLE public.geofence_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view geofence_states" ON public.geofence_states FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));
CREATE POLICY "Admins can manage geofence_states" ON public.geofence_states FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

-- C) Dedupe indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedupe ON public.events (tenant_id, vehicle_id, event_type, event_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_geofence_events_dedupe ON public.geofence_events (tenant_id, vehicle_id, geofence_id, direction, event_at);

-- D) Source columns
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS source text DEFAULT 'engine';
ALTER TABLE public.alert_instances ADD COLUMN IF NOT EXISTS source text DEFAULT 'engine';

-- E) Unique index on pois for dedupe
ALTER TABLE public.pois ADD COLUMN IF NOT EXISTS dedupe_key text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pois_dedupe ON public.pois (tenant_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- F) Unique index on telemetry_observations for upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_obs_upsert ON public.telemetry_observations (tenant_id, vehicle_id, canonical_key);