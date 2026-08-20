
-- Phase 3: Positions tables, ingestion cursors

-- positions_last (current state, 1 row per vehicle)
CREATE TABLE public.positions_last (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  speed double precision,
  heading double precision,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  telemetry_snapshot jsonb DEFAULT '{}'::jsonb,
  source jsonb DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, vehicle_id)
);

ALTER TABLE public.positions_last ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view positions_last"
  ON public.positions_last FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- positions_raw (history)
CREATE TABLE public.positions_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  speed double precision,
  heading double precision,
  telemetry jsonb DEFAULT '{}'::jsonb,
  provider_payload_hash text
);

ALTER TABLE public.positions_raw ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view positions_raw"
  ON public.positions_raw FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Indexes for positions_raw
CREATE INDEX idx_positions_raw_vehicle_time
  ON public.positions_raw (tenant_id, vehicle_id, captured_at DESC);

CREATE INDEX idx_positions_raw_tenant_time
  ON public.positions_raw (tenant_id, captured_at DESC);

CREATE UNIQUE INDEX idx_positions_raw_dedupe
  ON public.positions_raw (tenant_id, vehicle_id, provider_payload_hash)
  WHERE provider_payload_hash IS NOT NULL;

-- ingestion_cursors
CREATE TABLE public.ingestion_cursors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider_unit_id uuid NOT NULL REFERENCES public.provider_units(id) ON DELETE CASCADE,
  last_polled_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  backoff_until timestamptz,
  UNIQUE (tenant_id, provider_unit_id)
);

ALTER TABLE public.ingestion_cursors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view ingestion_cursors"
  ON public.ingestion_cursors FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));
