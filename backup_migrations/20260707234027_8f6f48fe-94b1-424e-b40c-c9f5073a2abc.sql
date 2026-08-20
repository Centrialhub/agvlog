
-- ============ ENRIQUECER fiscal_documents ============
ALTER TABLE public.fiscal_documents ADD COLUMN IF NOT EXISTS import_batch_id text;
ALTER TABLE public.fiscal_documents ADD COLUMN IF NOT EXISTS control_lot text;
ALTER TABLE public.fiscal_documents ADD COLUMN IF NOT EXISTS dynamic_lot text;
ALTER TABLE public.fiscal_documents ADD COLUMN IF NOT EXISTS imported_at timestamptz;
ALTER TABLE public.fiscal_documents ADD COLUMN IF NOT EXISTS origin_city text;
ALTER TABLE public.fiscal_documents ADD COLUMN IF NOT EXISTS origin_state text;
ALTER TABLE public.fiscal_documents ADD COLUMN IF NOT EXISTS volume_count numeric;
ALTER TABLE public.fiscal_documents ADD COLUMN IF NOT EXISTS freight_cif_value numeric(14,2);
ALTER TABLE public.fiscal_documents ADD COLUMN IF NOT EXISTS freight_fob_value numeric(14,2);
ALTER TABLE public.fiscal_documents ADD COLUMN IF NOT EXISTS imported_note_status text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_documents_imported_note_status_check') THEN
    ALTER TABLE public.fiscal_documents ADD CONSTRAINT fiscal_documents_imported_note_status_check
      CHECK (imported_note_status IS NULL OR imported_note_status IN (
        'not_processed','not_processed_redispatch','processed','in_transit',
        'delivered','not_delivered','transferred','not_transferred'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_fiscal_docs_tenant_import_batch ON public.fiscal_documents(tenant_id, import_batch_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_tenant_control_lot ON public.fiscal_documents(tenant_id, control_lot);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_tenant_dynamic_lot ON public.fiscal_documents(tenant_id, dynamic_lot);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_tenant_imported_at ON public.fiscal_documents(tenant_id, imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_tenant_origin_city ON public.fiscal_documents(tenant_id, origin_city);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_tenant_recipient_city ON public.fiscal_documents(tenant_id, recipient_city);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_tenant_imported_status ON public.fiscal_documents(tenant_id, imported_note_status);
CREATE INDEX IF NOT EXISTS idx_fiscal_docs_tenant_load ON public.fiscal_documents(tenant_id, load_id);

-- ============ HISTÓRICO DE RELATÓRIOS ============
CREATE TABLE public.imported_note_summary_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('destination_summary','origin_summary','raw_list')),
  grouped boolean NOT NULL DEFAULT true,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  total_invoice_value numeric(14,2) NOT NULL DEFAULT 0,
  total_weight_kg numeric(14,3) NOT NULL DEFAULT 0,
  total_volume numeric(14,3) NOT NULL DEFAULT 0,
  pdf_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.imported_note_summary_reports TO authenticated;
GRANT ALL ON public.imported_note_summary_reports TO service_role;
ALTER TABLE public.imported_note_summary_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ins_reports_read" ON public.imported_note_summary_reports
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "ins_reports_insert" ON public.imported_note_summary_reports
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "ins_reports_delete" ON public.imported_note_summary_reports
  FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));

CREATE INDEX idx_ins_reports_tenant_generated ON public.imported_note_summary_reports(tenant_id, generated_at DESC);
