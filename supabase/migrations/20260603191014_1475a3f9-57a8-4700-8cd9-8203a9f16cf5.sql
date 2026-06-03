ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS cash_to_receive numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pix_to_receive numeric NOT NULL DEFAULT 0;