
-- ============================================================
-- PR2: sync_financial_obligations + import_bank_statement
-- ============================================================

-- ------------------------------------------------------------
-- sync_financial_obligations
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_financial_obligations(
  _tenant_id UUID,
  _date_from DATE DEFAULT NULL,
  _date_to DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_receivables INT := 0;
  v_settlements INT := 0;
  v_payables INT := 0;
  v_expenses INT := 0;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Receivables → inflow / receivable
  WITH src AS (
    SELECT r.*
    FROM public.receivables r
    WHERE r.tenant_id = _tenant_id
      AND (_date_from IS NULL OR COALESCE(r.due_date, r.created_at::date) >= _date_from)
      AND (_date_to   IS NULL OR COALESCE(r.due_date, r.created_at::date) <= _date_to)
  ),
  upsert AS (
    INSERT INTO public.financial_obligations (
      tenant_id, direction, obligation_type, source_table, source_id,
      description, counterparty_type, counterparty_id,
      amount_expected, amount_matched,
      due_date, expected_payment_date, competence_date,
      status, matching_status, metadata, created_by
    )
    SELECT
      s.tenant_id, 'inflow', 'receivable', 'receivables', s.id,
      COALESCE(s.description, s.invoice_number, 'Recebível'),
      CASE WHEN s.client_id IS NOT NULL THEN 'client' ELSE NULL END,
      s.client_id,
      COALESCE(s.amount, 0),
      COALESCE(s.received_amount, 0),
      s.due_date, s.received_at::date, s.due_date,
      CASE
        WHEN s.status = 'cancelled'                          THEN 'cancelled'
        WHEN s.status = 'received'                           THEN 'paid'
        WHEN COALESCE(s.received_amount,0) > 0
             AND COALESCE(s.received_amount,0) < s.amount    THEN 'partially_paid'
        ELSE 'pending'
      END,
      CASE
        WHEN s.status = 'received' THEN 'matched'
        WHEN COALESCE(s.received_amount,0) > 0 THEN 'partial'
        ELSE 'unmatched'
      END,
      jsonb_build_object(
        'invoice_number', s.invoice_number,
        'fiscal_document_id', s.fiscal_document_id,
        'load_id', s.load_id,
        'order_id', s.order_id
      ),
      s.created_by
    FROM src s
    ON CONFLICT (tenant_id, source_table, source_id, obligation_type)
      WHERE source_table IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET
      amount_expected = EXCLUDED.amount_expected,
      amount_matched  = GREATEST(financial_obligations.amount_matched, EXCLUDED.amount_matched),
      due_date        = EXCLUDED.due_date,
      expected_payment_date = EXCLUDED.expected_payment_date,
      description     = EXCLUDED.description,
      counterparty_id = EXCLUDED.counterparty_id,
      status = CASE
        WHEN financial_obligations.status IN ('paid','cancelled','written_off') THEN financial_obligations.status
        ELSE EXCLUDED.status
      END,
      matching_status = CASE
        WHEN financial_obligations.matching_status = 'matched' THEN 'matched'
        ELSE EXCLUDED.matching_status
      END,
      metadata = financial_obligations.metadata || EXCLUDED.metadata,
      updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_receivables FROM upsert;

  -- Driver settlements → outflow / driver_settlement_payment
  WITH src AS (
    SELECT ds.*
    FROM public.driver_settlements ds
    WHERE ds.tenant_id = _tenant_id
      AND ds.status IN ('approved','paid','closed')
      AND COALESCE(ds.driver_payable_amount, 0) > 0
      AND (_date_from IS NULL OR COALESCE(ds.approved_at::date, ds.created_at::date) >= _date_from)
      AND (_date_to   IS NULL OR COALESCE(ds.approved_at::date, ds.created_at::date) <= _date_to)
  ),
  upsert AS (
    INSERT INTO public.financial_obligations (
      tenant_id, direction, obligation_type, source_table, source_id,
      description, counterparty_type, counterparty_id,
      amount_expected, amount_matched,
      due_date, expected_payment_date, competence_date,
      status, matching_status, metadata, created_by
    )
    SELECT
      s.tenant_id, 'outflow', 'driver_settlement_payment', 'driver_settlements', s.id,
      COALESCE('Acerto ' || s.route_name, 'Acerto motorista'),
      'driver', s.driver_id,
      s.driver_payable_amount,
      COALESCE(s.total_paid_amount, 0),
      COALESCE(s.approved_at::date, s.trip_completed_at::date),
      s.approved_at::date,
      COALESCE(s.trip_completed_at::date, s.approved_at::date),
      CASE
        WHEN s.status = 'closed' AND COALESCE(s.total_paid_amount,0) >= s.driver_payable_amount THEN 'paid'
        WHEN s.status = 'paid'                                                                   THEN 'paid'
        WHEN COALESCE(s.total_paid_amount,0) >= s.driver_payable_amount                          THEN 'paid'
        WHEN COALESCE(s.total_paid_amount,0) > 0                                                 THEN 'partially_paid'
        ELSE 'pending'
      END,
      CASE
        WHEN COALESCE(s.total_paid_amount,0) >= s.driver_payable_amount THEN 'matched'
        WHEN COALESCE(s.total_paid_amount,0) > 0                        THEN 'partial'
        ELSE 'unmatched'
      END,
      jsonb_build_object(
        'dispatch_trip_id', s.dispatch_trip_id,
        'vehicle_id', s.vehicle_id,
        'settlement_status', s.status,
        'route_origin', s.route_origin,
        'route_destination', s.route_destination
      ),
      s.created_by
    FROM src s
    ON CONFLICT (tenant_id, source_table, source_id, obligation_type)
      WHERE source_table IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET
      amount_expected = EXCLUDED.amount_expected,
      amount_matched  = GREATEST(financial_obligations.amount_matched, EXCLUDED.amount_matched),
      due_date        = EXCLUDED.due_date,
      description     = EXCLUDED.description,
      counterparty_id = EXCLUDED.counterparty_id,
      status = CASE
        WHEN financial_obligations.status IN ('cancelled','written_off') THEN financial_obligations.status
        ELSE EXCLUDED.status
      END,
      matching_status = CASE
        WHEN financial_obligations.matching_status = 'matched' THEN 'matched'
        ELSE EXCLUDED.matching_status
      END,
      metadata = financial_obligations.metadata || EXCLUDED.metadata,
      updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_settlements FROM upsert;

  -- Payables → outflow / payable
  WITH src AS (
    SELECT p.*
    FROM public.payables p
    WHERE p.tenant_id = _tenant_id
      AND (_date_from IS NULL OR COALESCE(p.due_date, p.created_at::date) >= _date_from)
      AND (_date_to   IS NULL OR COALESCE(p.due_date, p.created_at::date) <= _date_to)
  ),
  upsert AS (
    INSERT INTO public.financial_obligations (
      tenant_id, direction, obligation_type, source_table, source_id,
      description, counterparty_type, counterparty_id, counterparty_name,
      amount_expected, amount_matched,
      due_date, expected_payment_date, competence_date,
      status, matching_status, metadata, created_by
    )
    SELECT
      s.tenant_id, 'outflow', 'payable', 'payables', s.id,
      COALESCE(s.description, s.supplier_name, 'Conta a pagar'),
      'supplier', s.supplier_id, s.supplier_name,
      s.amount,
      CASE WHEN s.status = 'paid' THEN s.amount ELSE 0 END,
      s.due_date, s.paid_at::date, s.competence_date,
      CASE
        WHEN s.status = 'cancelled' THEN 'cancelled'
        WHEN s.status = 'paid'      THEN 'paid'
        ELSE 'pending'
      END,
      CASE WHEN s.status = 'paid' THEN 'matched' ELSE 'unmatched' END,
      jsonb_build_object(
        'category', s.category,
        'vehicle_id', s.vehicle_id,
        'driver_id', s.driver_id,
        'dispatch_trip_id', s.dispatch_trip_id,
        'load_id', s.load_id,
        'document_number', s.document_number
      ),
      s.created_by
    FROM src s
    ON CONFLICT (tenant_id, source_table, source_id, obligation_type)
      WHERE source_table IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET
      amount_expected = EXCLUDED.amount_expected,
      amount_matched  = GREATEST(financial_obligations.amount_matched, EXCLUDED.amount_matched),
      due_date        = EXCLUDED.due_date,
      description     = EXCLUDED.description,
      counterparty_id = EXCLUDED.counterparty_id,
      counterparty_name = EXCLUDED.counterparty_name,
      status = CASE
        WHEN financial_obligations.status IN ('cancelled','written_off') THEN financial_obligations.status
        ELSE EXCLUDED.status
      END,
      matching_status = CASE
        WHEN financial_obligations.matching_status = 'matched' THEN 'matched'
        ELSE EXCLUDED.matching_status
      END,
      metadata = financial_obligations.metadata || EXCLUDED.metadata,
      updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_payables FROM upsert;

  -- Driver expenses paid by the company (not reimbursable) → outflow / driver_expense
  WITH src AS (
    SELECT e.*
    FROM public.driver_expenses e
    WHERE e.tenant_id = _tenant_id
      AND e.approval_status = 'approved'
      AND COALESCE(e.reimbursable, false) = false
      AND COALESCE(e.payment_source, 'driver') <> 'driver'
      AND (_date_from IS NULL OR e.expense_at::date >= _date_from)
      AND (_date_to   IS NULL OR e.expense_at::date <= _date_to)
  ),
  upsert AS (
    INSERT INTO public.financial_obligations (
      tenant_id, direction, obligation_type, source_table, source_id,
      description, counterparty_type, counterparty_id,
      amount_expected, amount_matched,
      due_date, expected_payment_date, competence_date,
      status, matching_status, metadata, created_by
    )
    SELECT
      s.tenant_id, 'outflow', 'driver_expense', 'driver_expenses', s.id,
      COALESCE(s.notes, s.category, 'Despesa operacional'),
      'driver', s.driver_id,
      s.amount, 0,
      s.expense_at::date, s.expense_at::date, s.expense_at::date,
      'pending','unmatched',
      jsonb_build_object(
        'category', s.category,
        'payment_source', s.payment_source,
        'dispatch_trip_id', s.dispatch_trip_id
      ),
      s.approved_by
    FROM src s
    ON CONFLICT (tenant_id, source_table, source_id, obligation_type)
      WHERE source_table IS NOT NULL AND source_id IS NOT NULL
    DO UPDATE SET
      amount_expected = EXCLUDED.amount_expected,
      description     = EXCLUDED.description,
      counterparty_id = EXCLUDED.counterparty_id,
      metadata = financial_obligations.metadata || EXCLUDED.metadata,
      updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_expenses FROM upsert;

  RETURN jsonb_build_object(
    'receivables', v_receivables,
    'driver_settlements', v_settlements,
    'payables', v_payables,
    'driver_expenses', v_expenses
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_financial_obligations(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_financial_obligations(UUID, DATE, DATE) TO authenticated, service_role;

-- ------------------------------------------------------------
-- import_bank_statement
-- Expected _rows format (jsonb array):
-- [{ "posted_at":"2026-01-15", "description":"...", "amount":-123.45,
--    "document_number":"...", "counterparty_name":"...", "external_id":"...",
--    "balance_after":100.00, "normalized_key":"...", "raw":{...} }, ...]
-- amount signal: negative = debit (outflow), positive = credit (inflow)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.import_bank_statement(
  _tenant_id UUID,
  _bank_account_id UUID,
  _file_name TEXT,
  _file_hash TEXT,
  _period_start DATE,
  _period_end DATE,
  _rows JSONB,
  _raw_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_import_id UUID;
  v_user UUID := auth.uid();
  v_inserted INT := 0;
  v_skipped  INT := 0;
  v_inflow   NUMERIC := 0;
  v_outflow  NUMERIC := 0;
  v_existing UUID;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF _bank_account_id IS NULL OR _file_hash IS NULL OR trim(_file_hash) = '' THEN
    RAISE EXCEPTION 'invalid_arguments';
  END IF;

  -- Ensure bank account belongs to tenant
  IF NOT EXISTS (
    SELECT 1 FROM public.bank_accounts
    WHERE id = _bank_account_id AND tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'bank_account_not_found';
  END IF;

  -- Reject duplicate file for same account
  SELECT id INTO v_existing
  FROM public.bank_statement_imports
  WHERE tenant_id = _tenant_id
    AND bank_account_id = _bank_account_id
    AND file_hash = _file_hash;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate_import' USING DETAIL = v_existing::text;
  END IF;

  INSERT INTO public.bank_statement_imports (
    tenant_id, bank_account_id, file_name, file_hash,
    period_start, period_end, imported_by, status, raw_metadata
  )
  VALUES (
    _tenant_id, _bank_account_id, _file_name, _file_hash,
    _period_start, _period_end, v_user, 'imported', COALESCE(_raw_metadata,'{}'::jsonb)
  )
  RETURNING id INTO v_import_id;

  WITH ins AS (
    INSERT INTO public.bank_transactions (
      tenant_id, bank_account_id, import_id,
      posted_at, description, normalized_description, amount, transaction_type,
      external_id, document_number, counterparty_name, balance_after,
      raw_payload, normalized_key, reconciliation_status
    )
    SELECT
      _tenant_id,
      _bank_account_id,
      v_import_id,
      COALESCE((r->>'posted_at')::timestamptz, now()),
      NULLIF(r->>'description',''),
      lower(regexp_replace(COALESCE(r->>'description',''), '\s+', ' ', 'g')),
      (r->>'amount')::numeric,
      CASE WHEN (r->>'amount')::numeric >= 0 THEN 'credit' ELSE 'debit' END,
      NULLIF(r->>'external_id',''),
      NULLIF(r->>'document_number',''),
      NULLIF(r->>'counterparty_name',''),
      NULLIF(r->>'balance_after','')::numeric,
      COALESCE(r->'raw', r),
      NULLIF(r->>'normalized_key',''),
      'unmatched'
    FROM jsonb_array_elements(COALESCE(_rows,'[]'::jsonb)) r
    WHERE (r->>'amount') IS NOT NULL
    ON CONFLICT (tenant_id, bank_account_id, normalized_key)
      WHERE normalized_key IS NOT NULL
    DO NOTHING
    RETURNING amount
  )
  SELECT
    COUNT(*),
    COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0),
    COALESCE(SUM(CASE WHEN amount < 0 THEN -amount ELSE 0 END),0)
  INTO v_inserted, v_inflow, v_outflow
  FROM ins;

  v_skipped := jsonb_array_length(COALESCE(_rows,'[]'::jsonb)) - v_inserted;

  UPDATE public.bank_statement_imports
     SET rows_count = v_inserted,
         total_inflow = v_inflow,
         total_outflow = v_outflow,
         updated_at = now()
   WHERE id = v_import_id;

  INSERT INTO public.bank_reconciliation_audit (
    tenant_id, action, entity_table, entity_id, payload, user_id
  )
  VALUES (
    _tenant_id, 'imported_statement', 'bank_statement_imports', v_import_id,
    jsonb_build_object(
      'bank_account_id', _bank_account_id,
      'file_name', _file_name,
      'file_hash', _file_hash,
      'rows_inserted', v_inserted,
      'rows_skipped', v_skipped,
      'total_inflow', v_inflow,
      'total_outflow', v_outflow
    ),
    v_user
  );

  RETURN jsonb_build_object(
    'import_id', v_import_id,
    'rows_inserted', v_inserted,
    'rows_skipped', v_skipped,
    'total_inflow', v_inflow,
    'total_outflow', v_outflow
  );
END;
$$;

REVOKE ALL ON FUNCTION public.import_bank_statement(UUID, UUID, TEXT, TEXT, DATE, DATE, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.import_bank_statement(UUID, UUID, TEXT, TEXT, DATE, DATE, JSONB, JSONB) TO authenticated, service_role;
