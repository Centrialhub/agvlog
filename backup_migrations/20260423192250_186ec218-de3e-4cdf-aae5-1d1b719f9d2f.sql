CREATE TABLE public.ort_extraction_audits (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fiscal_document_id UUID NULL REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  source_file_name TEXT NOT NULL,
  ort_number TEXT NULL,
  dedupe_key TEXT NOT NULL,
  extracted_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reviewed_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  field_confidences JSONB NOT NULL DEFAULT '{}'::jsonb,
  overall_confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
  needs_review BOOLEAN NOT NULL DEFAULT false,
  reviewed BOOLEAN NOT NULL DEFAULT false,
  changed_fields TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status TEXT NOT NULL DEFAULT 'reviewed',
  created_by UUID NULL,
  reviewed_by UUID NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.ort_extraction_audits ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ort_extraction_audits_tenant_created ON public.ort_extraction_audits(tenant_id, created_at DESC);
CREATE INDEX idx_ort_extraction_audits_fiscal_document ON public.ort_extraction_audits(fiscal_document_id);
CREATE INDEX idx_ort_extraction_audits_dedupe ON public.ort_extraction_audits(tenant_id, dedupe_key);

CREATE POLICY "Tenant members can view ORT audit logs"
ON public.ort_extraction_audits
FOR SELECT
TO authenticated
USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant members can create ORT audit logs"
ON public.ort_extraction_audits
FOR INSERT
TO authenticated
WITH CHECK (public.is_tenant_member(tenant_id) AND created_by = auth.uid());

CREATE POLICY "Tenant admins can update ORT audit logs"
ON public.ort_extraction_audits
FOR UPDATE
TO authenticated
USING (public.is_tenant_admin(tenant_id))
WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE TRIGGER update_ort_extraction_audits_updated_at
BEFORE UPDATE ON public.ort_extraction_audits
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();