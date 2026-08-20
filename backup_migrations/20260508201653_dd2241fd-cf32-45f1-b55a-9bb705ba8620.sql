ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS trailer_plate text,
  ADD COLUMN IF NOT EXISTS merchandise_value numeric,
  ADD COLUMN IF NOT EXISTS ciot text,
  ADD COLUMN IF NOT EXISTS monitored boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dedicated_vehicle boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gate_departure_at timestamptz,
  ADD COLUMN IF NOT EXISTS arrival_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_arrival_at timestamptz,
  ADD COLUMN IF NOT EXISTS monitor_responsible text,
  ADD COLUMN IF NOT EXISTS driver_type text,
  ADD COLUMN IF NOT EXISTS sm_manager text,
  ADD COLUMN IF NOT EXISTS sm_release text;

CREATE INDEX IF NOT EXISTS idx_loads_trailer_plate ON public.loads (trailer_plate);
CREATE INDEX IF NOT EXISTS idx_loads_ciot ON public.loads (ciot);
CREATE INDEX IF NOT EXISTS idx_loads_monitored ON public.loads (monitored);
CREATE INDEX IF NOT EXISTS idx_loads_dedicated_vehicle ON public.loads (dedicated_vehicle);
CREATE INDEX IF NOT EXISTS idx_loads_gate_departure_at ON public.loads (gate_departure_at);
CREATE INDEX IF NOT EXISTS idx_loads_arrival_at ON public.loads (arrival_at);
CREATE INDEX IF NOT EXISTS idx_loads_estimated_arrival_at ON public.loads (estimated_arrival_at);
CREATE INDEX IF NOT EXISTS idx_loads_merchandise_value ON public.loads (merchandise_value);