-- Make tenant ownership explicit for the two incident tables that lacked it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.incidents i
    LEFT JOIN public.tenants t ON t.id = i.tenant_id
    WHERE t.id IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.incident_responsible ir
    LEFT JOIN public.tenants t ON t.id = ir.tenant_id
    WHERE t.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Incident ownership contains an unknown tenant';
  END IF;
END
$$;

ALTER TABLE public.incidents
  ADD CONSTRAINT incidents_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE;

ALTER TABLE public.incident_responsible
  ADD CONSTRAINT incident_responsible_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE;
