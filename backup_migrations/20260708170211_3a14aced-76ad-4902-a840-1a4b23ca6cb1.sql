
-- delivery_occurrences
CREATE TABLE IF NOT EXISTS public.delivery_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  fiscal_document_id uuid REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  load_id uuid REFERENCES public.loads(id) ON DELETE SET NULL,
  cte_document_id uuid REFERENCES public.cte_documents(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  occurrence_number text,
  invoice_number text,
  cte_number text,
  customer_name text,
  supplier_name text,
  city text,
  state text,
  occurrence_type text NOT NULL,
  occurrence_reason text,
  occurrence_description text,
  occurrence_date date,
  occurrence_time time,
  status text NOT NULL DEFAULT 'open',
  resolution_type text,
  resolution_notes text,
  resolved_at timestamptz,
  closed_at timestamptz,
  responsible_user_id uuid,
  password_or_authorization text,
  legacy_status_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_occurrences TO authenticated;
GRANT ALL ON public.delivery_occurrences TO service_role;
ALTER TABLE public.delivery_occurrences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "delivery_occurrences_select" ON public.delivery_occurrences
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "delivery_occurrences_insert" ON public.delivery_occurrences
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "delivery_occurrences_update" ON public.delivery_occurrences
  FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "delivery_occurrences_delete" ON public.delivery_occurrences
  FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_do_tenant_occnum ON public.delivery_occurrences(tenant_id, occurrence_number);
CREATE INDEX IF NOT EXISTS idx_do_tenant_invoice ON public.delivery_occurrences(tenant_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_do_tenant_cte ON public.delivery_occurrences(tenant_id, cte_number);
CREATE INDEX IF NOT EXISTS idx_do_tenant_status ON public.delivery_occurrences(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_do_tenant_resolution ON public.delivery_occurrences(tenant_id, resolution_type);
CREATE INDEX IF NOT EXISTS idx_do_tenant_date ON public.delivery_occurrences(tenant_id, occurrence_date);
CREATE INDEX IF NOT EXISTS idx_do_tenant_client ON public.delivery_occurrences(tenant_id, client_id);
CREATE INDEX IF NOT EXISTS idx_do_tenant_supplier ON public.delivery_occurrences(tenant_id, supplier_id);
CREATE INDEX IF NOT EXISTS idx_do_tenant_load ON public.delivery_occurrences(tenant_id, load_id);

CREATE OR REPLACE FUNCTION public.tg_delivery_occurrence_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS trg_delivery_occurrence_touch ON public.delivery_occurrences;
CREATE TRIGGER trg_delivery_occurrence_touch BEFORE UPDATE ON public.delivery_occurrences
FOR EACH ROW EXECUTE FUNCTION public.tg_delivery_occurrence_touch();

-- delivery_occurrence_items
CREATE TABLE IF NOT EXISTS public.delivery_occurrence_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  occurrence_id uuid NOT NULL REFERENCES public.delivery_occurrences(id) ON DELETE CASCADE,
  fiscal_document_id uuid REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  invoice_number text,
  product_code text,
  product_description text,
  quantity_text text,
  quantity numeric(14,3),
  unit text,
  item_value numeric(14,2),
  return_type text,
  reason text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_occurrence_items TO authenticated;
GRANT ALL ON public.delivery_occurrence_items TO service_role;
ALTER TABLE public.delivery_occurrence_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "doi_select" ON public.delivery_occurrence_items
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "doi_insert" ON public.delivery_occurrence_items
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "doi_update" ON public.delivery_occurrence_items
  FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "doi_delete" ON public.delivery_occurrence_items
  FOR DELETE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id));
CREATE INDEX IF NOT EXISTS idx_doi_tenant_occ ON public.delivery_occurrence_items(tenant_id, occurrence_id);

-- occurrence_report_exports
CREATE TABLE IF NOT EXISTS public.occurrence_report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  report_type text NOT NULL,
  title text NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  period_start date,
  period_end date,
  filters_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL DEFAULT 0,
  occurrence_count integer NOT NULL DEFAULT 0,
  invoice_count integer NOT NULL DEFAULT 0,
  total_invoice_value numeric(14,2) NOT NULL DEFAULT 0,
  total_quantity numeric(14,3) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'generated',
  pdf_url text,
  excel_url text,
  csv_url text,
  generated_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  sent_to text,
  sent_channel text,
  sent_notes text,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.occurrence_report_exports TO authenticated;
GRANT ALL ON public.occurrence_report_exports TO service_role;
ALTER TABLE public.occurrence_report_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ore_select" ON public.occurrence_report_exports
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "ore_insert" ON public.occurrence_report_exports
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "ore_update" ON public.occurrence_report_exports
  FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "ore_delete" ON public.occurrence_report_exports
  FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));
CREATE INDEX IF NOT EXISTS idx_ore_tenant_type ON public.occurrence_report_exports(tenant_id, report_type);
CREATE INDEX IF NOT EXISTS idx_ore_tenant_created ON public.occurrence_report_exports(tenant_id, created_at DESC);

-- occurrence_report_export_items
CREATE TABLE IF NOT EXISTS public.occurrence_report_export_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  export_id uuid NOT NULL REFERENCES public.occurrence_report_exports(id) ON DELETE CASCADE,
  occurrence_id uuid REFERENCES public.delivery_occurrences(id) ON DELETE SET NULL,
  fiscal_document_id uuid REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  invoice_number text,
  cte_number text,
  occurrence_number text,
  customer_name text,
  supplier_name text,
  city text,
  state text,
  invoice_issue_date date,
  occurrence_date date,
  invoice_value numeric(14,2) NOT NULL DEFAULT 0,
  occurrence_type text,
  resolution_type text,
  reason text,
  quantity_text text,
  product_description text,
  password_or_authorization text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.occurrence_report_export_items TO authenticated;
GRANT ALL ON public.occurrence_report_export_items TO service_role;
ALTER TABLE public.occurrence_report_export_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orei_select" ON public.occurrence_report_export_items
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "orei_insert" ON public.occurrence_report_export_items
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "orei_update" ON public.occurrence_report_export_items
  FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "orei_delete" ON public.occurrence_report_export_items
  FOR DELETE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id));
CREATE INDEX IF NOT EXISTS idx_orei_tenant_export ON public.occurrence_report_export_items(tenant_id, export_id);

-- occurrence_report_import_batches
CREATE TABLE IF NOT EXISTS public.occurrence_report_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  file_name text,
  source_type text NOT NULL DEFAULT 'spreadsheet',
  detected_model text,
  row_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'processing',
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.occurrence_report_import_batches TO authenticated;
GRANT ALL ON public.occurrence_report_import_batches TO service_role;
ALTER TABLE public.occurrence_report_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "orib_select" ON public.occurrence_report_import_batches
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "orib_insert" ON public.occurrence_report_import_batches
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "orib_update" ON public.occurrence_report_import_batches
  FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "orib_delete" ON public.occurrence_report_import_batches
  FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));
CREATE INDEX IF NOT EXISTS idx_orib_tenant_created ON public.occurrence_report_import_batches(tenant_id, created_at DESC);
