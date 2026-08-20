
-- Function to register a manual driver settlement payment and optionally link it to a bank account (reconciliation)
CREATE OR REPLACE FUNCTION public.register_driver_settlement_payment_v2(
  _settlement_id uuid,
  _amount numeric,
  _payment_method text DEFAULT 'pix',
  _payment_account text DEFAULT NULL,
  _payment_reference text DEFAULT NULL,
  _receipt_url text DEFAULT NULL,
  _notes text DEFAULT NULL,
  _allow_overpayment boolean DEFAULT false,
  _overpayment_reason text DEFAULT NULL,
  _bank_account_id uuid DEFAULT NULL, -- Optional: link to a bank account for reconciliation
  _cost_center text DEFAULT 'Operacional'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path TO 'public'
AS $$
DECLARE
  v_s public.driver_settlements;
  v_payment_id uuid;
  v_total numeric;
  v_balance numeric;
  v_is_admin boolean;
  v_prev_status text;
  v_new_status text;
  v_account_desc text;
  v_in_locked_payroll boolean;
  v_bank_transaction_id uuid;
  v_driver_name text;
BEGIN
  -- 1. Fetch settlement and lock for update
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  
  -- 2. Basic authorization
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  
  -- 3. Validation
  IF v_s.status NOT IN ('approved','paid') THEN RAISE EXCEPTION 'must_be_approved'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  IF _payment_account IS NULL OR length(trim(_payment_account)) = 0 THEN
    RAISE EXCEPTION 'payment_account_required';
  END IF;
  
  v_account_desc := trim(_payment_account);
  IF lower(v_account_desc) IN ('outro', 'other') THEN
    RAISE EXCEPTION 'payment_account_description_required';
  END IF;

  -- 4. Check Payroll Lock (Same logic as v1)
  SELECT EXISTS (
    SELECT 1
    FROM public.payroll_entry_items pei
    JOIN public.payroll_entries pe ON pe.id = pei.payroll_entry_id
    JOIN public.payroll_periods pp ON pp.id = pe.payroll_period_id
    WHERE pei.source_table = 'driver_settlements'
      AND pei.source_id = _settlement_id
      AND pei.item_type <> 'driver_settlement_payment'
      AND pp.status IN ('approved','closed')
  ) INTO v_in_locked_payroll;

  v_is_admin := EXISTS (
    SELECT 1 FROM public.tenant_memberships
     WHERE tenant_id = v_s.tenant_id AND user_id = auth.uid()
       AND active = true AND role IN ('owner','admin'));

  IF v_in_locked_payroll THEN
    IF NOT (v_is_admin AND length(trim(COALESCE(_overpayment_reason,''))) > 0) THEN
      RAISE EXCEPTION 'settlement_locked_in_payroll';
    END IF;
  END IF;

  -- 5. Overpayment check
  v_prev_status := v_s.status;
  v_balance := COALESCE(v_s.driver_payable_amount,0) - COALESCE(v_s.total_paid_amount,0);
  IF _amount > v_balance THEN
    IF NOT (_allow_overpayment AND v_is_admin AND length(trim(COALESCE(_overpayment_reason,''))) > 0) THEN
      RAISE EXCEPTION 'overpayment_blocked';
    END IF;
  END IF;

  -- 6. Insert Payment Record
  INSERT INTO public.driver_settlement_payments(
    tenant_id, settlement_id, amount, payment_method, 
    payment_account, payment_reference, receipt_url, notes, paid_by
  )
  VALUES (
    v_s.tenant_id, _settlement_id, _amount, _payment_method, 
    v_account_desc, _payment_reference, _receipt_url, _notes, auth.uid()
  )
  RETURNING id INTO v_payment_id;

  -- 7. If bank account provided, create a bank transaction (reconciliation)
  IF _bank_account_id IS NOT NULL THEN
    SELECT name INTO v_driver_name FROM public.drivers WHERE id = v_s.driver_id;
    
    INSERT INTO public.bank_transactions (
      tenant_id,
      bank_account_id,
      type,
      amount,
      description,
      transaction_date,
      status,
      category,
      cost_center,
      source_table,
      source_id
    ) VALUES (
      v_s.tenant_id,
      _bank_account_id,
      'expense',
      _amount,
      'Pagamento Acerto: ' || COALESCE(v_driver_name, 'Motorista') || ' - ' || COALESCE(v_s.route_name, 'Viagem'),
      now(),
      'completed',
      'Acerto Motorista',
      _cost_center,
      'driver_settlement_payments',
      v_payment_id
    ) RETURNING id INTO v_bank_transaction_id;
    
    -- Update payment with transaction link if column exists or in metadata/notes
    -- For now, we rely on the bank_transactions table link.
  END IF;

  -- 8. Update Settlement Totals
  SELECT COALESCE(sum(amount),0) INTO v_total FROM public.driver_settlement_payments WHERE settlement_id = _settlement_id;

  UPDATE public.driver_settlements SET
    total_paid_amount = v_total,
    payment_balance = COALESCE(driver_payable_amount,0) - v_total,
    status = CASE WHEN v_total >= COALESCE(driver_payable_amount,0) THEN 'paid' ELSE status END,
    paid_by = CASE WHEN v_total >= COALESCE(driver_payable_amount,0) THEN auth.uid() ELSE paid_by END,
    paid_at = CASE WHEN v_total >= COALESCE(driver_payable_amount,0) THEN now() ELSE paid_at END
  WHERE id = _settlement_id;

  SELECT status INTO v_new_status FROM public.driver_settlements WHERE id = _settlement_id;

  -- 9. Audit Event
  PERFORM public._log_settlement_event(_settlement_id, 'payment_registered', v_prev_status, v_new_status, _notes,
    jsonb_build_object(
      'payment_id', v_payment_id, 'amount', _amount, 'payment_method', _payment_method,
      'payment_account', v_account_desc, 'payment_reference', _payment_reference,
      'receipt_url', _receipt_url, 'notes', _notes,
      'bank_transaction_id', v_bank_transaction_id,
      'total_paid_amount', v_total,
      'payment_balance', COALESCE(v_s.driver_payable_amount,0) - v_total,
      'in_locked_payroll', v_in_locked_payroll
    ));

  RETURN v_payment_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.register_driver_settlement_payment_v2(uuid, numeric, text, text, text, text, text, boolean, text, uuid, text) TO authenticated;
