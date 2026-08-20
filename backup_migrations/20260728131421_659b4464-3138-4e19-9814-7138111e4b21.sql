
-- 1. Expandir payables e receivables
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS paid_amount NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'system';
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS bank_account_id UUID REFERENCES public.bank_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.payables DROP CONSTRAINT IF EXISTS payables_status_check;
ALTER TABLE public.payables ADD CONSTRAINT payables_status_check
  CHECK (status = ANY (ARRAY['pending','approved','partial','paid','overdue','cancelled']));

ALTER TABLE public.payables DROP CONSTRAINT IF EXISTS payables_source_check;
ALTER TABLE public.payables ADD CONSTRAINT payables_source_check
  CHECK (source = ANY (ARRAY['system','manual']));

-- 2. Baixas de contas a pagar
CREATE TABLE IF NOT EXISTS public.payables_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  payable_id UUID NOT NULL REFERENCES public.payables(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  method TEXT NOT NULL DEFAULT 'other'
    CHECK (method = ANY (ARRAY['pix','boleto','ted','doc','dinheiro','cartao','debito_automatico','other'])),
  notes TEXT,
  attachment_url TEXT,
  bank_transaction_id UUID REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payables_payments TO authenticated;
GRANT ALL ON public.payables_payments TO service_role;
ALTER TABLE public.payables_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payables_payments tenant read" ON public.payables_payments
  FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "payables_payments tenant write" ON public.payables_payments
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_payables_payments_payable ON public.payables_payments(payable_id);
CREATE INDEX IF NOT EXISTS idx_payables_payments_tenant ON public.payables_payments(tenant_id);

-- 3. Baixas de contas a receber
CREATE TABLE IF NOT EXISTS public.receivables_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  receivable_id UUID NOT NULL REFERENCES public.receivables(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bank_account_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  method TEXT NOT NULL DEFAULT 'other'
    CHECK (method = ANY (ARRAY['pix','boleto','ted','doc','dinheiro','cartao','debito_automatico','other'])),
  notes TEXT,
  attachment_url TEXT,
  bank_transaction_id UUID REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receivables_payments TO authenticated;
GRANT ALL ON public.receivables_payments TO service_role;
ALTER TABLE public.receivables_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "receivables_payments tenant read" ON public.receivables_payments
  FOR SELECT TO authenticated USING (tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE user_id = auth.uid()));
CREATE POLICY "receivables_payments tenant write" ON public.receivables_payments
  FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE user_id = auth.uid()));
CREATE INDEX IF NOT EXISTS idx_receivables_payments_receivable ON public.receivables_payments(receivable_id);
CREATE INDEX IF NOT EXISTS idx_receivables_payments_tenant ON public.receivables_payments(tenant_id);

-- 4. Triggers para recalcular status/paid_amount em payables
CREATE OR REPLACE FUNCTION public._recalc_payable_paid()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE
  v_payable_id UUID;
  v_total NUMERIC;
  v_amount NUMERIC;
  v_status TEXT;
BEGIN
  v_payable_id := COALESCE(NEW.payable_id, OLD.payable_id);
  SELECT COALESCE(SUM(amount),0) INTO v_total FROM public.payables_payments WHERE payable_id = v_payable_id;
  SELECT amount, status INTO v_amount, v_status FROM public.payables WHERE id = v_payable_id;
  IF v_status = 'cancelled' THEN
    UPDATE public.payables SET paid_amount = v_total, updated_at = now() WHERE id = v_payable_id;
    RETURN COALESCE(NEW, OLD);
  END IF;
  UPDATE public.payables SET
    paid_amount = v_total,
    status = CASE
      WHEN v_total <= 0 THEN CASE WHEN v_status IN ('paid','partial') THEN 'approved' ELSE v_status END
      WHEN v_total >= v_amount THEN 'paid'
      ELSE 'partial'
    END,
    paid_at = CASE WHEN v_total >= v_amount THEN COALESCE(paid_at, now()) ELSE NULL END,
    updated_at = now()
  WHERE id = v_payable_id;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_recalc_payable_paid ON public.payables_payments;
CREATE TRIGGER trg_recalc_payable_paid
AFTER INSERT OR DELETE OR UPDATE ON public.payables_payments
FOR EACH ROW EXECUTE FUNCTION public._recalc_payable_paid();

-- 5. Triggers para recalcular status/received_amount em receivables
CREATE OR REPLACE FUNCTION public._recalc_receivable_received()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE
  v_receivable_id UUID;
  v_total NUMERIC;
  v_amount NUMERIC;
  v_status TEXT;
BEGIN
  v_receivable_id := COALESCE(NEW.receivable_id, OLD.receivable_id);
  SELECT COALESCE(SUM(amount),0) INTO v_total FROM public.receivables_payments WHERE receivable_id = v_receivable_id;
  SELECT amount, status INTO v_amount, v_status FROM public.receivables WHERE id = v_receivable_id;
  IF v_status = 'cancelled' THEN
    UPDATE public.receivables SET received_amount = v_total, updated_at = now() WHERE id = v_receivable_id;
    RETURN COALESCE(NEW, OLD);
  END IF;
  UPDATE public.receivables SET
    received_amount = v_total,
    status = CASE
      WHEN v_total <= 0 THEN CASE WHEN v_status IN ('received','partial') THEN 'pending' ELSE v_status END
      WHEN v_total >= v_amount THEN 'received'
      ELSE 'partial'
    END,
    received_at = CASE WHEN v_total >= v_amount THEN COALESCE(received_at, now()) ELSE NULL END,
    updated_at = now()
  WHERE id = v_receivable_id;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_recalc_receivable_received ON public.receivables_payments;
CREATE TRIGGER trg_recalc_receivable_received
AFTER INSERT OR DELETE OR UPDATE ON public.receivables_payments
FOR EACH ROW EXECUTE FUNCTION public._recalc_receivable_received();

-- 6. RPCs — restritas a admin/owner/operator
CREATE OR REPLACE FUNCTION public.register_payable_payment(
  _payable_id UUID,
  _amount NUMERIC,
  _paid_at TIMESTAMPTZ,
  _bank_account_id UUID,
  _method TEXT DEFAULT 'other',
  _notes TEXT DEFAULT NULL,
  _attachment_url TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE
  v_payable public.payables%ROWTYPE;
  v_remaining NUMERIC;
  v_tx_id UUID;
  v_payment_id UUID;
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT * INTO v_payable FROM public.payables WHERE id = _payable_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta não encontrada'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.user_id = v_uid AND tm.tenant_id = v_payable.tenant_id AND tm.role IN ('owner','admin','operator')) THEN
    RAISE EXCEPTION 'Sem permissão para dar baixa em contas a pagar';
  END IF;
  IF v_payable.status = 'cancelled' THEN RAISE EXCEPTION 'Conta cancelada'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Valor inválido'; END IF;
  v_remaining := v_payable.amount - COALESCE(v_payable.paid_amount,0);
  IF _amount > v_remaining + 0.01 THEN
    RAISE EXCEPTION 'Valor % maior que o saldo devedor %', _amount, v_remaining;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bank_accounts WHERE id = _bank_account_id AND tenant_id = v_payable.tenant_id) THEN
    RAISE EXCEPTION 'Conta bancária inválida';
  END IF;

  INSERT INTO public.bank_transactions (
    tenant_id, bank_account_id, posted_at, description, amount, transaction_type,
    document_number, counterparty_name, reconciliation_status, raw_payload
  ) VALUES (
    v_payable.tenant_id, _bank_account_id, _paid_at,
    'Baixa: ' || COALESCE(v_payable.description, v_payable.supplier_name),
    _amount, 'debit',
    v_payable.document_number, v_payable.supplier_name, 'matched',
    jsonb_build_object('source','payable_payment','payable_id', _payable_id)
  ) RETURNING id INTO v_tx_id;

  INSERT INTO public.payables_payments (
    tenant_id, payable_id, amount, paid_at, bank_account_id, method, notes, attachment_url,
    bank_transaction_id, created_by
  ) VALUES (
    v_payable.tenant_id, _payable_id, _amount, _paid_at, _bank_account_id, _method, _notes, _attachment_url,
    v_tx_id, v_uid
  ) RETURNING id INTO v_payment_id;

  RETURN v_payment_id;
END $$;
GRANT EXECUTE ON FUNCTION public.register_payable_payment(UUID, NUMERIC, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.reverse_payable_payment(_payment_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE
  v_payment public.payables_payments%ROWTYPE;
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT * INTO v_payment FROM public.payables_payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Baixa não encontrada'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.user_id = v_uid AND tm.tenant_id = v_payment.tenant_id AND tm.role IN ('owner','admin','operator')) THEN
    RAISE EXCEPTION 'Sem permissão para estornar';
  END IF;
  DELETE FROM public.payables_payments WHERE id = _payment_id;
  IF v_payment.bank_transaction_id IS NOT NULL THEN
    DELETE FROM public.bank_transactions WHERE id = v_payment.bank_transaction_id;
  END IF;
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION public.reverse_payable_payment(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.register_receivable_payment(
  _receivable_id UUID,
  _amount NUMERIC,
  _received_at TIMESTAMPTZ,
  _bank_account_id UUID,
  _method TEXT DEFAULT 'other',
  _notes TEXT DEFAULT NULL,
  _attachment_url TEXT DEFAULT NULL
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE
  v_rcv public.receivables%ROWTYPE;
  v_remaining NUMERIC;
  v_tx_id UUID;
  v_payment_id UUID;
  v_uid UUID := auth.uid();
  v_desc TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT * INTO v_rcv FROM public.receivables WHERE id = _receivable_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Título não encontrado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.user_id = v_uid AND tm.tenant_id = v_rcv.tenant_id AND tm.role IN ('owner','admin','operator')) THEN
    RAISE EXCEPTION 'Sem permissão para dar baixa em recebíveis';
  END IF;
  IF v_rcv.status = 'cancelled' THEN RAISE EXCEPTION 'Título cancelado'; END IF;
  IF _amount <= 0 THEN RAISE EXCEPTION 'Valor inválido'; END IF;
  v_remaining := v_rcv.amount - COALESCE(v_rcv.received_amount,0);
  IF _amount > v_remaining + 0.01 THEN
    RAISE EXCEPTION 'Valor % maior que o saldo em aberto %', _amount, v_remaining;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.bank_accounts WHERE id = _bank_account_id AND tenant_id = v_rcv.tenant_id) THEN
    RAISE EXCEPTION 'Conta bancária inválida';
  END IF;
  v_desc := 'Recebimento: ' || COALESCE(v_rcv.description, v_rcv.invoice_number, 'Título ' || v_rcv.id::text);

  INSERT INTO public.bank_transactions (
    tenant_id, bank_account_id, posted_at, description, amount, transaction_type,
    document_number, reconciliation_status, raw_payload
  ) VALUES (
    v_rcv.tenant_id, _bank_account_id, _received_at,
    v_desc, _amount, 'credit',
    v_rcv.invoice_number, 'matched',
    jsonb_build_object('source','receivable_payment','receivable_id', _receivable_id)
  ) RETURNING id INTO v_tx_id;

  INSERT INTO public.receivables_payments (
    tenant_id, receivable_id, amount, received_at, bank_account_id, method, notes, attachment_url,
    bank_transaction_id, created_by
  ) VALUES (
    v_rcv.tenant_id, _receivable_id, _amount, _received_at, _bank_account_id, _method, _notes, _attachment_url,
    v_tx_id, v_uid
  ) RETURNING id INTO v_payment_id;

  RETURN v_payment_id;
END $$;
GRANT EXECUTE ON FUNCTION public.register_receivable_payment(UUID, NUMERIC, TIMESTAMPTZ, UUID, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.reverse_receivable_payment(_payment_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE
  v_payment public.receivables_payments%ROWTYPE;
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  SELECT * INTO v_payment FROM public.receivables_payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Baixa não encontrada'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.user_id = v_uid AND tm.tenant_id = v_payment.tenant_id AND tm.role IN ('owner','admin','operator')) THEN
    RAISE EXCEPTION 'Sem permissão para estornar';
  END IF;
  DELETE FROM public.receivables_payments WHERE id = _payment_id;
  IF v_payment.bank_transaction_id IS NOT NULL THEN
    DELETE FROM public.bank_transactions WHERE id = v_payment.bank_transaction_id;
  END IF;
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION public.reverse_receivable_payment(UUID) TO authenticated;

-- 7. Despesa avulsa (payable manual) + opção de já pagar
CREATE OR REPLACE FUNCTION public.create_manual_expense(_payload JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE
  v_tenant UUID;
  v_payable_id UUID;
  v_uid UUID := auth.uid();
  v_pay_now BOOLEAN := COALESCE((_payload->>'pay_now')::boolean, false);
  v_amount NUMERIC := (_payload->>'amount')::numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Não autenticado'; END IF;
  v_tenant := (_payload->>'tenant_id')::uuid;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'tenant_id obrigatório'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenant_memberships tm WHERE tm.user_id = v_uid AND tm.tenant_id = v_tenant AND tm.role IN ('owner','admin','operator')) THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'Valor inválido'; END IF;

  INSERT INTO public.payables (
    tenant_id, supplier_name, supplier_id, category, description, amount,
    due_date, competence_date, document_number, notes, status, source,
    bank_account_id, created_by
  ) VALUES (
    v_tenant,
    COALESCE(_payload->>'supplier_name','Despesa avulsa'),
    NULLIF(_payload->>'supplier_id','')::uuid,
    COALESCE(_payload->>'category','other'),
    _payload->>'description',
    v_amount,
    NULLIF(_payload->>'due_date','')::date,
    NULLIF(_payload->>'competence_date','')::date,
    _payload->>'document_number',
    _payload->>'notes',
    CASE WHEN v_pay_now THEN 'approved' ELSE COALESCE(_payload->>'status','pending') END,
    'manual',
    NULLIF(_payload->>'bank_account_id','')::uuid,
    v_uid
  ) RETURNING id INTO v_payable_id;

  IF v_pay_now THEN
    PERFORM public.register_payable_payment(
      v_payable_id,
      v_amount,
      COALESCE(NULLIF(_payload->>'paid_at','')::timestamptz, now()),
      NULLIF(_payload->>'bank_account_id','')::uuid,
      COALESCE(_payload->>'method','other'),
      _payload->>'payment_notes',
      _payload->>'attachment_url'
    );
  END IF;
  RETURN v_payable_id;
END $$;
GRANT EXECUTE ON FUNCTION public.create_manual_expense(JSONB) TO authenticated;

-- 8. Backfill paid_amount para pagas antigas
UPDATE public.payables SET paid_amount = amount WHERE status = 'paid' AND paid_amount = 0;
