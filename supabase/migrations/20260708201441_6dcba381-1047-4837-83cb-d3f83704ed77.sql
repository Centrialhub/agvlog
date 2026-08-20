
CREATE OR REPLACE FUNCTION public.approve_payroll_period(_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $function$
DECLARE
  _tenant uuid;
  _pstart date;
  _pend date;
  _entry record;
  _user uuid := auth.uid();
BEGIN
  SELECT tenant_id, period_start, period_end INTO _tenant, _pstart, _pend
    FROM public.payroll_periods WHERE id = _period_id;
  IF _tenant IS NULL THEN RAISE EXCEPTION 'período não encontrado'; END IF;
  IF NOT public.is_tenant_operator_or_admin(_tenant) THEN RAISE EXCEPTION 'not authorized'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.payroll_entries WHERE payroll_period_id = _period_id) THEN
    RAISE EXCEPTION 'período sem entradas';
  END IF;

  INSERT INTO public.payroll_generation_issues(tenant_id, payroll_period_id, issue_type, severity,
    driver_id, source_table, source_id, message)
  SELECT _tenant, _period_id, 'settlement_paid_outside_payroll', 'warning',
    ds.driver_id, 'driver_settlements', ds.id,
    'Acerto ' || substring(ds.id::text,1,8) || ' já possui pagamentos externos fora desta folha'
  FROM public.driver_settlements ds
  WHERE ds.tenant_id = _tenant
    AND EXISTS (
      SELECT 1 FROM public.payroll_entry_items i
      WHERE i.payroll_period_id = _period_id
        AND i.source_table = 'driver_settlements' AND i.source_id = ds.id
    )
    AND EXISTS (
      SELECT 1 FROM public.driver_settlement_payments dsp
      WHERE dsp.settlement_id = ds.id AND dsp.paid_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.payroll_entry_items ii
          WHERE ii.payroll_period_id = _period_id
            AND ii.source_table = 'driver_settlement_payments' AND ii.source_id = dsp.id
        )
    );

  FOR _entry IN SELECT id FROM public.payroll_entries WHERE payroll_period_id = _period_id LOOP
    PERFORM public.recompute_payroll_entry_totals(_entry.id);
  END LOOP;
  UPDATE public.payroll_entry_items SET locked = true WHERE payroll_period_id = _period_id;
  UPDATE public.payroll_entries SET status = 'approved' WHERE payroll_period_id = _period_id AND status <> 'cancelled';

  FOR _entry IN
    SELECT e.id, e.employee_id, e.driver_id, e.amount_to_pay, emp.name AS employee_name
    FROM public.payroll_entries e
    JOIN public.employees emp ON emp.id = e.employee_id
    WHERE e.payroll_period_id = _period_id
      AND e.amount_to_pay > 0
      AND e.status <> 'cancelled'
  LOOP
    INSERT INTO public.payables(tenant_id, supplier_name, category, description, amount,
      competence_date, due_date, driver_id, status, created_by,
      source_table, source_id, source_metadata, notes)
    VALUES (_tenant, _entry.employee_name, 'payroll',
      'Folha ' || to_char(_pstart,'DD/MM/YYYY') || '–' || to_char(_pend,'DD/MM/YYYY') || ' — ' || _entry.employee_name,
      _entry.amount_to_pay, _pstart, _pend, _entry.driver_id, 'pending', _user,
      'payroll_entries', _entry.id,
      jsonb_build_object('payroll_period_id', _period_id, 'employee_id', _entry.employee_id),
      NULL)
    ON CONFLICT (tenant_id, source_table, source_id, category)
      WHERE source_table IS NOT NULL AND source_id IS NOT NULL
      DO NOTHING;
  END LOOP;

  UPDATE public.payroll_periods
     SET status = 'approved', approved_by = _user, approved_at = now(), updated_at = now()
   WHERE id = _period_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_employee_advance(
  _tenant_id uuid, _employee_id uuid, _amount numeric,
  _advance_date date DEFAULT CURRENT_DATE, _reason text DEFAULT NULL,
  _payment_method text DEFAULT NULL, _payment_reference text DEFAULT NULL,
  _create_payable boolean DEFAULT false, _mark_paid boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path TO 'public'
AS $$
DECLARE
  _advance_id uuid; _driver uuid; _employee_name text;
  _payable_id uuid; _user uuid := auth.uid();
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'valor deve ser positivo'; END IF;

  SELECT driver_id, name INTO _driver, _employee_name
    FROM public.employees WHERE id = _employee_id AND tenant_id = _tenant_id;
  IF _employee_name IS NULL THEN RAISE EXCEPTION 'funcionário não encontrado'; END IF;

  INSERT INTO public.employee_advances(tenant_id, employee_id, driver_id, amount,
    advance_date, reason, payment_method, payment_reference,
    status, approved_by, approved_at, paid_by, paid_at, created_by)
  VALUES (_tenant_id, _employee_id, _driver, _amount,
    _advance_date, _reason, _payment_method, _payment_reference,
    CASE WHEN _mark_paid THEN 'paid' WHEN _create_payable THEN 'approved' ELSE 'pending' END,
    CASE WHEN _create_payable OR _mark_paid THEN _user END,
    CASE WHEN _create_payable OR _mark_paid THEN now() END,
    CASE WHEN _mark_paid THEN _user END,
    CASE WHEN _mark_paid THEN now() END,
    _user)
  RETURNING id INTO _advance_id;

  IF _create_payable THEN
    INSERT INTO public.payables(tenant_id, supplier_name, category, description, amount,
      competence_date, due_date, driver_id, status, created_by, notes,
      source_table, source_id, source_metadata)
    VALUES (_tenant_id, _employee_name,
      CASE WHEN _driver IS NOT NULL THEN 'driver_advance' ELSE 'payroll' END,
      'Adiantamento — ' || _employee_name || COALESCE(' — '||_reason,''),
      _amount, _advance_date, _advance_date, _driver,
      CASE WHEN _mark_paid THEN 'paid' ELSE 'pending' END,
      _user,
      'employee_advance_id=' || _advance_id::text,
      'employee_advances', _advance_id,
      jsonb_build_object('employee_id', _employee_id, 'driver_id', _driver, 'advance_date', _advance_date, 'reason', _reason))
    ON CONFLICT (tenant_id, source_table, source_id, category)
      WHERE source_table IS NOT NULL AND source_id IS NOT NULL
      DO NOTHING
    RETURNING id INTO _payable_id;

    IF _payable_id IS NULL THEN
      SELECT id INTO _payable_id FROM public.payables
      WHERE tenant_id=_tenant_id AND source_table='employee_advances' AND source_id=_advance_id
      LIMIT 1;
    END IF;
    UPDATE public.employee_advances SET payable_id = _payable_id WHERE id = _advance_id;
  END IF;

  RETURN _advance_id;
END; $$;

CREATE OR REPLACE FUNCTION public.register_driver_settlement_payment(
  _settlement_id uuid, _amount numeric,
  _payment_method text DEFAULT NULL, _payment_account text DEFAULT NULL,
  _payment_reference text DEFAULT NULL, _receipt_url text DEFAULT NULL,
  _notes text DEFAULT NULL, _allow_overpayment boolean DEFAULT false,
  _overpayment_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path TO 'public'
AS $$
DECLARE
  v_s public.driver_settlements; v_id uuid; v_total numeric;
  v_balance numeric; v_is_admin boolean; v_prev_status text; v_new_status text;
  v_account text; v_in_locked_payroll boolean;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_s.status NOT IN ('approved','paid') THEN RAISE EXCEPTION 'must_be_approved'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  IF _payment_account IS NULL OR length(trim(_payment_account)) = 0 THEN
    RAISE EXCEPTION 'payment_account_required';
  END IF;
  v_account := trim(_payment_account);
  IF lower(v_account) IN ('outro', 'other') THEN
    RAISE EXCEPTION 'payment_account_description_required';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.payroll_entry_items pei
    JOIN public.payroll_entries pe ON pe.id = pei.payroll_entry_id
    JOIN public.payroll_periods pp ON pp.id = pe.payroll_period_id
    WHERE pei.source_table = 'driver_settlements'
      AND pei.source_id = _settlement_id
      AND pei.item_type <> 'driver_settlement_payment'
      AND pp.status IN ('approved','closed')
      AND EXISTS (
        SELECT 1 FROM public.payables pay
        WHERE pay.tenant_id=v_s.tenant_id
          AND pay.source_table='payroll_entries'
          AND pay.source_id=pe.id
          AND pay.status IN ('pending','paid','partial')
      )
  ) INTO v_in_locked_payroll;

  v_is_admin := EXISTS (
    SELECT 1 FROM public.tenant_memberships
     WHERE tenant_id = v_s.tenant_id AND user_id = auth.uid()
       AND active = true AND role IN ('owner','admin'));

  IF v_in_locked_payroll THEN
    IF NOT (v_is_admin AND length(trim(COALESCE(_overpayment_reason,''))) > 0) THEN
      RAISE EXCEPTION 'settlement_locked_in_payroll';
    END IF;
    INSERT INTO public.payroll_generation_issues(
      tenant_id, payroll_period_id, driver_id, employee_id,
      issue_type, severity, source_table, source_id, message
    )
    SELECT
      v_s.tenant_id, pp.id, v_s.driver_id, pe.employee_id,
      'duplicate_payment_override', 'warning',
      'driver_settlements', _settlement_id,
      'Pagamento direto do acerto autorizado por admin apesar do vínculo em folha. Valor='
        || _amount::text
        || '. Motivo=' || COALESCE(_overpayment_reason, '')
        || '. Usuário=' || COALESCE(auth.uid()::text, '')
    FROM public.payroll_entry_items pei
    JOIN public.payroll_entries pe ON pe.id = pei.payroll_entry_id
    JOIN public.payroll_periods pp ON pp.id = pe.payroll_period_id
    WHERE pei.source_table='driver_settlements' AND pei.source_id=_settlement_id
    LIMIT 1;
  END IF;

  v_prev_status := v_s.status;
  v_balance := COALESCE(v_s.driver_payable_amount,0) - COALESCE(v_s.total_paid_amount,0);
  IF _amount > v_balance THEN
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

  PERFORM public._log_settlement_event(_settlement_id, 'payment_registered', v_prev_status, v_new_status, _notes,
    jsonb_build_object(
      'payment_id', v_id, 'amount', _amount, 'payment_method', _payment_method,
      'payment_account', v_account, 'payment_reference', _payment_reference,
      'receipt_url', _receipt_url, 'notes', _notes,
      'total_paid_amount', v_total,
      'payment_balance', COALESCE(v_s.driver_payable_amount,0) - v_total,
      'overpayment', _amount > v_balance,
      'overpayment_reason', CASE WHEN _amount > v_balance OR v_in_locked_payroll THEN _overpayment_reason END,
      'in_locked_payroll', v_in_locked_payroll
    ));
  RETURN v_id;
END; $$;
