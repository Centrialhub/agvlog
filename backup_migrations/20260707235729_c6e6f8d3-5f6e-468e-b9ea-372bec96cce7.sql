
CREATE TABLE IF NOT EXISTS public.closing_report_sequences (
  tenant_id uuid NOT NULL,
  sequence_year integer NOT NULL,
  next_number integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sequence_year)
);
GRANT SELECT ON public.closing_report_sequences TO authenticated;
GRANT ALL ON public.closing_report_sequences TO service_role;
ALTER TABLE public.closing_report_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "closing_seq_select" ON public.closing_report_sequences
  FOR SELECT USING (public.is_tenant_member(tenant_id));

CREATE TABLE IF NOT EXISTS public.closing_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  client_id uuid NULL REFERENCES public.clients(id) ON DELETE SET NULL,
  payer_client_id uuid NULL REFERENCES public.clients(id) ON DELETE SET NULL,
  closing_number text NOT NULL,
  title text NOT NULL,
  report_type text NOT NULL,
  report_model text NOT NULL DEFAULT 'detailed',
  period_start date NOT NULL,
  period_end date NOT NULL,
  issue_date_start date NULL,
  issue_date_end date NULL,
  arrival_date_start date NULL,
  arrival_date_end date NULL,
  delivery_date_start date NULL,
  delivery_date_end date NULL,
  status text NOT NULL DEFAULT 'draft',
  payment_status text NOT NULL DEFAULT 'unpaid',
  invoice_status text NOT NULL DEFAULT 'not_invoiced',
  total_invoice_value numeric(14,2) NOT NULL DEFAULT 0,
  total_freight_value numeric(14,2) NOT NULL DEFAULT 0,
  total_weight_kg numeric(14,3) NOT NULL DEFAULT 0,
  total_volume numeric(14,3) NOT NULL DEFAULT 0,
  load_count integer NOT NULL DEFAULT 0,
  fiscal_document_count integer NOT NULL DEFAULT 0,
  cte_count integer NOT NULL DEFAULT 0,
  gross_amount numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  interest_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  expected_payment_date date NULL,
  payment_date date NULL,
  received_amount numeric(14,2) NOT NULL DEFAULT 0,
  open_amount numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  filters_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  totals_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  client_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  company_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_url text,
  excel_url text,
  csv_url text,
  client_invoice_id uuid NULL,
  receivable_id uuid NULL,
  doccob_export_id uuid NULL,
  sent_at timestamptz NULL,
  sent_to text NULL,
  sent_channel text NULL,
  closed_at timestamptz NULL,
  closed_by uuid NULL,
  cancelled_at timestamptz NULL,
  cancellation_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  CONSTRAINT closing_reports_unique_number UNIQUE (tenant_id, closing_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.closing_reports TO authenticated;
GRANT ALL ON public.closing_reports TO service_role;
ALTER TABLE public.closing_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "closing_reports_select" ON public.closing_reports
  FOR SELECT USING (public.is_tenant_member(tenant_id));
CREATE POLICY "closing_reports_insert" ON public.closing_reports
  FOR INSERT WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "closing_reports_update" ON public.closing_reports
  FOR UPDATE USING (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "closing_reports_delete" ON public.closing_reports
  FOR DELETE USING (public.is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_cr_tenant_number ON public.closing_reports (tenant_id, closing_number);
CREATE INDEX IF NOT EXISTS idx_cr_tenant_client ON public.closing_reports (tenant_id, client_id);
CREATE INDEX IF NOT EXISTS idx_cr_tenant_period ON public.closing_reports (tenant_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_cr_tenant_status ON public.closing_reports (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_cr_tenant_pay ON public.closing_reports (tenant_id, payment_status);
CREATE INDEX IF NOT EXISTS idx_cr_tenant_expected ON public.closing_reports (tenant_id, expected_payment_date);

CREATE TABLE IF NOT EXISTS public.closing_report_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  closing_report_id uuid NOT NULL REFERENCES public.closing_reports(id) ON DELETE CASCADE,
  load_id uuid NULL REFERENCES public.loads(id) ON DELETE SET NULL,
  fiscal_document_id uuid NULL REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  cte_document_id uuid NULL REFERENCES public.cte_documents(id) ON DELETE SET NULL,
  load_document_id uuid NULL,
  source_type text NOT NULL DEFAULT 'system',
  origin_city text,
  origin_state text,
  remitter_name text,
  remitter_cnpj text,
  recipient_name text,
  recipient_cnpj text,
  destination_city text,
  destination_state text,
  issue_date date,
  arrival_date date,
  delivery_date date,
  invoice_number text,
  invoice_key text,
  cte_number text,
  cte_key text,
  load_number text,
  invoice_value numeric(14,2) NOT NULL DEFAULT 0,
  weight_kg numeric(14,3) NOT NULL DEFAULT 0,
  volume_count numeric(14,3) NOT NULL DEFAULT 0,
  freight_value numeric(14,2) NOT NULL DEFAULT 0,
  freight_cif_value numeric(14,2) NOT NULL DEFAULT 0,
  freight_fob_value numeric(14,2) NOT NULL DEFAULT 0,
  delivery_status text,
  payment_status text,
  observation text,
  legacy_status_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.closing_report_items TO authenticated;
GRANT ALL ON public.closing_report_items TO service_role;
ALTER TABLE public.closing_report_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cri_select" ON public.closing_report_items
  FOR SELECT USING (public.is_tenant_member(tenant_id));
CREATE POLICY "cri_write" ON public.closing_report_items
  FOR ALL USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_cri_tenant_report ON public.closing_report_items (tenant_id, closing_report_id);
CREATE INDEX IF NOT EXISTS idx_cri_tenant_fd ON public.closing_report_items (tenant_id, fiscal_document_id);
CREATE INDEX IF NOT EXISTS idx_cri_tenant_cte ON public.closing_report_items (tenant_id, cte_document_id);
CREATE INDEX IF NOT EXISTS idx_cri_tenant_load ON public.closing_report_items (tenant_id, load_id);
CREATE INDEX IF NOT EXISTS idx_cri_tenant_inv ON public.closing_report_items (tenant_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_cri_tenant_cten ON public.closing_report_items (tenant_id, cte_number);

CREATE TABLE IF NOT EXISTS public.closing_report_summary_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  closing_report_id uuid NOT NULL REFERENCES public.closing_reports(id) ON DELETE CASCADE,
  group_type text NOT NULL,
  group_label text NOT NULL,
  arrival_date date NULL,
  billing_period_label text NULL,
  total_invoice_value numeric(14,2) NOT NULL DEFAULT 0,
  total_freight_value numeric(14,2) NOT NULL DEFAULT 0,
  total_weight_kg numeric(14,3) NOT NULL DEFAULT 0,
  total_volume numeric(14,3) NOT NULL DEFAULT 0,
  load_count integer NOT NULL DEFAULT 0,
  fiscal_document_count integer NOT NULL DEFAULT 0,
  cte_count integer NOT NULL DEFAULT 0,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.closing_report_summary_lines TO authenticated;
GRANT ALL ON public.closing_report_summary_lines TO service_role;
ALTER TABLE public.closing_report_summary_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crsl_select" ON public.closing_report_summary_lines
  FOR SELECT USING (public.is_tenant_member(tenant_id));
CREATE POLICY "crsl_write" ON public.closing_report_summary_lines
  FOR ALL USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE INDEX IF NOT EXISTS idx_crsl_tenant_report ON public.closing_report_summary_lines (tenant_id, closing_report_id);

CREATE TABLE IF NOT EXISTS public.closing_report_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  closing_report_id uuid NOT NULL REFERENCES public.closing_reports(id) ON DELETE CASCADE,
  receivable_id uuid NULL REFERENCES public.receivables(id) ON DELETE SET NULL,
  payment_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  payment_method text,
  bank_account_id uuid NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.closing_report_payments TO authenticated;
GRANT ALL ON public.closing_report_payments TO service_role;
ALTER TABLE public.closing_report_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crp_select" ON public.closing_report_payments
  FOR SELECT USING (public.is_tenant_member(tenant_id));
CREATE POLICY "crp_write" ON public.closing_report_payments
  FOR ALL USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE INDEX IF NOT EXISTS idx_crp_tenant_report ON public.closing_report_payments (tenant_id, closing_report_id);

CREATE TABLE IF NOT EXISTS public.closing_report_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  closing_report_id uuid NOT NULL REFERENCES public.closing_reports(id) ON DELETE CASCADE,
  action text NOT NULL,
  field_name text NULL,
  old_value text NULL,
  new_value text NULL,
  reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
GRANT SELECT, INSERT ON public.closing_report_history TO authenticated;
GRANT ALL ON public.closing_report_history TO service_role;
ALTER TABLE public.closing_report_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crh_select" ON public.closing_report_history
  FOR SELECT USING (public.is_tenant_member(tenant_id));
CREATE POLICY "crh_insert" ON public.closing_report_history
  FOR INSERT WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));

ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS closing_report_id uuid NULL,
  ADD COLUMN IF NOT EXISTS closing_status text NULL,
  ADD COLUMN IF NOT EXISTS closing_report_number text NULL;

ALTER TABLE public.receivables
  ADD COLUMN IF NOT EXISTS closing_report_id uuid NULL;

CREATE OR REPLACE FUNCTION public.next_closing_report_number(_tenant_id uuid, _date date DEFAULT current_date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _year int := EXTRACT(YEAR FROM _date);
  _n int;
BEGIN
  IF NOT public.is_tenant_member(_tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  INSERT INTO public.closing_report_sequences (tenant_id, sequence_year, next_number)
  VALUES (_tenant_id, _year, 2)
  ON CONFLICT (tenant_id, sequence_year)
  DO UPDATE SET next_number = closing_report_sequences.next_number + 1,
                updated_at = now()
  RETURNING next_number - 1 INTO _n;
  RETURN 'FCH-' || _year::text || '-' || lpad(_n::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.close_closing_report(_closing_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE _r public.closing_reports;
BEGIN
  SELECT * INTO _r FROM public.closing_reports WHERE id = _closing_report_id;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(_r.tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.closing_report_items WHERE closing_report_id = _r.id) THEN
    RAISE EXCEPTION 'no_items';
  END IF;
  UPDATE public.closing_reports
     SET status = 'closed', closed_at = now(), closed_by = auth.uid(), updated_at = now(),
         open_amount = GREATEST(0, total_amount - received_amount)
   WHERE id = _r.id;
  INSERT INTO public.closing_report_history (tenant_id, closing_report_id, action, created_by)
  VALUES (_r.tenant_id, _r.id, 'closed', auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_closing_report(_closing_report_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE _r public.closing_reports;
BEGIN
  SELECT * INTO _r FROM public.closing_reports WHERE id = _closing_report_id;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(_r.tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  UPDATE public.closing_reports
     SET status = 'cancelled', payment_status = 'cancelled',
         cancelled_at = now(), cancellation_reason = _reason, updated_at = now()
   WHERE id = _r.id;
  INSERT INTO public.closing_report_history (tenant_id, closing_report_id, action, reason, created_by)
  VALUES (_r.tenant_id, _r.id, 'cancelled', _reason, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_closing_report(_closing_report_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE _r public.closing_reports;
BEGIN
  SELECT * INTO _r FROM public.closing_reports WHERE id = _closing_report_id;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_admin(_r.tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _r.client_invoice_id IS NOT NULL OR _r.receivable_id IS NOT NULL THEN
    RAISE EXCEPTION 'has_linked_invoice_or_receivable';
  END IF;
  UPDATE public.closing_reports
     SET status = 'reviewing', closed_at = NULL, closed_by = NULL, updated_at = now()
   WHERE id = _r.id;
  INSERT INTO public.closing_report_history (tenant_id, closing_report_id, action, reason, created_by)
  VALUES (_r.tenant_id, _r.id, 'reopened', _reason, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.register_closing_report_payment(_closing_report_id uuid, _payment jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _r public.closing_reports;
  _amt numeric := COALESCE((_payment->>'amount')::numeric, 0);
  _date date := COALESCE((_payment->>'payment_date')::date, current_date);
  _method text := _payment->>'payment_method';
  _notes text := _payment->>'notes';
  _received numeric;
  _new_status text;
  _pay_id uuid;
BEGIN
  SELECT * INTO _r FROM public.closing_reports WHERE id = _closing_report_id;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(_r.tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _amt <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  INSERT INTO public.closing_report_payments (tenant_id, closing_report_id, receivable_id, payment_date, amount, payment_method, notes, created_by)
  VALUES (_r.tenant_id, _r.id, _r.receivable_id, _date, _amt, _method, _notes, auth.uid())
  RETURNING id INTO _pay_id;

  _received := COALESCE(_r.received_amount,0) + _amt;
  IF _received <= 0 THEN _new_status := 'unpaid';
  ELSIF _received >= _r.total_amount THEN _new_status := 'paid';
  ELSE _new_status := 'partially_paid';
  END IF;

  UPDATE public.closing_reports
     SET received_amount = _received,
         open_amount = GREATEST(0, total_amount - _received),
         payment_status = _new_status,
         payment_date = CASE WHEN _new_status = 'paid' THEN _date ELSE payment_date END,
         status = CASE WHEN _new_status = 'paid' THEN 'paid'
                       WHEN _new_status = 'partially_paid' THEN 'partially_paid'
                       ELSE status END,
         updated_at = now()
   WHERE id = _r.id;

  IF _r.receivable_id IS NOT NULL THEN
    UPDATE public.receivables
       SET received_amount = COALESCE(received_amount,0) + _amt,
           received_at = CASE WHEN _new_status = 'paid' THEN now() ELSE received_at END,
           status = CASE WHEN _new_status = 'paid' THEN 'paid' ELSE status END,
           updated_at = now()
     WHERE id = _r.receivable_id;
  END IF;

  INSERT INTO public.closing_report_history (tenant_id, closing_report_id, action, new_value, created_by)
  VALUES (_r.tenant_id, _r.id, 'payment_registered', _amt::text, auth.uid());

  RETURN _pay_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_closing_report_overdue(_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE _n int;
BEGIN
  IF NOT public.is_tenant_member(_tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  UPDATE public.closing_reports
     SET payment_status = 'overdue', status = 'overdue', updated_at = now()
   WHERE tenant_id = _tenant_id
     AND payment_status = 'unpaid'
     AND expected_payment_date IS NOT NULL
     AND expected_payment_date < current_date;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
