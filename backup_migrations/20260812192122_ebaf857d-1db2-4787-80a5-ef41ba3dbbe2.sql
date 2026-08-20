ALTER TABLE public.driver_expenses ADD COLUMN IF NOT EXISTS cost_center text;
ALTER TABLE public.maintenance_orders ADD COLUMN IF NOT EXISTS cost_center text;
