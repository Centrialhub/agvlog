
ALTER TABLE public.freight_tables
  ADD COLUMN rate_percent numeric DEFAULT 0,
  ADD COLUMN fixed_value numeric DEFAULT 0,
  ADD COLUMN min_value numeric DEFAULT 0,
  ADD COLUMN per_kg_value numeric DEFAULT 0,
  ADD COLUMN per_pallet_value numeric DEFAULT 0;
