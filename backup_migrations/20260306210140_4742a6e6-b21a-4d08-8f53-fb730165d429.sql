CREATE UNIQUE INDEX IF NOT EXISTS idx_provider_units_tenant_account_code
ON public.provider_units (tenant_id, integration_account_id, external_code);