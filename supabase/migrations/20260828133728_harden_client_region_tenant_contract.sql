-- Freight regions may only target clients from their own tenant.
CREATE INDEX IF NOT EXISTS idx_client_regions_tenant_client
  ON public.client_regions (tenant_id, client_id);

ALTER TABLE public.client_regions
  DROP CONSTRAINT IF EXISTS client_regions_client_id_fkey,
  ADD CONSTRAINT client_regions_client_id_fkey
    FOREIGN KEY (tenant_id, client_id)
    REFERENCES public.clients (tenant_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.client_regions
  VALIDATE CONSTRAINT client_regions_client_id_fkey;
