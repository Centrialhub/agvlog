ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS address_city_ibge_code text,
  ADD COLUMN IF NOT EXISTS address_country_code text,
  ADD COLUMN IF NOT EXISTS address_country_name text;

CREATE INDEX IF NOT EXISTS idx_clients_address_city_ibge ON public.clients (tenant_id, address_city_ibge_code);