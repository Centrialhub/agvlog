
-- Vehicle maintenance tracking
CREATE TABLE public.vehicle_maintenance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  maintenance_type text NOT NULL DEFAULT 'preventive', -- preventive, corrective, inspection
  category text NOT NULL DEFAULT 'general', -- oil_change, tires, brakes, engine, electrical, general, bodywork
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'scheduled', -- scheduled, in_progress, completed, cancelled
  scheduled_date date,
  completed_date date,
  odometer_at_service numeric,
  next_odometer numeric, -- next service threshold
  next_date date, -- next service date
  cost numeric DEFAULT 0,
  vendor text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vehicle_maintenance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage vehicle_maintenance" ON public.vehicle_maintenance
  FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Members can view vehicle_maintenance" ON public.vehicle_maintenance
  FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Vehicle fueling log
CREATE TABLE public.vehicle_fueling (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id),
  dispatch_trip_id uuid REFERENCES public.dispatch_trips(id),
  fueled_at timestamptz NOT NULL DEFAULT now(),
  liters numeric NOT NULL DEFAULT 0,
  price_per_liter numeric,
  total_cost numeric,
  fuel_type text DEFAULT 'diesel', -- diesel, gasoline, ethanol, gas
  odometer_km numeric,
  station_name text,
  is_full_tank boolean DEFAULT false,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vehicle_fueling ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage vehicle_fueling" ON public.vehicle_fueling
  FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Members can view vehicle_fueling" ON public.vehicle_fueling
  FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Odometer readings (manual or automatic)
CREATE TABLE public.vehicle_odometer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  reading_km numeric NOT NULL,
  source text NOT NULL DEFAULT 'manual', -- manual, telemetry, fueling, maintenance
  recorded_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vehicle_odometer ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage vehicle_odometer" ON public.vehicle_odometer
  FOR ALL TO authenticated USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Members can view vehicle_odometer" ON public.vehicle_odometer
  FOR SELECT TO authenticated USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Indexes
CREATE INDEX idx_vehicle_maintenance_vehicle ON public.vehicle_maintenance(vehicle_id, tenant_id);
CREATE INDEX idx_vehicle_fueling_vehicle ON public.vehicle_fueling(vehicle_id, tenant_id);
CREATE INDEX idx_vehicle_odometer_vehicle ON public.vehicle_odometer(vehicle_id, tenant_id);
