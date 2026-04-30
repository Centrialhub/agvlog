
-- Lote de faturamento (uma sessão de geração de CT-es)
CREATE TABLE public.cte_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  grouping_mode smallint NOT NULL CHECK (grouping_mode BETWEEN 1 AND 14),
  grouping_mode_label text,
  source_type text NOT NULL DEFAULT 'period' CHECK (source_type IN ('period','loads')),
  period_start date,
  period_end date,
  load_ids uuid[] DEFAULT ARRAY[]::uuid[],
  fiscal_document_ids uuid[] DEFAULT ARRAY[]::uuid[],
  total_documents integer NOT NULL DEFAULT 0,
  total_value numeric NOT NULL DEFAULT 0,
  total_freight numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generated','cancelled')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX idx_cte_batches_tenant ON public.cte_batches(tenant_id, created_at DESC);
CREATE INDEX idx_cte_batches_client ON public.cte_batches(client_id);

ALTER TABLE public.cte_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select_cte_batches" ON public.cte_batches
  FOR SELECT USING (public.is_tenant_member(tenant_id));
CREATE POLICY "tenant_insert_cte_batches" ON public.cte_batches
  FOR INSERT WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "tenant_update_cte_batches" ON public.cte_batches
  FOR UPDATE USING (public.is_tenant_member(tenant_id));
CREATE POLICY "admin_delete_cte_batches" ON public.cte_batches
  FOR DELETE USING (public.is_tenant_admin(tenant_id));

CREATE TRIGGER trg_cte_batches_updated_at
  BEFORE UPDATE ON public.cte_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- CT-es gerados pelo lote
CREATE TABLE public.cte_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  batch_id uuid NOT NULL REFERENCES public.cte_batches(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  cte_number text,
  cte_series text DEFAULT '1',
  remitter text,
  recipient text,
  recipient_city text,
  recipient_state text,
  load_ids uuid[] DEFAULT ARRAY[]::uuid[],
  fiscal_document_ids uuid[] DEFAULT ARRAY[]::uuid[],
  invoice_count integer NOT NULL DEFAULT 0,
  pallet_count integer NOT NULL DEFAULT 0,
  weight_kg numeric NOT NULL DEFAULT 0,
  cargo_value numeric NOT NULL DEFAULT 0,
  freight_value numeric NOT NULL DEFAULT 0,
  ibs_base numeric,
  ibs_rate numeric,
  ibs_value numeric,
  cbs_base numeric,
  cbs_rate numeric,
  cbs_value numeric,
  net_value numeric,
  cfop text,
  receivable_id uuid,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','cancelled')),
  issued_at timestamptz,
  grouping_keys jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX idx_cte_documents_tenant ON public.cte_documents(tenant_id, created_at DESC);
CREATE INDEX idx_cte_documents_batch ON public.cte_documents(batch_id);
CREATE INDEX idx_cte_documents_client ON public.cte_documents(client_id);

ALTER TABLE public.cte_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_select_cte_documents" ON public.cte_documents
  FOR SELECT USING (public.is_tenant_member(tenant_id));
CREATE POLICY "tenant_insert_cte_documents" ON public.cte_documents
  FOR INSERT WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "tenant_update_cte_documents" ON public.cte_documents
  FOR UPDATE USING (public.is_tenant_member(tenant_id));
CREATE POLICY "admin_delete_cte_documents" ON public.cte_documents
  FOR DELETE USING (public.is_tenant_admin(tenant_id));

CREATE TRIGGER trg_cte_documents_updated_at
  BEFORE UPDATE ON public.cte_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
