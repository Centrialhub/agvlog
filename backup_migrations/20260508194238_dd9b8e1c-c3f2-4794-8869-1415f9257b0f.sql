CREATE TABLE public.ingestion_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  batch_id text NOT NULL,
  source_label text,
  total_docs integer NOT NULL DEFAULT 0,
  saved_docs integer NOT NULL DEFAULT 0,
  error_docs integer NOT NULL DEFAULT 0,
  needs_review_docs integer NOT NULL DEFAULT 0,
  clients_auto_created integer NOT NULL DEFAULT 0,
  clients_matched integer NOT NULL DEFAULT 0,
  clients_unresolved integer NOT NULL DEFAULT 0,
  field_coverage jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingestion_reports_tenant_created ON public.ingestion_reports(tenant_id, created_at DESC);
CREATE INDEX idx_ingestion_reports_batch ON public.ingestion_reports(tenant_id, batch_id);

ALTER TABLE public.ingestion_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view ingestion reports"
  ON public.ingestion_reports FOR SELECT
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant members can insert ingestion reports"
  ON public.ingestion_reports FOR INSERT
  WITH CHECK (public.is_tenant_member(tenant_id) AND (created_by IS NULL OR created_by = auth.uid()));

CREATE POLICY "Tenant admins can delete ingestion reports"
  ON public.ingestion_reports FOR DELETE
  USING (public.is_tenant_admin(tenant_id));