ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cbs_base numeric DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cbs_rate numeric DEFAULT 0.90;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cbs_value numeric DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ibs_base numeric DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ibs_rate numeric DEFAULT 0.10;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS ibs_value numeric DEFAULT 0;