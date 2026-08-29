-- A fiscal credential must belong to the same tenant as its emitter.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_emitters_tenant_id_id_uidx
  ON public.tenant_emitters (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_hub_fiscal_credentials_tenant_emitter
  ON public.hub_fiscal_credentials (tenant_id, emitter_id);

ALTER TABLE public.hub_fiscal_credentials
  DROP CONSTRAINT IF EXISTS hub_fiscal_credentials_emitter_id_fkey,
  ADD CONSTRAINT hub_fiscal_credentials_emitter_id_fkey
    FOREIGN KEY (tenant_id, emitter_id)
    REFERENCES public.tenant_emitters (tenant_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.hub_fiscal_credentials
  VALIDATE CONSTRAINT hub_fiscal_credentials_emitter_id_fkey;
