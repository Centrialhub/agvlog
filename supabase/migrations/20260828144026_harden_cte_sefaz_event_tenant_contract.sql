-- Bind every SEFAZ event to a CT-e from the same tenant.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.cte_sefaz_events e
    LEFT JOIN public.tenants t ON t.id = e.tenant_id
    WHERE t.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.cte_sefaz_events e
    LEFT JOIN public.cte_documents d ON d.id = e.cte_document_id
    WHERE d.id IS NULL OR d.tenant_id <> e.tenant_id
  ) THEN
    RAISE EXCEPTION 'CT-e SEFAZ events contain an invalid tenant relationship';
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_cte_sefaz_events_tenant_document
  ON public.cte_sefaz_events (tenant_id, cte_document_id);

ALTER TABLE public.cte_sefaz_events
  DROP CONSTRAINT IF EXISTS cte_sefaz_events_cte_document_id_fkey,
  ADD CONSTRAINT cte_sefaz_events_cte_document_tenant_fk
    FOREIGN KEY (tenant_id, cte_document_id)
    REFERENCES public.cte_documents (tenant_id, id),
  ADD CONSTRAINT cte_sefaz_events_tenant_id_fkey
    FOREIGN KEY (tenant_id)
    REFERENCES public.tenants (id)
    ON DELETE CASCADE;
