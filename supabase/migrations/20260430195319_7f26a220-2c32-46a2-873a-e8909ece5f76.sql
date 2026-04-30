ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS supplier_manifest text,
  ADD COLUMN IF NOT EXISTS distribution_manifest text,
  ADD COLUMN IF NOT EXISTS shipment_manifest text,
  ADD COLUMN IF NOT EXISTS origin_manifest text;

CREATE INDEX IF NOT EXISTS idx_loads_supplier_manifest
  ON public.loads(tenant_id, supplier_manifest)
  WHERE supplier_manifest IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loads_distribution_manifest
  ON public.loads(tenant_id, distribution_manifest)
  WHERE distribution_manifest IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loads_shipment_manifest
  ON public.loads(tenant_id, shipment_manifest)
  WHERE shipment_manifest IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loads_origin_manifest
  ON public.loads(tenant_id, origin_manifest)
  WHERE origin_manifest IS NOT NULL;