-- 1) list_driver_settlements: remove TEMP TABLE / DDL (incompatível com STABLE)
CREATE OR REPLACE FUNCTION public.list_driver_settlements(
  _tenant_id uuid,
  _search text DEFAULT NULL,
  _driver_id uuid DEFAULT NULL,
  _vehicle_id uuid DEFAULT NULL,
  _status text DEFAULT NULL,
  _date_from date DEFAULT NULL,
  _date_to date DEFAULT NULL,
  _only_km_pending boolean DEFAULT false,
  _only_expense_pending boolean DEFAULT false,
  _only_no_freight boolean DEFAULT false,
  _only_needs_recalculation boolean DEFAULT false,
  _page integer DEFAULT 1,
  _page_size integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_offset int;
  v_q text;
  v_total int;
  v_items jsonb;
  v_summary jsonb;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_offset := GREATEST(0, (COALESCE(_page,1)-1) * COALESCE(_page_size,50));
  v_q := NULLIF(trim(COALESCE(_search,'')), '');

  WITH base AS (
    SELECT s.*, d.name AS driver_name, v.plate AS vehicle_plate
      FROM public.driver_settlements s
      LEFT JOIN public.drivers d ON d.id = s.driver_id
      LEFT JOIN public.vehicles v ON v.id = s.vehicle_id
     WHERE s.tenant_id = _tenant_id
       AND (_status IS NULL OR s.status = _status)
       AND (_driver_id IS NULL OR s.driver_id = _driver_id)
       AND (_vehicle_id IS NULL OR s.vehicle_id = _vehicle_id)
       AND (_date_from IS NULL OR s.trip_completed_at >= _date_from)
       AND (_date_to IS NULL OR s.trip_completed_at < (_date_to + INTERVAL '1 day'))
       AND (NOT _only_km_pending OR s.km_review_status = 'pending')
       AND (NOT _only_expense_pending OR COALESCE(s.pending_expenses_total,0) > 0)
       AND (NOT _only_no_freight OR COALESCE(s.total_freight_value,0) = 0)
       AND (NOT _only_needs_recalculation OR s.needs_recalculation = true)
       AND (
         v_q IS NULL OR
         s.driver_id IN (SELECT id FROM public.drivers WHERE tenant_id=_tenant_id AND name ILIKE '%'||v_q||'%') OR
         s.vehicle_id IN (SELECT id FROM public.vehicles WHERE tenant_id=_tenant_id AND plate ILIKE '%'||v_q||'%') OR
         s.route_name ILIKE '%'||v_q||'%' OR
         s.route_origin ILIKE '%'||v_q||'%' OR
         s.route_destination ILIKE '%'||v_q||'%' OR
         EXISTS (
           SELECT 1 FROM public.driver_settlement_items i
            WHERE i.settlement_id = s.id AND (i.description ILIKE '%'||v_q||'%')
         )
       )
  ),
  totals AS (
    SELECT
      count(*)::int AS total_count,
      count(*) FILTER (WHERE status='pending_review')::int AS pending_count,
      count(*) FILTER (WHERE status='in_review')::int AS in_review_count,
      count(*) FILTER (WHERE status='approved')::int AS approved_count,
      count(*) FILTER (WHERE status IN ('paid','closed'))::int AS paid_closed_count,
      count(*) FILTER (WHERE needs_recalculation = true)::int AS needs_recalculation_count,
      count(*) FILTER (WHERE km_review_status='pending')::int AS km_pending_count,
      count(*) FILTER (WHERE COALESCE(pending_expenses_total,0) > 0)::int AS expense_pending_count,
      COALESCE(sum(driver_payable_amount),0) AS total_payable,
      COALESCE(sum(total_paid_amount),0) AS total_paid,
      COALESCE(sum(payment_balance),0) AS payment_balance,
      COALESCE(sum(route_result),0) AS route_result_total,
      COALESCE(sum(approved_expenses_total),0) AS approved_expenses_total
    FROM base
  ),
  paged AS (
    SELECT * FROM base
    ORDER BY trip_completed_at DESC NULLS LAST, created_at DESC
    LIMIT _page_size OFFSET v_offset
  )
  SELECT
    (SELECT total_count FROM totals),
    COALESCE((SELECT jsonb_agg(to_jsonb(paged)) FROM paged), '[]'::jsonb),
    (SELECT to_jsonb(totals) FROM totals)
  INTO v_total, v_items, v_summary;

  RETURN jsonb_build_object(
    'items', v_items,
    'total_count', COALESCE(v_total,0),
    'page', _page,
    'page_size', _page_size,
    'summary', COALESCE(v_summary, '{}'::jsonb)
  );
END; $$;

-- 2) update_driver_settlement_status: bloquear transição manual para 'paid'
CREATE OR REPLACE FUNCTION public.update_driver_settlement_status(
  _settlement_id uuid, _new_status text, _reason text DEFAULT NULL, _allow_exceptions boolean DEFAULT false
) RETURNS public.driver_settlements
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_s public.driver_settlements;
  v_prev_status text;
  v_allowed boolean := false;
  v_blocks text[] := ARRAY[]::text[];
  v_is_admin boolean;
BEGIN
  -- 'paid' só pode ser definido por register_driver_settlement_payment
  IF _new_status = 'paid' THEN
    RAISE EXCEPTION 'paid_status_requires_payment_registration';
  END IF;

  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_prev_status := v_s.status;
  v_is_admin := public.is_tenant_admin(v_s.tenant_id);

  v_allowed := CASE
    WHEN v_s.status = 'pending_review' AND _new_status IN ('in_review') THEN true
    WHEN v_s.status = 'in_review' AND _new_status IN ('approved','pending_review') THEN true
    WHEN v_s.status = 'approved' AND _new_status IN ('closed') THEN v_is_admin
    WHEN v_s.status = 'paid' AND _new_status IN ('closed','reopened') THEN v_is_admin OR _new_status='closed'
    WHEN v_s.status = 'closed' AND _new_status = 'reopened' THEN v_is_admin
    WHEN v_s.status = 'reopened' AND _new_status IN ('in_review','approved') THEN true
    ELSE false
  END;
  IF NOT v_allowed THEN RAISE EXCEPTION 'invalid_transition'; END IF;

  IF _new_status = 'approved' THEN
    IF v_s.needs_recalculation THEN v_blocks := array_append(v_blocks,'needs_recalculation'); END IF;
    IF v_s.loads_count = 0 THEN v_blocks := array_append(v_blocks,'no_loads'); END IF;
    IF v_s.documents_count = 0 THEN v_blocks := array_append(v_blocks,'no_documents'); END IF;
    IF v_s.km_review_status NOT IN ('reviewed','disputed') THEN v_blocks := array_append(v_blocks,'km_not_reviewed'); END IF;
    IF v_s.km_review_status = 'disputed' AND COALESCE(v_s.km_review_notes,'')='' THEN v_blocks := array_append(v_blocks,'km_dispute_needs_notes'); END IF;
    IF v_s.audited_km IS NULL THEN v_blocks := array_append(v_blocks,'audited_km_missing'); END IF;
    IF COALESCE(v_s.pending_expenses_total,0) > 0 THEN v_blocks := array_append(v_blocks,'pending_expenses'); END IF;
    IF COALESCE(v_s.total_freight_value,0) = 0 THEN v_blocks := array_append(v_blocks,'no_freight'); END IF;

    IF array_length(v_blocks,1) > 0 THEN
      IF NOT _allow_exceptions OR NOT v_is_admin OR COALESCE(_reason,'')='' THEN
        RAISE EXCEPTION 'approval_blocked: %', array_to_string(v_blocks, ',');
      END IF;
    END IF;
  END IF;

  UPDATE public.driver_settlements SET
    status = _new_status,
    reviewed_by = CASE WHEN _new_status='in_review' THEN v_user ELSE reviewed_by END,
    reviewed_at = CASE WHEN _new_status='in_review' THEN now() ELSE reviewed_at END,
    approved_by = CASE WHEN _new_status='approved' THEN v_user ELSE approved_by END,
    approved_at = CASE WHEN _new_status='approved' THEN now() ELSE approved_at END,
    closed_by = CASE WHEN _new_status='closed' THEN v_user ELSE closed_by END,
    closed_at = CASE WHEN _new_status='closed' THEN now() ELSE closed_at END,
    approved_with_exception = CASE WHEN _new_status='approved' AND array_length(v_blocks,1) > 0 THEN true ELSE approved_with_exception END,
    exception_reason = CASE WHEN _new_status='approved' AND array_length(v_blocks,1) > 0 THEN _reason ELSE exception_reason END
  WHERE id = _settlement_id RETURNING * INTO v_s;

  PERFORM public._log_settlement_event(
    _settlement_id,
    CASE WHEN _new_status='approved' AND array_length(v_blocks,1) > 0 THEN 'approved_with_exception' ELSE 'status_changed' END,
    v_prev_status, _new_status, _reason,
    jsonb_build_object('blocks', to_jsonb(v_blocks), 'allow_exceptions', _allow_exceptions)
  );

  RETURN v_s;
END; $$;

-- 3) register_driver_settlement_payment: SELECT ... FOR UPDATE para evitar concorrência
CREATE OR REPLACE FUNCTION public.register_driver_settlement_payment(
  _settlement_id uuid, _amount numeric, _payment_method text DEFAULT NULL,
  _payment_account text DEFAULT NULL, _payment_reference text DEFAULT NULL,
  _receipt_url text DEFAULT NULL, _notes text DEFAULT NULL,
  _allow_overpayment boolean DEFAULT false, _overpayment_reason text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_s public.driver_settlements; v_id uuid; v_total numeric;
  v_balance numeric; v_is_admin boolean; v_prev_status text;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_s.status NOT IN ('approved','paid') THEN RAISE EXCEPTION 'must_be_approved'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

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
  VALUES (v_s.tenant_id, _settlement_id, _amount, _payment_method, _payment_account, _payment_reference, _receipt_url, _notes, auth.uid())
  RETURNING id INTO v_id;

  SELECT COALESCE(sum(amount),0) INTO v_total FROM public.driver_settlement_payments WHERE settlement_id = _settlement_id;

  UPDATE public.driver_settlements SET
    total_paid_amount = v_total,
    payment_balance = COALESCE(driver_payable_amount,0) - v_total,
    status = CASE WHEN v_total >= COALESCE(driver_payable_amount,0) THEN 'paid' ELSE status END,
    paid_by = CASE WHEN v_total >= COALESCE(driver_payable_amount,0) THEN auth.uid() ELSE paid_by END,
    paid_at = CASE WHEN v_total >= COALESCE(driver_payable_amount,0) THEN now() ELSE paid_at END
  WHERE id = _settlement_id;

  PERFORM public._log_settlement_event(_settlement_id, 'payment_registered', v_prev_status,
    (SELECT status FROM public.driver_settlements WHERE id=_settlement_id), _notes,
    jsonb_build_object('payment_id', v_id, 'amount', _amount, 'method', _payment_method, 'reference', _payment_reference,
                       'total_paid', v_total, 'overpayment', _amount > v_balance,
                       'overpayment_reason', CASE WHEN _amount > v_balance THEN _overpayment_reason ELSE NULL END));
  RETURN v_id;
END; $$;