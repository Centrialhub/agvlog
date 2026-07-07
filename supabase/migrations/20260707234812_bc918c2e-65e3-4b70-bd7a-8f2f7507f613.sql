
ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS external_load_number text,
  ADD COLUMN IF NOT EXISTS control_load_number text,
  ADD COLUMN IF NOT EXISTS load_date date,
  ADD COLUMN IF NOT EXISTS arrival_date date,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS expected_payment_date date,
  ADD COLUMN IF NOT EXISTS payment_date date,
  ADD COLUMN IF NOT EXISTS operational_status text,
  ADD COLUMN IF NOT EXISTS billing_status text,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS gross_cargo_value numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freight_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS received_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freight_percent numeric(8,4),
  ADD COLUMN IF NOT EXISTS invoice_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cte_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS legacy_status_text text,
  ADD COLUMN IF NOT EXISTS source_origin text,
  ADD COLUMN IF NOT EXISTS last_import_batch_id uuid,
  ADD COLUMN IF NOT EXISTS receivable_id uuid,
  ADD COLUMN IF NOT EXISTS client_invoice_id uuid,
  ADD COLUMN IF NOT EXISTS doccob_export_id uuid;

CREATE INDEX IF NOT EXISTS idx_loads_tenant_ext_num       ON public.loads(tenant_id, external_load_number);
CREATE INDEX IF NOT EXISTS idx_loads_tenant_load_date     ON public.loads(tenant_id, load_date);
CREATE INDEX IF NOT EXISTS idx_loads_tenant_arrival_date  ON public.loads(tenant_id, arrival_date);
CREATE INDEX IF NOT EXISTS idx_loads_tenant_exp_pay_date  ON public.loads(tenant_id, expected_payment_date);
CREATE INDEX IF NOT EXISTS idx_loads_tenant_payment_stat  ON public.loads(tenant_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_loads_tenant_billing_stat  ON public.loads(tenant_id, billing_status);
CREATE INDEX IF NOT EXISTS idx_loads_tenant_op_stat       ON public.loads(tenant_id, operational_status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_loads_tenant_external_load_number
  ON public.loads(tenant_id, external_load_number)
  WHERE external_load_number IS NOT NULL;

-- Extend existing public.load_documents (was minimal join table)
ALTER TABLE public.load_documents
  ADD COLUMN IF NOT EXISTS cte_document_id uuid REFERENCES public.cte_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS document_type text NOT NULL DEFAULT 'nfe',
  ADD COLUMN IF NOT EXISTS document_number text,
  ADD COLUMN IF NOT EXISTS access_key text,
  ADD COLUMN IF NOT EXISTS issue_date date,
  ADD COLUMN IF NOT EXISTS issuer_name text,
  ADD COLUMN IF NOT EXISTS issuer_cnpj text,
  ADD COLUMN IF NOT EXISTS recipient_name text,
  ADD COLUMN IF NOT EXISTS recipient_cnpj text,
  ADD COLUMN IF NOT EXISTS origin_city text,
  ADD COLUMN IF NOT EXISTS origin_state text,
  ADD COLUMN IF NOT EXISTS destination_city text,
  ADD COLUMN IF NOT EXISTS destination_state text,
  ADD COLUMN IF NOT EXISTS cargo_value numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS freight_value numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weight_kg numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS volume_count numeric(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_ld_tenant_load   ON public.load_documents(tenant_id, load_id);
CREATE INDEX IF NOT EXISTS idx_ld_tenant_ak     ON public.load_documents(tenant_id, access_key);
CREATE INDEX IF NOT EXISTS idx_ld_tenant_num    ON public.load_documents(tenant_id, document_number);
CREATE INDEX IF NOT EXISTS idx_ld_tenant_fdoc   ON public.load_documents(tenant_id, fiscal_document_id);
CREATE INDEX IF NOT EXISTS idx_ld_tenant_ctedoc ON public.load_documents(tenant_id, cte_document_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ld_tenant_access_key
  ON public.load_documents(tenant_id, access_key)
  WHERE access_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.load_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  source_type text NOT NULL,
  file_name text,
  file_count integer NOT NULL DEFAULT 0,
  parsed_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  duplicated_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'processing',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.load_import_batches TO authenticated;
GRANT ALL ON public.load_import_batches TO service_role;
ALTER TABLE public.load_import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lib_select" ON public.load_import_batches;
DROP POLICY IF EXISTS "lib_insert" ON public.load_import_batches;
DROP POLICY IF EXISTS "lib_update" ON public.load_import_batches;
DROP POLICY IF EXISTS "lib_delete" ON public.load_import_batches;
CREATE POLICY "lib_select" ON public.load_import_batches FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "lib_insert" ON public.load_import_batches FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "lib_update" ON public.load_import_batches FOR UPDATE TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "lib_delete" ON public.load_import_batches FOR DELETE TO authenticated
  USING (public.is_tenant_admin(tenant_id));
CREATE INDEX IF NOT EXISTS idx_lib_tenant_created ON public.load_import_batches(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.load_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  receivable_id uuid REFERENCES public.receivables(id) ON DELETE SET NULL,
  payment_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  payment_method text,
  bank_account_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.load_payments TO authenticated;
GRANT ALL ON public.load_payments TO service_role;
ALTER TABLE public.load_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lp_select" ON public.load_payments;
DROP POLICY IF EXISTS "lp_insert" ON public.load_payments;
DROP POLICY IF EXISTS "lp_update" ON public.load_payments;
DROP POLICY IF EXISTS "lp_delete" ON public.load_payments;
CREATE POLICY "lp_select" ON public.load_payments FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "lp_insert" ON public.load_payments FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "lp_update" ON public.load_payments FOR UPDATE TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "lp_delete" ON public.load_payments FOR DELETE TO authenticated
  USING (public.is_tenant_admin(tenant_id));
CREATE INDEX IF NOT EXISTS idx_lp_tenant_load ON public.load_payments(tenant_id, load_id);

CREATE TABLE IF NOT EXISTS public.load_unloading_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  load_id uuid REFERENCES public.loads(id) ON DELETE SET NULL,
  fiscal_document_id uuid REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  invoice_number text,
  client_name text,
  supplier_name text,
  city text,
  service_date date,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  import_batch_id uuid REFERENCES public.load_import_batches(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.load_unloading_charges TO authenticated;
GRANT ALL ON public.load_unloading_charges TO service_role;
ALTER TABLE public.load_unloading_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "luc_select" ON public.load_unloading_charges;
DROP POLICY IF EXISTS "luc_write" ON public.load_unloading_charges;
CREATE POLICY "luc_select" ON public.load_unloading_charges FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "luc_write" ON public.load_unloading_charges FOR ALL TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE INDEX IF NOT EXISTS idx_luc_tenant_invnum ON public.load_unloading_charges(tenant_id, invoice_number);

CREATE TABLE IF NOT EXISTS public.load_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  field_name text NOT NULL,
  old_value text,
  new_value text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
GRANT SELECT, INSERT ON public.load_status_history TO authenticated;
GRANT ALL ON public.load_status_history TO service_role;
ALTER TABLE public.load_status_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lsh_select" ON public.load_status_history;
DROP POLICY IF EXISTS "lsh_insert" ON public.load_status_history;
CREATE POLICY "lsh_select" ON public.load_status_history FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "lsh_insert" ON public.load_status_history FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE INDEX IF NOT EXISTS idx_lsh_tenant_load ON public.load_status_history(tenant_id, load_id);
