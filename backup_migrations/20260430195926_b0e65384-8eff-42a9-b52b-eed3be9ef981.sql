CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- fiscal_documents
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_tenant_client_issue
  ON public.fiscal_documents(tenant_id, client_id, issue_date DESC);

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_tenant_type_status
  ON public.fiscal_documents(tenant_id, document_type, status);

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_invoice_trgm
  ON public.fiscal_documents USING gin (invoice_number gin_trgm_ops)
  WHERE invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_access_key_trgm
  ON public.fiscal_documents USING gin (access_key gin_trgm_ops)
  WHERE access_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_remitter_trgm
  ON public.fiscal_documents USING gin (remitter gin_trgm_ops)
  WHERE remitter IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_client_load_number_trgm
  ON public.fiscal_documents USING gin (client_load_number gin_trgm_ops)
  WHERE client_load_number IS NOT NULL;

-- loads
CREATE INDEX IF NOT EXISTS idx_loads_tenant_status
  ON public.loads(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_loads_load_number_trgm
  ON public.loads USING gin (load_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_loads_supplier_manifest_trgm
  ON public.loads USING gin (supplier_manifest gin_trgm_ops)
  WHERE supplier_manifest IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loads_distribution_manifest_trgm
  ON public.loads USING gin (distribution_manifest gin_trgm_ops)
  WHERE distribution_manifest IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loads_shipment_manifest_trgm
  ON public.loads USING gin (shipment_manifest gin_trgm_ops)
  WHERE shipment_manifest IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_loads_origin_manifest_trgm
  ON public.loads USING gin (origin_manifest gin_trgm_ops)
  WHERE origin_manifest IS NOT NULL;

-- vehicles
CREATE INDEX IF NOT EXISTS idx_vehicles_plate_trgm
  ON public.vehicles USING gin (plate gin_trgm_ops)
  WHERE plate IS NOT NULL;