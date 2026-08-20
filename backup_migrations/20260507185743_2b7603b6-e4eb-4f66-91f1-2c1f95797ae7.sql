CREATE UNIQUE INDEX IF NOT EXISTS uq_client_regions_dedupe
  ON public.client_regions (
    tenant_id,
    upper(municipality),
    upper(state_code),
    COALESCE(upper(payer_group), ''),
    COALESCE(client_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );