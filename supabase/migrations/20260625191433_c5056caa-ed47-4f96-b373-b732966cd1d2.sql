-- =========================================================
-- Driver Settlements - Hardening (additive)
-- =========================================================

-- 1) Add new columns (additive)
ALTER TABLE public.driver_settlements
  ADD COLUMN IF NOT EXISTS total_goods_value numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_freight_revenue numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS route_result numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS driver_credits_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS driver_debits_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS driver_reimbursement_total numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS driver_payable_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_paid_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_recalculated_at timestamptz,
  ADD COLUMN IF NOT EXISTS needs_recalculation boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recalculation_reason text,
  ADD COLUMN IF NOT EXISTS source_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_with_exception boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS exception_reason text;

ALTER TABLE public.driver_settlement_items
  ADD COLUMN IF NOT EXISTS nature text;

-- 2) Tighten RLS: revoke direct writes; reads via SELECT policy; mutations via SECURITY DEFINER
  SET search_path = public RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.driver_settlements FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.driver_settlement_items FROM authenticated;
DROP POLICY IF EXISTS "settlements_manage" ON public.driver_settlements;
DROP POLICY IF EXISTS "dsi_manage" ON public.driver_settlement_items;
DROP POLICY IF EXISTS "settlements_select" ON public.driver_settlements;
CREATE POLICY "settlements_select" ON public.driver_settlements FOR SELECT TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id));
DROP POLICY IF EXISTS "dsi_select" ON public.driver_settlement_items;
CREATE POLICY "dsi_select" ON public.driver_settlement_items FOR SELECT TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id));

-- 3) Auditoria - driver_settlement_events
CREATE TABLE IF NOT EXISTS public.driver_settlement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  settlement_id uuid NOT NULL REFERENCES public.driver_settlements(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_settlement_events TO authenticated;
GRANT ALL ON public.driver_settlement_events TO service_role;
CREATE INDEX IF NOT EXISTS idx_dse_settlement ON public.driver_settlement_events(settlement_id);
CREATE INDEX IF NOT EXISTS idx_dse_tenant ON public.driver_settlement_events(tenant_id);
ALTER TABLE public.driver_settlement_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dse_select" ON public.driver_settlement_events;
CREATE POLICY "dse_select" ON public.driver_settlement_events FOR SELECT TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id));

-- 4) Pagamentos - driver_settlement_payments
CREATE TABLE IF NOT EXISTS public.driver_settlement_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  settlement_id uuid NOT NULL REFERENCES public.driver_settlements(id) ON DELETE RESTRICT,
  amount numeric NOT NULL CHECK (amount > 0),
  payment_method text,
  payment_account text,
  payment_reference text,
  receipt_url text,
  notes text,
  paid_by uuid,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.driver_settlement_payments TO authenticated;
GRANT ALL ON public.driver_settlement_payments TO service_role;
CREATE INDEX IF NOT EXISTS idx_dsp_settlement ON public.driver_settlement_payments(settlement_id);
CREATE INDEX IF NOT EXISTS idx_dsp_tenant ON public.driver_settlement_payments(tenant_id);
ALTER TABLE public.driver_settlement_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dsp_select" ON public.driver_settlement_payments;
CREATE POLICY "dsp_select" ON public.driver_settlement_payments FOR SELECT TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id));

-- 5) Helper: log event (internal)
CREATE OR REPLACE FUNCTION public._log_settlement_event(
  _settlement_id uuid, _event_type text,
  _from_status text DEFAULT NULL, _to_status text DEFAULT NULL,
  _reason text DEFAULT NULL, _payload jsonb DEFAULT '{}'::jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE v_t uuid;
BEGIN
  SELECT tenant_id INTO v_t FROM public.driver_settlements WHERE id = _settlement_id;
  IF v_t IS NULL THEN RETURN; END IF;
  INSERT INTO public.driver_settlement_events(tenant_id, settlement_id, event_type, from_status, to_status, reason, payload, created_by)
  VALUES (v_t, _settlement_id, _event_type, _from_status, _to_status, _reason, COALESCE(_payload,'{}'::jsonb), auth.uid());
END; $$;

-- 6) Internal builder used by RPC and trigger (no permission check; caller guards)
CREATE OR REPLACE FUNCTION public._build_driver_settlement(_tenant_id uuid, _dispatch_trip_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $fn$
DECLARE
  v_trip record;
  v_settlement_id uuid;
  v_existing_status text;
  v_was_new boolean := false;
  v_loads_count int := 0;
  v_stops_count int := 0;
  v_documents_count int := 0;
  v_total_goods numeric := 0;
  v_total_freight_rev numeric := 0;
  v_total_weight numeric := 0;
  v_estimated_km numeric;
  v_appr numeric := 0;
  v_pend numeric := 0;
  v_rej numeric := 0;
  v_exp_total numeric := 0;
  v_appr_reimb numeric := 0;
  v_adj_credits numeric := 0;
  v_adj_debits numeric := 0;
  v_route_origin text;
  v_route_destination text;
  v_route_name text;
  v_total_paid numeric := 0;
  v_payable numeric := 0;
  v_route_result numeric := 0;
BEGIN
  SELECT dt.* INTO v_trip
  FROM public.dispatch_trips dt
  WHERE dt.id = _dispatch_trip_id AND dt.tenant_id = _tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'trip_not_found'; END IF;

  SELECT id, status INTO v_settlement_id, v_existing_status
  FROM public.driver_settlements
  WHERE tenant_id = _tenant_id AND dispatch_trip_id = _dispatch_trip_id;

  IF v_settlement_id IS NOT NULL AND v_existing_status NOT IN ('pending_review','in_review','reopened') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _tmp_doc_ids (id uuid) ON COMMIT DROP;
  DELETE FROM _tmp_doc_ids;
  INSERT INTO _tmp_doc_ids(id)
  SELECT DISTINCT fd.id
  FROM public.fiscal_documents fd
  WHERE fd.tenant_id = _tenant_id
    AND fd.load_id IN (
      SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
      UNION
      SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
    )
  UNION
  SELECT DISTINCT dsd.fiscal_document_id
  FROM public.dispatch_stop_documents dsd
  JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
  WHERE ds.dispatch_trip_id = _dispatch_trip_id AND dsd.fiscal_document_id IS NOT NULL;

  SELECT
    (SELECT count(DISTINCT load_id) FROM (
      SELECT v_trip.load_id AS load_id WHERE v_trip.load_id IS NOT NULL
      UNION
      SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
    ) x WHERE load_id IS NOT NULL),
    (SELECT count(*) FROM public.dispatch_stops WHERE dispatch_trip_id = _dispatch_trip_id),
    (SELECT count(*) FROM _tmp_doc_ids),
    COALESCE((SELECT sum(fd.value) FROM public.fiscal_documents fd JOIN _tmp_doc_ids d ON d.id = fd.id
              WHERE COALESCE(fd.document_type,'nfe') NOT IN ('cte','ct-e','CTe')), 0),
    COALESCE((SELECT sum(COALESCE(NULLIF(fd.freight_value,0), CASE WHEN COALESCE(fd.document_type,'nfe') IN ('cte','ct-e','CTe') THEN fd.value ELSE 0 END))
              FROM public.fiscal_documents fd JOIN _tmp_doc_ids d ON d.id = fd.id), 0),
    COALESCE(NULLIF((SELECT sum(fd.weight_kg) FROM public.fiscal_documents fd JOIN _tmp_doc_ids d ON d.id = fd.id),0),
             COALESCE((SELECT sum(l.total_weight_kg) FROM public.loads l WHERE l.id IN (
                SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
                UNION SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
             )),0))
  INTO v_loads_count, v_stops_count, v_documents_count, v_total_goods, v_total_freight_rev, v_total_weight;

  SELECT (tr.distance_meters / 1000.0) INTO v_estimated_km
  FROM public.trip_routes tr
  WHERE tr.tenant_id = _tenant_id AND tr.trip_id = _dispatch_trip_id
  ORDER BY (tr.provider = 'osrm') DESC, tr.created_at DESC LIMIT 1;

  SELECT
    COALESCE(sum(amount) FILTER (WHERE approval_status='approved'),0),
    COALESCE(sum(amount) FILTER (WHERE approval_status='pending'),0),
    COALESCE(sum(amount) FILTER (WHERE approval_status='rejected'),0),
    COALESCE(sum(amount),0),
    COALESCE(sum(amount) FILTER (WHERE approval_status='approved'),0)
  INTO v_appr, v_pend, v_rej, v_exp_total, v_appr_reimb
  FROM public.driver_expenses
  WHERE tenant_id = _tenant_id AND dispatch_trip_id = _dispatch_trip_id;

  SELECT origin INTO v_route_origin FROM (
    SELECT COALESCE(ds.origin, ds.destination) AS origin
    FROM public.dispatch_stops ds
    WHERE ds.dispatch_trip_id = _dispatch_trip_id
    ORDER BY COALESCE(ds.manual_order, ds.optimized_order, ds.original_order, 9999) ASC NULLS LAST
    LIMIT 1
  ) a;
  SELECT destination INTO v_route_destination FROM (
    SELECT ds.destination
    FROM public.dispatch_stops ds
    WHERE ds.dispatch_trip_id = _dispatch_trip_id
    ORDER BY COALESCE(ds.manual_order, ds.optimized_order, ds.original_order, 9999) DESC NULLS LAST
    LIMIT 1
  ) a;
  v_route_name := v_trip.notes;

  v_route_result := COALESCE(v_total_freight_rev,0) - COALESCE(v_appr,0);

  IF v_settlement_id IS NULL THEN
    v_was_new := true;
    INSERT INTO public.driver_settlements (
      tenant_id, dispatch_trip_id, driver_id, vehicle_id, status,
      trip_started_at, trip_completed_at, route_name, route_origin, route_destination,
      loads_count, stops_count, documents_count,
      total_invoice_value, total_freight_value, total_weight_kg,
      total_goods_value, total_freight_revenue, route_result,
      estimated_km,
      approved_expenses_total, pending_expenses_total, rejected_expenses_total, expenses_total,
      driver_reimbursement_total,
      invoice_balance, operational_balance,
      last_recalculated_at, needs_recalculation, recalculation_reason
    ) VALUES (
      _tenant_id, _dispatch_trip_id, v_trip.driver_id, v_trip.vehicle_id, 'pending_review',
      v_trip.actual_start_at, v_trip.actual_end_at, v_route_name, v_route_origin, v_route_destination,
      v_loads_count, v_stops_count, v_documents_count,
      v_total_goods, v_total_freight_rev, v_total_weight,
      v_total_goods, v_total_freight_rev, v_route_result,
      v_estimated_km,
      v_appr, v_pend, v_rej, v_exp_total,
      v_appr_reimb,
      v_total_goods - v_appr, v_route_result,
      now(), false, NULL
    ) RETURNING id INTO v_settlement_id;
  END IF;

  SELECT
    COALESCE(sum(amount) FILTER (WHERE nature='credit'),0),
    COALESCE(sum(amount) FILTER (WHERE nature='debit'),0)
  INTO v_adj_credits, v_adj_debits
  FROM public.driver_settlement_items
  WHERE settlement_id = v_settlement_id AND item_type='adjustment';

  SELECT COALESCE(sum(amount),0) INTO v_total_paid
  FROM public.driver_settlement_payments WHERE settlement_id = v_settlement_id;

  v_payable := v_adj_credits + v_appr_reimb - v_adj_debits;

  UPDATE public.driver_settlements SET
    driver_id = v_trip.driver_id,
    vehicle_id = v_trip.vehicle_id,
    trip_started_at = v_trip.actual_start_at,
    trip_completed_at = v_trip.actual_end_at,
    route_name = v_route_name,
    route_origin = v_route_origin,
    route_destination = v_route_destination,
    loads_count = v_loads_count,
    stops_count = v_stops_count,
    documents_count = v_documents_count,
    total_invoice_value = v_total_goods,
    total_freight_value = v_total_freight_rev,
    total_weight_kg = v_total_weight,
    total_goods_value = v_total_goods,
    total_freight_revenue = v_total_freight_rev,
    route_result = v_route_result,
    estimated_km = v_estimated_km,
    approved_expenses_total = v_appr,
    pending_expenses_total = v_pend,
    rejected_expenses_total = v_rej,
    expenses_total = v_exp_total,
    driver_reimbursement_total = v_appr_reimb,
    driver_credits_total = v_adj_credits,
    driver_debits_total = v_adj_debits,
    driver_payable_amount = v_payable,
    manual_adjustments_total = v_adj_credits - v_adj_debits,
    total_paid_amount = v_total_paid,
    payment_balance = v_payable - v_total_paid,
    invoice_balance = v_total_goods - v_appr,
    operational_balance = v_route_result,
    final_amount = v_payable,
    last_recalculated_at = now(),
    needs_recalculation = false,
    recalculation_reason = NULL
  WHERE id = v_settlement_id;

  DELETE FROM public.driver_settlement_items
   WHERE settlement_id = v_settlement_id AND item_type <> 'adjustment';

  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
  SELECT _tenant_id, v_settlement_id, 'load', 'loads', l.id,
         COALESCE(l.load_number, l.origin || ' → ' || l.destination), 0, l.total_weight_kg,
         jsonb_build_object('origin', l.origin, 'destination', l.destination, 'status', l.status, 'pallets', l.total_pallet_count)
  FROM public.loads l
  WHERE l.id IN (
    SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
    UNION
    SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
  );

  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
  SELECT _tenant_id, v_settlement_id, 'fiscal_document', 'fiscal_documents', fd.id,
         COALESCE(fd.invoice_number, fd.access_key), fd.value, fd.weight_kg,
         jsonb_build_object('document_type', fd.document_type, 'freight_value', fd.freight_value, 'recipient', fd.recipient, 'recipient_city', fd.recipient_city, 'recipient_state', fd.recipient_state, 'status', fd.status)
  FROM public.fiscal_documents fd
  WHERE fd.id IN (SELECT id FROM _tmp_doc_ids);

  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
  SELECT _tenant_id, v_settlement_id, 'expense', 'driver_expenses', de.id,
         de.category, de.amount, NULL,
         jsonb_build_object('approval_status', de.approval_status, 'expense_at', de.expense_at, 'receipt_url', de.receipt_url, 'notes', de.notes)
  FROM public.driver_expenses de
  WHERE de.tenant_id = _tenant_id AND de.dispatch_trip_id = _dispatch_trip_id;

  IF v_estimated_km IS NOT NULL THEN
    INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
    VALUES (_tenant_id, v_settlement_id, 'km', 'trip_routes', NULL, 'KM estimado (mapa)', 0, v_estimated_km, jsonb_build_object('provider','osrm'));
  END IF;

  PERFORM public._log_settlement_event(
    v_settlement_id,
    CASE WHEN v_was_new THEN 'generated' ELSE 'recalculated' END,
    NULL, NULL, NULL,
    jsonb_build_object('loads', v_loads_count, 'documents', v_documents_count, 'freight', v_total_freight_rev, 'goods', v_total_goods, 'expenses_approved', v_appr)
  );

  RETURN v_settlement_id;
END;
$fn$;

-- 7) Public RPC wrapper: generate_driver_settlement (permission-checked)
CREATE OR REPLACE FUNCTION public.generate_driver_settlement(_tenant_id uuid, _dispatch_trip_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE v_trip_status text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT status INTO v_trip_status FROM public.dispatch_trips WHERE id = _dispatch_trip_id AND tenant_id = _tenant_id;
  IF v_trip_status IS NULL THEN RAISE EXCEPTION 'trip_not_found'; END IF;
  IF v_trip_status <> 'completed' THEN RAISE EXCEPTION 'trip_not_completed'; END IF;
  RETURN public._build_driver_settlement(_tenant_id, _dispatch_trip_id);
END; $$;
REVOKE ALL ON FUNCTION public.generate_driver_settlement(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_driver_settlement(uuid, uuid) TO authenticated;

-- 8) generate_pending_driver_settlements: now also recalcs incomplete/outdated
CREATE OR REPLACE FUNCTION public.generate_pending_driver_settlements(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE
  v_trip_id uuid; v_existing uuid; v_status text;
  v_generated int := 0; v_recalculated int := 0; v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  FOR v_trip_id IN
    SELECT dt.id FROM public.dispatch_trips dt
    WHERE dt.tenant_id = _tenant_id AND dt.status = 'completed'
  LOOP
    SELECT id, status INTO v_existing, v_status FROM public.driver_settlements
      WHERE tenant_id = _tenant_id AND dispatch_trip_id = v_trip_id;
    BEGIN
      IF v_existing IS NULL THEN
        PERFORM public._build_driver_settlement(_tenant_id, v_trip_id);
        v_generated := v_generated + 1;
      ELSIF v_status IN ('pending_review','in_review','reopened') THEN
        IF EXISTS (
          SELECT 1 FROM public.driver_settlements s WHERE s.id = v_existing AND (
            s.loads_count = 0 OR s.documents_count = 0 OR s.estimated_km IS NULL
            OR s.total_invoice_value = 0 OR s.total_freight_value = 0 OR s.needs_recalculation = true
            OR s.last_recalculated_at IS NULL
          )
        ) THEN
          PERFORM public._build_driver_settlement(_tenant_id, v_trip_id);
          v_recalculated := v_recalculated + 1;
        ELSE
          v_skipped := v_skipped + 1;
        END IF;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_object('trip_id', v_trip_id, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('generated', v_generated, 'recalculated', v_recalculated, 'skipped', v_skipped, 'errors', v_errors);
END; $$;
REVOKE ALL ON FUNCTION public.generate_pending_driver_settlements(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_pending_driver_settlements(uuid) TO authenticated;

-- 9) update_driver_settlement_status with validations + exception
DROP FUNCTION IF EXISTS public.update_driver_settlement_status(uuid, text);
CREATE OR REPLACE FUNCTION public.update_driver_settlement_status(
  _settlement_id uuid, _new_status text, _reason text DEFAULT NULL, _allow_exceptions boolean DEFAULT false
) RETURNS public.driver_settlements
LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE
  v_user uuid := auth.uid();
  v_s public.driver_settlements;
  v_prev_status text;
  v_allowed boolean := false;
  v_blocks text[] := ARRAY[]::text[];
  v_is_admin boolean;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_prev_status := v_s.status;
  v_is_admin := public.is_tenant_admin(v_s.tenant_id);

  v_allowed := CASE
    WHEN v_s.status = 'pending_review' AND _new_status IN ('in_review') THEN true
    WHEN v_s.status = 'in_review' AND _new_status IN ('approved','pending_review') THEN true
    WHEN v_s.status = 'approved' AND _new_status IN ('paid') THEN true
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

  IF _new_status = 'paid' THEN
    IF COALESCE(v_s.total_paid_amount,0) < COALESCE(v_s.driver_payable_amount,0) AND NOT _allow_exceptions THEN
      RAISE EXCEPTION 'payment_not_complete';
    END IF;
  END IF;

  UPDATE public.driver_settlements SET
    status = _new_status,
    reviewed_by = CASE WHEN _new_status='in_review' THEN v_user ELSE reviewed_by END,
    reviewed_at = CASE WHEN _new_status='in_review' THEN now() ELSE reviewed_at END,
    approved_by = CASE WHEN _new_status='approved' THEN v_user ELSE approved_by END,
    approved_at = CASE WHEN _new_status='approved' THEN now() ELSE approved_at END,
    paid_by = CASE WHEN _new_status='paid' THEN v_user ELSE paid_by END,
    paid_at = CASE WHEN _new_status='paid' THEN now() ELSE paid_at END,
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
REVOKE ALL ON FUNCTION public.update_driver_settlement_status(uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_driver_settlement_status(uuid, text, text, boolean) TO authenticated;

-- 10) KM review
CREATE OR REPLACE FUNCTION public.update_driver_settlement_km_review(_settlement_id uuid, _audited_km numeric, _km_status text, _notes text)
RETURNS public.driver_settlements LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE v_s public.driver_settlements;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_s.status NOT IN ('pending_review','in_review','reopened') THEN RAISE EXCEPTION 'settlement_locked'; END IF;
  IF _km_status NOT IN ('pending','reviewed','disputed') THEN RAISE EXCEPTION 'invalid_km_status'; END IF;
  UPDATE public.driver_settlements SET audited_km = _audited_km, km_review_status = _km_status, km_review_notes = _notes
  WHERE id = _settlement_id RETURNING * INTO v_s;
  PERFORM public._log_settlement_event(_settlement_id, 'km_reviewed', NULL, NULL, _notes,
    jsonb_build_object('audited_km', _audited_km, 'km_status', _km_status));
  RETURN v_s;
END; $$;
REVOKE ALL ON FUNCTION public.update_driver_settlement_km_review(uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_driver_settlement_km_review(uuid, numeric, text, text) TO authenticated;

-- 11) Adjustments
CREATE OR REPLACE FUNCTION public.add_driver_settlement_adjustment(
  _settlement_id uuid, _nature text, _amount numeric, _description text, _reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE v_s public.driver_settlements; v_id uuid;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_s.status NOT IN ('pending_review','in_review','reopened') THEN RAISE EXCEPTION 'settlement_locked'; END IF;
  IF _nature NOT IN ('credit','debit') THEN RAISE EXCEPTION 'invalid_nature'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF COALESCE(_reason,'')='' THEN RAISE EXCEPTION 'reason_required'; END IF;
  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, description, amount, nature, metadata)
  VALUES (v_s.tenant_id, _settlement_id, 'adjustment', 'manual', _description, _amount, _nature,
          jsonb_build_object('reason', _reason, 'created_by', auth.uid()))
  RETURNING id INTO v_id;
  PERFORM public._build_driver_settlement(v_s.tenant_id, v_s.dispatch_trip_id);
  PERFORM public._log_settlement_event(_settlement_id, 'manual_adjustment_added', NULL, NULL, _reason,
    jsonb_build_object('item_id', v_id, 'nature', _nature, 'amount', _amount, 'description', _description));
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.add_driver_settlement_adjustment(uuid, text, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.add_driver_settlement_adjustment(uuid, text, numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_driver_settlement_adjustment(_settlement_id uuid, _item_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE v_s public.driver_settlements;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_s.status NOT IN ('pending_review','in_review','reopened') THEN RAISE EXCEPTION 'settlement_locked'; END IF;
  DELETE FROM public.driver_settlement_items WHERE id = _item_id AND settlement_id = _settlement_id AND item_type='adjustment';
  PERFORM public._build_driver_settlement(v_s.tenant_id, v_s.dispatch_trip_id);
  PERFORM public._log_settlement_event(_settlement_id, 'manual_adjustment_removed', NULL, NULL, _reason,
    jsonb_build_object('item_id', _item_id));
END; $$;
REVOKE ALL ON FUNCTION public.remove_driver_settlement_adjustment(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_driver_settlement_adjustment(uuid, uuid, text) TO authenticated;

-- 12) Payments
CREATE OR REPLACE FUNCTION public.register_driver_settlement_payment(
  _settlement_id uuid, _amount numeric, _payment_method text DEFAULT NULL,
  _payment_account text DEFAULT NULL, _payment_reference text DEFAULT NULL,
  _receipt_url text DEFAULT NULL, _notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE v_s public.driver_settlements; v_id uuid; v_total numeric;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_s.status NOT IN ('approved','paid') THEN RAISE EXCEPTION 'must_be_approved'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

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

  PERFORM public._log_settlement_event(_settlement_id, 'payment_registered', v_s.status,
    (SELECT status FROM public.driver_settlements WHERE id=_settlement_id), _notes,
    jsonb_build_object('payment_id', v_id, 'amount', _amount, 'method', _payment_method, 'reference', _payment_reference, 'total_paid', v_total));
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.register_driver_settlement_payment(uuid, numeric, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_driver_settlement_payment(uuid, numeric, text, text, text, text, text) TO authenticated;

-- 13) mark outdated + triggers on source tables
CREATE OR REPLACE FUNCTION public.mark_driver_settlement_outdated(_tenant_id uuid, _dispatch_trip_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE v_s public.driver_settlements;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements
    WHERE tenant_id = _tenant_id AND dispatch_trip_id = _dispatch_trip_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_s.status IN ('pending_review','in_review','reopened') THEN
    UPDATE public.driver_settlements SET
      needs_recalculation = true,
      recalculation_reason = _reason,
      source_updated_at = now()
    WHERE id = v_s.id;
  END IF;
  PERFORM public._log_settlement_event(v_s.id, 'marked_outdated', v_s.status, v_s.status, _reason, '{}'::jsonb);
END; $$;

CREATE OR REPLACE FUNCTION public._tg_mark_outdated_expense() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE v_tid uuid; v_trip uuid;
BEGIN
  v_tid := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_trip := COALESCE(NEW.dispatch_trip_id, OLD.dispatch_trip_id);
  IF v_trip IS NOT NULL THEN PERFORM public.mark_driver_settlement_outdated(v_tid, v_trip, 'driver_expense_change'); END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS trg_driver_expenses_outdate ON public.driver_expenses;
CREATE TRIGGER trg_driver_expenses_outdate AFTER INSERT OR UPDATE OR DELETE ON public.driver_expenses
FOR EACH ROW EXECUTE FUNCTION public._tg_mark_outdated_expense();

CREATE OR REPLACE FUNCTION public._tg_mark_outdated_trip_loads() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE v_trip uuid; v_tid uuid;
BEGIN
  v_trip := COALESCE(NEW.dispatch_trip_id, OLD.dispatch_trip_id);
  SELECT tenant_id INTO v_tid FROM public.dispatch_trips WHERE id = v_trip;
  IF v_tid IS NOT NULL THEN PERFORM public.mark_driver_settlement_outdated(v_tid, v_trip, 'trip_loads_change'); END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS trg_dispatch_trip_loads_outdate ON public.dispatch_trip_loads;
CREATE TRIGGER trg_dispatch_trip_loads_outdate AFTER INSERT OR UPDATE OR DELETE ON public.dispatch_trip_loads
FOR EACH ROW EXECUTE FUNCTION public._tg_mark_outdated_trip_loads();

CREATE OR REPLACE FUNCTION public._tg_mark_outdated_trip_routes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE v_trip uuid; v_tid uuid;
BEGIN
  v_trip := COALESCE(NEW.trip_id, OLD.trip_id);
  v_tid := COALESCE(NEW.tenant_id, OLD.tenant_id);
  IF v_trip IS NOT NULL AND v_tid IS NOT NULL THEN PERFORM public.mark_driver_settlement_outdated(v_tid, v_trip, 'trip_route_change'); END IF;
  RETURN COALESCE(NEW, OLD);
END; $$;
DROP TRIGGER IF EXISTS trg_trip_routes_outdate ON public.trip_routes;
CREATE TRIGGER trg_trip_routes_outdate AFTER INSERT OR UPDATE OR DELETE ON public.trip_routes
FOR EACH ROW EXECUTE FUNCTION public._tg_mark_outdated_trip_routes();

-- 14) Replace trip-completed trigger to build full settlement
CREATE OR REPLACE FUNCTION public._on_dispatch_trip_completed_create_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    BEGIN
      PERFORM public._build_driver_settlement(NEW.tenant_id, NEW.id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.driver_settlements (tenant_id, dispatch_trip_id, driver_id, vehicle_id, status, trip_started_at, trip_completed_at, needs_recalculation, recalculation_reason)
      VALUES (NEW.tenant_id, NEW.id, NEW.driver_id, NEW.vehicle_id, 'pending_review', NEW.actual_start_at, NEW.actual_end_at, true, 'auto_build_failed: ' || SQLERRM)
      ON CONFLICT (tenant_id, dispatch_trip_id) DO NOTHING;
    END;
  END IF;
  RETURN NEW;
END; $$;

-- 15) Paginated list RPC
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
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE
  v_offset int; v_total int; v_items jsonb;
  v_q text;
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
  )
  SELECT count(*) OVER (), COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.trip_completed_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_total, v_items
  FROM (SELECT * FROM base ORDER BY trip_completed_at DESC NULLS LAST LIMIT _page_size OFFSET v_offset) b;

  IF v_total IS NULL THEN v_total := 0; END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'total_count', v_total,
    'page', _page, 'page_size', _page_size
  );
END; $$;
REVOKE ALL ON FUNCTION public.list_driver_settlements(uuid,text,uuid,uuid,text,date,date,boolean,boolean,boolean,boolean,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_driver_settlements(uuid,text,uuid,uuid,text,date,date,boolean,boolean,boolean,boolean,integer,integer) TO authenticated;