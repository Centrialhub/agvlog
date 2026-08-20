
-- 1) driver_expenses: additional traceability columns
ALTER TABLE public.driver_expenses
  ADD COLUMN IF NOT EXISTS supplier_name    text,
  ADD COLUMN IF NOT EXISTS document_number  text,
  ADD COLUMN IF NOT EXISTS city             text,
  ADD COLUMN IF NOT EXISTS state            text,
  ADD COLUMN IF NOT EXISTS odometer         numeric,
  ADD COLUMN IF NOT EXISTS no_receipt        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_receipt_reason text,
  ADD COLUMN IF NOT EXISTS paid_with_advance boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_driver_expenses_tenant_expense_at
  ON public.driver_expenses(tenant_id, expense_at DESC);
CREATE INDEX IF NOT EXISTS idx_driver_expenses_payment_source
  ON public.driver_expenses(tenant_id, payment_source);

-- 2) driver_create_expense: extended signature
DROP FUNCTION IF EXISTS public.driver_create_expense(uuid,text,numeric,text,text,timestamptz);
CREATE OR REPLACE FUNCTION public.driver_create_expense(
  _trip_id uuid,
  _category text,
  _amount numeric,
  _notes text DEFAULT NULL,
  _receipt_path text DEFAULT NULL,
  _expense_at timestamptz DEFAULT now(),
  _supplier_name text DEFAULT NULL,
  _document_number text DEFAULT NULL,
  _city text DEFAULT NULL,
  _state text DEFAULT NULL,
  _odometer numeric DEFAULT NULL,
  _no_receipt boolean DEFAULT false,
  _no_receipt_reason text DEFAULT NULL,
  _paid_with_advance boolean DEFAULT false,
  _payment_source text DEFAULT 'driver',
  _reimbursable boolean DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE
  v_tenant uuid; v_driver uuid; v_id uuid;
  v_reimbursable boolean;
  v_payment_source text;
BEGIN
  SELECT driver_id, tenant_id INTO v_driver, v_tenant FROM public._assert_driver_owns_trip(_trip_id);

  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'amount_invalid'; END IF;
  IF _category IS NULL OR length(_category) = 0 THEN RAISE EXCEPTION 'category_required'; END IF;

  IF COALESCE(_no_receipt, false) = true
     AND length(trim(COALESCE(_no_receipt_reason,''))) = 0 THEN
    RAISE EXCEPTION 'no_receipt_reason_required';
  END IF;

  v_payment_source := COALESCE(NULLIF(trim(_payment_source), ''), 'driver');
  IF v_payment_source NOT IN ('driver','company_card','company_account','advance','other') THEN
    RAISE EXCEPTION 'invalid_payment_source';
  END IF;

  IF _reimbursable IS NULL THEN
    v_reimbursable := CASE
      WHEN v_payment_source IN ('driver','advance') THEN true
      WHEN v_payment_source IN ('company_card','company_account') THEN false
      ELSE true
    END;
  ELSE
    v_reimbursable := _reimbursable;
  END IF;

  INSERT INTO public.driver_expenses(
    tenant_id, dispatch_trip_id, driver_id, category, amount,
    expense_at, receipt_url, notes, approval_status,
    supplier_name, document_number, city, state, odometer,
    no_receipt, no_receipt_reason, paid_with_advance,
    payment_source, reimbursable
  ) VALUES (
    v_tenant, _trip_id, v_driver, _category, _amount,
    COALESCE(_expense_at, now()), _receipt_path, _notes, 'pending',
    _supplier_name, _document_number, _city, _state, _odometer,
    COALESCE(_no_receipt, false), _no_receipt_reason, COALESCE(_paid_with_advance, false),
    v_payment_source, v_reimbursable
  ) RETURNING id INTO v_id;

  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.driver_create_expense(
  uuid,text,numeric,text,text,timestamptz,text,text,text,text,numeric,boolean,text,boolean,text,boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_create_expense(
  uuid,text,numeric,text,text,timestamptz,text,text,text,text,numeric,boolean,text,boolean,text,boolean
) TO authenticated;

-- 3) Sync triggers: settlements → obligations
CREATE OR REPLACE FUNCTION public._tg_sync_obligations_from_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE v_from date; v_to date;
BEGIN
  IF NEW.status IN ('approved','paid','closed')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status
          OR OLD.driver_payable_amount IS DISTINCT FROM NEW.driver_payable_amount) THEN
    v_from := COALESCE(NEW.trip_started_at::date, (now() - INTERVAL '60 days')::date);
    v_to   := (COALESCE(NEW.trip_completed_at::date, now()::date) + INTERVAL '1 day')::date;
    PERFORM public.sync_financial_obligations(NEW.tenant_id, v_from, v_to);
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._tg_sync_obligations_from_settlement() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sync_obligations_from_settlement ON public.driver_settlements;
CREATE TRIGGER trg_sync_obligations_from_settlement
  AFTER INSERT OR UPDATE OF status, driver_payable_amount
  ON public.driver_settlements
  FOR EACH ROW EXECUTE FUNCTION public._tg_sync_obligations_from_settlement();

CREATE OR REPLACE FUNCTION public._tg_sync_obligations_from_settlement_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE v_s public.driver_settlements; v_from date; v_to date;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = NEW.settlement_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  v_from := COALESCE(v_s.trip_started_at::date, (now() - INTERVAL '60 days')::date);
  v_to   := (COALESCE(v_s.trip_completed_at::date, now()::date) + INTERVAL '1 day')::date;
  PERFORM public.sync_financial_obligations(v_s.tenant_id, v_from, v_to);
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._tg_sync_obligations_from_settlement_payment() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sync_obligations_from_settlement_payment ON public.driver_settlement_payments;
CREATE TRIGGER trg_sync_obligations_from_settlement_payment
  AFTER INSERT ON public.driver_settlement_payments
  FOR EACH ROW EXECUTE FUNCTION public._tg_sync_obligations_from_settlement_payment();

-- 4) Trigger on driver_expenses approval → refresh company-paid obligations
CREATE OR REPLACE FUNCTION public._tg_sync_obligations_from_expense()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE v_from date; v_to date;
BEGIN
  IF NEW.approval_status = 'approved'
     AND COALESCE(NEW.reimbursable, false) = false
     AND COALESCE(NEW.payment_source,'driver') <> 'driver' THEN
    v_from := (NEW.expense_at::date - INTERVAL '1 day')::date;
    v_to   := (NEW.expense_at::date + INTERVAL '1 day')::date;
    PERFORM public.sync_financial_obligations(NEW.tenant_id, v_from, v_to);
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public._tg_sync_obligations_from_expense() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_sync_obligations_from_expense ON public.driver_expenses;
CREATE TRIGGER trg_sync_obligations_from_expense
  AFTER INSERT OR UPDATE OF approval_status, amount, reimbursable, payment_source
  ON public.driver_expenses
  FOR EACH ROW EXECUTE FUNCTION public._tg_sync_obligations_from_expense();

COMMENT ON COLUMN public.driver_expenses.payment_source IS
  'driver | company_card | company_account | advance | other';
COMMENT ON COLUMN public.driver_expenses.paid_with_advance IS
  'Marca despesa como coberta por adiantamento (reduz payable no acerto).';
