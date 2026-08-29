-- Tenant-safe parent keys used by the closing-report graph.
CREATE UNIQUE INDEX IF NOT EXISTS closing_reports_tenant_id_id_uidx
  ON public.closing_reports (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS loads_tenant_id_id_uidx
  ON public.loads (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_documents_tenant_id_id_uidx
  ON public.fiscal_documents (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS receivables_tenant_id_id_uidx
  ON public.receivables (tenant_id, id);

-- Cover every new composite foreign key.
CREATE INDEX IF NOT EXISTS idx_cr_tenant_payer
  ON public.closing_reports (tenant_id, payer_client_id);
CREATE INDEX IF NOT EXISTS idx_cr_tenant_client_invoice
  ON public.closing_reports (tenant_id, client_invoice_id);
CREATE INDEX IF NOT EXISTS idx_cr_tenant_receivable
  ON public.closing_reports (tenant_id, receivable_id);
CREATE INDEX IF NOT EXISTS idx_crh_tenant_report
  ON public.closing_report_history (tenant_id, closing_report_id);
CREATE INDEX IF NOT EXISTS idx_cri_tenant_driver
  ON public.closing_report_items (tenant_id, driver_id);
CREATE INDEX IF NOT EXISTS idx_cri_tenant_vehicle
  ON public.closing_report_items (tenant_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_crp_tenant_receivable
  ON public.closing_report_payments (tenant_id, receivable_id);

ALTER TABLE public.closing_reports
  DROP CONSTRAINT IF EXISTS closing_reports_client_id_fkey,
  DROP CONSTRAINT IF EXISTS closing_reports_payer_client_id_fkey,
  ADD CONSTRAINT closing_reports_client_id_fkey
    FOREIGN KEY (tenant_id, client_id)
    REFERENCES public.clients (tenant_id, id)
    ON DELETE SET NULL (client_id)
    NOT VALID,
  ADD CONSTRAINT closing_reports_payer_client_id_fkey
    FOREIGN KEY (tenant_id, payer_client_id)
    REFERENCES public.clients (tenant_id, id)
    ON DELETE SET NULL (payer_client_id)
    NOT VALID,
  ADD CONSTRAINT closing_reports_tenant_client_invoice_fkey
    FOREIGN KEY (tenant_id, client_invoice_id)
    REFERENCES public.client_invoices (tenant_id, id)
    ON DELETE SET NULL (client_invoice_id)
    NOT VALID,
  ADD CONSTRAINT closing_reports_tenant_receivable_fkey
    FOREIGN KEY (tenant_id, receivable_id)
    REFERENCES public.receivables (tenant_id, id)
    ON DELETE SET NULL (receivable_id)
    NOT VALID;

ALTER TABLE public.closing_report_history
  DROP CONSTRAINT IF EXISTS closing_report_history_closing_report_id_fkey,
  ADD CONSTRAINT closing_report_history_closing_report_id_fkey
    FOREIGN KEY (tenant_id, closing_report_id)
    REFERENCES public.closing_reports (tenant_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.closing_report_items
  DROP CONSTRAINT IF EXISTS closing_report_items_closing_report_id_fkey,
  DROP CONSTRAINT IF EXISTS closing_report_items_load_id_fkey,
  DROP CONSTRAINT IF EXISTS closing_report_items_fiscal_document_id_fkey,
  DROP CONSTRAINT IF EXISTS closing_report_items_cte_document_id_fkey,
  ADD CONSTRAINT closing_report_items_closing_report_id_fkey
    FOREIGN KEY (tenant_id, closing_report_id)
    REFERENCES public.closing_reports (tenant_id, id)
    ON DELETE CASCADE
    NOT VALID,
  ADD CONSTRAINT closing_report_items_load_id_fkey
    FOREIGN KEY (tenant_id, load_id)
    REFERENCES public.loads (tenant_id, id)
    ON DELETE SET NULL (load_id)
    NOT VALID,
  ADD CONSTRAINT closing_report_items_fiscal_document_id_fkey
    FOREIGN KEY (tenant_id, fiscal_document_id)
    REFERENCES public.fiscal_documents (tenant_id, id)
    ON DELETE SET NULL (fiscal_document_id)
    NOT VALID,
  ADD CONSTRAINT closing_report_items_cte_document_id_fkey
    FOREIGN KEY (tenant_id, cte_document_id)
    REFERENCES public.cte_documents (tenant_id, id)
    ON DELETE SET NULL (cte_document_id)
    NOT VALID,
  ADD CONSTRAINT closing_report_items_tenant_driver_fkey
    FOREIGN KEY (tenant_id, driver_id)
    REFERENCES public.drivers (tenant_id, id)
    ON DELETE SET NULL (driver_id)
    NOT VALID,
  ADD CONSTRAINT closing_report_items_tenant_vehicle_fkey
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES public.vehicles (tenant_id, id)
    ON DELETE SET NULL (vehicle_id)
    NOT VALID;

ALTER TABLE public.closing_report_payments
  DROP CONSTRAINT IF EXISTS closing_report_payments_closing_report_id_fkey,
  DROP CONSTRAINT IF EXISTS closing_report_payments_receivable_id_fkey,
  ADD CONSTRAINT closing_report_payments_closing_report_id_fkey
    FOREIGN KEY (tenant_id, closing_report_id)
    REFERENCES public.closing_reports (tenant_id, id)
    ON DELETE CASCADE
    NOT VALID,
  ADD CONSTRAINT closing_report_payments_receivable_id_fkey
    FOREIGN KEY (tenant_id, receivable_id)
    REFERENCES public.receivables (tenant_id, id)
    ON DELETE SET NULL (receivable_id)
    NOT VALID;

ALTER TABLE public.closing_report_summary_lines
  DROP CONSTRAINT IF EXISTS closing_report_summary_lines_closing_report_id_fkey,
  ADD CONSTRAINT closing_report_summary_lines_closing_report_id_fkey
    FOREIGN KEY (tenant_id, closing_report_id)
    REFERENCES public.closing_reports (tenant_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.closing_reports
  VALIDATE CONSTRAINT closing_reports_client_id_fkey,
  VALIDATE CONSTRAINT closing_reports_payer_client_id_fkey,
  VALIDATE CONSTRAINT closing_reports_tenant_client_invoice_fkey,
  VALIDATE CONSTRAINT closing_reports_tenant_receivable_fkey;
ALTER TABLE public.closing_report_history
  VALIDATE CONSTRAINT closing_report_history_closing_report_id_fkey;
ALTER TABLE public.closing_report_items
  VALIDATE CONSTRAINT closing_report_items_closing_report_id_fkey,
  VALIDATE CONSTRAINT closing_report_items_load_id_fkey,
  VALIDATE CONSTRAINT closing_report_items_fiscal_document_id_fkey,
  VALIDATE CONSTRAINT closing_report_items_cte_document_id_fkey,
  VALIDATE CONSTRAINT closing_report_items_tenant_driver_fkey,
  VALIDATE CONSTRAINT closing_report_items_tenant_vehicle_fkey;
ALTER TABLE public.closing_report_payments
  VALIDATE CONSTRAINT closing_report_payments_closing_report_id_fkey,
  VALIDATE CONSTRAINT closing_report_payments_receivable_id_fkey;
ALTER TABLE public.closing_report_summary_lines
  VALIDATE CONSTRAINT closing_report_summary_lines_closing_report_id_fkey;

CREATE OR REPLACE FUNCTION public.next_closing_report_number(
  _tenant_id uuid,
  _date date DEFAULT CURRENT_DATE
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_year integer := EXTRACT(YEAR FROM _date);
  v_number integer;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  INSERT INTO public.closing_report_sequences (tenant_id, sequence_year, next_number)
  VALUES (_tenant_id, v_year, 2)
  ON CONFLICT (tenant_id, sequence_year)
  DO UPDATE SET next_number = closing_report_sequences.next_number + 1,
                updated_at = now()
  RETURNING next_number - 1 INTO v_number;
  RETURN 'FCH-' || v_year::text || '-' || lpad(v_number::text, 4, '0');
END;
$function$;

CREATE OR REPLACE FUNCTION public.generate_client_invoice_from_closing(
  _closing_report_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_report public.closing_reports%ROWTYPE;
  v_invoice_id uuid;
  v_receivable_id uuid;
  v_invoice_number text;
  v_gross numeric(14,2);
BEGIN
  SELECT *
    INTO v_report
    FROM public.closing_reports
   WHERE id = _closing_report_id
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_report.tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_report.status NOT IN ('closed', 'sent') THEN
    RAISE EXCEPTION 'closing_report_must_be_closed_or_sent';
  END IF;
  IF v_report.client_id IS NULL THEN RAISE EXCEPTION 'closing_report_has_no_client'; END IF;
  IF v_report.client_invoice_id IS NOT NULL THEN RAISE EXCEPTION 'closing_report_already_invoiced'; END IF;
  IF v_report.total_amount <= 0 THEN RAISE EXCEPTION 'closing_report_total_must_be_positive'; END IF;

  v_gross := CASE
    WHEN v_report.gross_amount > 0 THEN v_report.gross_amount
    ELSE v_report.total_amount + v_report.discount_amount - v_report.interest_amount
  END;
  IF v_gross < 0 THEN RAISE EXCEPTION 'closing_report_gross_amount_is_invalid'; END IF;

  v_invoice_id := public.create_client_invoice(jsonb_build_object(
    'tenant_id', v_report.tenant_id,
    'client_id', v_report.client_id,
    'issue_date', CURRENT_DATE,
    'due_date', v_report.expected_payment_date,
    'discount_amount', v_report.discount_amount,
    'interest_amount', v_report.interest_amount,
    'notes', 'Gerada a partir do fechamento ' || v_report.closing_number,
    'charges', jsonb_build_array(jsonb_build_object(
      'source_type', 'manual_service',
      'source_number', v_report.closing_number,
      'reference_number', v_report.closing_number,
      'issue_date', CURRENT_DATE,
      'description', 'Fechamento ' || v_report.closing_number,
      'gross_amount', v_gross,
      'net_amount', v_report.total_amount,
      'sort_order', 0
    ))
  ));

  SELECT invoice_number, receivable_id
    INTO v_invoice_number, v_receivable_id
    FROM public.client_invoices
   WHERE tenant_id = v_report.tenant_id
     AND id = v_invoice_id;

  UPDATE public.closing_reports
     SET client_invoice_id = v_invoice_id,
         receivable_id = v_receivable_id,
         invoice_status = 'invoiced',
         status = 'invoiced',
         updated_at = now(),
         updated_by = auth.uid()
   WHERE tenant_id = v_report.tenant_id
     AND id = v_report.id;

  INSERT INTO public.closing_report_history(
    tenant_id, closing_report_id, action, new_value, created_by
  ) VALUES (
    v_report.tenant_id, v_report.id, 'invoice_generated', v_invoice_number, auth.uid()
  );

  RETURN v_invoice_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_closing_report_payment(
  _closing_report_id uuid,
  _payment jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_report public.closing_reports%ROWTYPE;
  v_amount numeric(14,2);
  v_date date;
  v_method text;
  v_notes text;
  v_bank_account_id uuid;
  v_received numeric(14,2);
  v_new_status text;
  v_closing_payment_id uuid;
BEGIN
  IF _payment IS NULL OR jsonb_typeof(_payment) <> 'object' THEN
    RAISE EXCEPTION 'payment_must_be_an_object';
  END IF;

  v_amount := COALESCE(NULLIF(_payment->>'amount', '')::numeric, 0);
  v_date := COALESCE(NULLIF(_payment->>'payment_date', '')::date, CURRENT_DATE);
  v_method := COALESCE(NULLIF(btrim(_payment->>'payment_method'), ''), 'other');
  v_notes := NULLIF(btrim(_payment->>'notes'), '');
  v_bank_account_id := NULLIF(_payment->>'bank_account_id', '')::uuid;

  SELECT *
    INTO v_report
    FROM public.closing_reports
   WHERE id = _closing_report_id
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_report.tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF v_report.receivable_id IS NULL THEN RAISE EXCEPTION 'closing_report_must_be_invoiced_first'; END IF;
  IF v_report.status IN ('cancelled', 'paid') THEN RAISE EXCEPTION 'closing_report_not_payable'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF v_amount > COALESCE(v_report.open_amount, v_report.total_amount) + 0.01 THEN
    RAISE EXCEPTION 'amount_exceeds_open_balance';
  END IF;
  IF v_bank_account_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.bank_accounts
     WHERE tenant_id = v_report.tenant_id
       AND id = v_bank_account_id
       AND active
  ) THEN
    RAISE EXCEPTION 'invalid_bank_account';
  END IF;

  PERFORM public.register_receivable_payment(
    v_report.receivable_id,
    v_amount,
    v_date::timestamp AT TIME ZONE 'UTC',
    v_bank_account_id,
    v_method,
    v_notes,
    NULL
  );

  INSERT INTO public.closing_report_payments(
    tenant_id, closing_report_id, receivable_id, bank_account_id,
    payment_date, amount, payment_method, notes, created_by
  ) VALUES (
    v_report.tenant_id, v_report.id, v_report.receivable_id, v_bank_account_id,
    v_date, v_amount, v_method, v_notes, auth.uid()
  ) RETURNING id INTO v_closing_payment_id;

  v_received := COALESCE(v_report.received_amount, 0) + v_amount;
  v_new_status := CASE
    WHEN v_received >= v_report.total_amount THEN 'paid'
    ELSE 'partially_paid'
  END;

  UPDATE public.closing_reports
     SET received_amount = v_received,
         open_amount = GREATEST(0, total_amount - v_received),
         payment_status = v_new_status,
         payment_date = CASE WHEN v_new_status = 'paid' THEN v_date ELSE payment_date END,
         status = v_new_status,
         updated_at = now(),
         updated_by = auth.uid()
   WHERE tenant_id = v_report.tenant_id
     AND id = v_report.id;

  INSERT INTO public.closing_report_history(
    tenant_id, closing_report_id, action, new_value, created_by
  ) VALUES (
    v_report.tenant_id, v_report.id, 'payment_registered', v_amount::text, auth.uid()
  );

  RETURN v_closing_payment_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.generate_client_invoice_from_closing(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_client_invoice_from_closing(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.generate_client_invoice_from_closing(uuid) IS
  'Atomically creates the client invoice and receivable for a closed report.';
COMMENT ON FUNCTION public.register_closing_report_payment(uuid, jsonb) IS
  'Registers a closing payment through the canonical receivable and bank ledger.';
