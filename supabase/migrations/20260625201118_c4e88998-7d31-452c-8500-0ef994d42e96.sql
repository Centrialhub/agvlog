CREATE OR REPLACE FUNCTION public.register_driver_settlement_payment(
  _settlement_id uuid, _amount numeric, _payment_method text DEFAULT NULL,
  _payment_account text DEFAULT NULL, _payment_reference text DEFAULT NULL,
  _receipt_url text DEFAULT NULL, _notes text DEFAULT NULL,
  _allow_overpayment boolean DEFAULT false, _overpayment_reason text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_s public.driver_settlements; v_id uuid; v_total numeric;
  v_balance numeric; v_is_admin boolean; v_prev_status text; v_new_status text;
  v_account text;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_s.status NOT IN ('approved','paid') THEN RAISE EXCEPTION 'must_be_approved'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  -- Validação defensiva: conta/origem obrigatória e não pode ser genérica
  IF _payment_account IS NULL OR length(trim(_payment_account)) = 0 THEN
    RAISE EXCEPTION 'payment_account_required';
  END IF;
  v_account := trim(_payment_account);
  IF lower(v_account) IN ('outro', 'other') THEN
    RAISE EXCEPTION 'payment_account_description_required';
  END IF;

  v_prev_status := v_s.status;
  v_balance := COALESCE(v_s.driver_payable_amount,0) - COALESCE(v_s.total_paid_amount,0);
  IF _amount > v_balance THEN
    v_is_admin := EXISTS (
      SELECT 1 FROM public.tenant_memberships
       WHERE tenant_id = v_s.tenant_id AND user_id = auth.uid()
         AND active = true AND role IN ('owner','admin')
    );
    IF NOT (_allow_overpayment AND v_is_admin AND length(trim(COALESCE(_overpayment_reason,''))) > 0) THEN
      RAISE EXCEPTION 'overpayment_blocked';
    END IF;
  END IF;

  INSERT INTO public.driver_settlement_payments(tenant_id, settlement_id, amount, payment_method, payment_account, payment_reference, receipt_url, notes, paid_by)
  VALUES (v_s.tenant_id, _settlement_id, _amount, _payment_method, v_account, _payment_reference, _receipt_url, _notes, auth.uid())
  RETURNING id INTO v_id;

  SELECT COALESCE(sum(amount),0) INTO v_total FROM public.driver_settlement_payments WHERE settlement_id = _settlement_id;

  UPDATE public.driver_settlements SET
    total_paid_amount = v_total,
    payment_balance = COALESCE(driver_payable_amount,0) - v_total,
    status = CASE WHEN v_total >= COALESCE(driver_payable_amount,0) THEN 'paid' ELSE status END,
    paid_by = CASE WHEN v_total >= COALESCE(driver_payable_amount,0) THEN auth.uid() ELSE paid_by END,
    paid_at = CASE WHEN v_total >= COALESCE(driver_payable_amount,0) THEN now() ELSE paid_at END
  WHERE id = _settlement_id;

  SELECT status INTO v_new_status FROM public.driver_settlements WHERE id = _settlement_id;

  PERFORM public._log_settlement_event(_settlement_id, 'payment_registered', v_prev_status,
    v_new_status, _notes,
    jsonb_build_object(
      'payment_id', v_id,
      'amount', _amount,
      'payment_method', _payment_method,
      'payment_account', v_account,
      'payment_reference', _payment_reference,
      'receipt_url', _receipt_url,
      'notes', _notes,
      'total_paid_amount', v_total,
      'payment_balance', COALESCE(v_s.driver_payable_amount,0) - v_total,
      'overpayment', _amount > v_balance,
      'overpayment_reason', CASE WHEN _amount > v_balance THEN _overpayment_reason ELSE NULL END
    ));
  RETURN v_id;
END; $$;