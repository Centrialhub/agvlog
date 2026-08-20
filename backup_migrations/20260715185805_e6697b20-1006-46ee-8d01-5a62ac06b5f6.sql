
ALTER TABLE public.closing_report_items
  ADD COLUMN IF NOT EXISTS vehicle_id uuid,
  ADD COLUMN IF NOT EXISTS vehicle_plate text,
  ADD COLUMN IF NOT EXISTS driver_id uuid,
  ADD COLUMN IF NOT EXISTS driver_name text,
  ADD COLUMN IF NOT EXISTS departure_at timestamptz,
  ADD COLUMN IF NOT EXISTS arrival_at_ts timestamptz,
  ADD COLUMN IF NOT EXISTS days_count integer,
  ADD COLUMN IF NOT EXISTS km_initial numeric,
  ADD COLUMN IF NOT EXISTS km_final numeric,
  ADD COLUMN IF NOT EXISTS km_driven numeric,
  ADD COLUMN IF NOT EXISTS fuel_liters numeric,
  ADD COLUMN IF NOT EXISTS fuel_unit_price numeric,
  ADD COLUMN IF NOT EXISTS fuel_total numeric,
  ADD COLUMN IF NOT EXISTS consumption_km_l numeric,
  ADD COLUMN IF NOT EXISTS route_label text,
  ADD COLUMN IF NOT EXISTS route_complement text;

ALTER TABLE public.closing_reports
  ADD COLUMN IF NOT EXISTS vehicle_plates_snapshot text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS driver_names_snapshot text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS total_km_driven numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_liters numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_fuel_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_consumption_km_l numeric DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_closing_reports_plates ON public.closing_reports USING GIN (vehicle_plates_snapshot);
CREATE INDEX IF NOT EXISTS idx_closing_reports_drivers ON public.closing_reports USING GIN (driver_names_snapshot);
CREATE INDEX IF NOT EXISTS idx_closing_report_items_vehicle ON public.closing_report_items (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_closing_report_items_driver ON public.closing_report_items (driver_id);
