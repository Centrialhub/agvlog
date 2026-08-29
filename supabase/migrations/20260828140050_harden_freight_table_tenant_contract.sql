-- A freight table may only target a client belonging to its tenant.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.freight_tables f
    JOIN public.clients c ON c.id = f.client_id
    WHERE f.client_id IS NOT NULL
      AND c.tenant_id IS DISTINCT FROM f.tenant_id
  ) THEN
    RAISE EXCEPTION 'Freight tables contain cross-tenant client links';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_freight_tables_tenant_client
  ON public.freight_tables (tenant_id, client_id)
  WHERE client_id IS NOT NULL;

ALTER TABLE public.freight_tables
  DROP CONSTRAINT freight_tables_client_id_fkey,
  ADD CONSTRAINT freight_tables_client_id_fkey
    FOREIGN KEY (tenant_id, client_id)
    REFERENCES public.clients (tenant_id, id)
    ON DELETE SET NULL (client_id)
    NOT VALID;

ALTER TABLE public.freight_tables
  VALIDATE CONSTRAINT freight_tables_client_id_fkey;
