
-- =========================================================
-- Driver Settlements - Hardening Fixes (additive)
-- =========================================================

-- 1) driver_expenses: classification for reimbursability
ALTER TABLE public.driver_expenses
  ADD COLUMN IF NOT EXISTS reimbursable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_source text NOT NULL DEFAULT 'driver';

-- 2) Drop old/duplicated KM review RPC (replaced by update_driver_settlement_km_review)
DROP FUNCTION IF EXISTS public.update_settlement_km_review(uuid, numeric, text, text);

-- 3) Rewrite _build_driver_settlement: real columns + safer origin/destination + snapshot + reimbursable
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
  v_snapshot jsonb;
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

  -- Distinct document ids across the trip (load-linked + stop-linked)
  CREATE TEMP TABLE IF NOT EXISTS _tmp_doc_ids (id uuid PRIMARY KEY) ON COMMIT DROP;
  DELETE FROM _tmp_doc_ids;
  INSERT INTO _tmp_doc_ids(id)
  SELECT DISTINCT x.id FROM (
    SELECT fd.id
      FROM public.fiscal_documents fd
     WHERE fd.tenant_id = _tenant_id
       AND fd.load_id IN (
         SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
         UNION
         SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
       )
    UNION
    SELECT dsd.fiscal_document_id AS id
      FROM public.dispatch_stop_documents dsd
      JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
     WHERE ds.dispatch_trip_id = _dispatch_trip_id AND dsd.fiscal_document_id IS NOT NULL
  ) x
  ON CONFLICT (id) DO NOTHING;

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
    COALESCE((SELECT sum(COALESCE(NULLIF(fd.freight_value,0),
                          CASE WHEN COALESCE(fd.document_type,'nfe') IN ('cte','ct-e','CTe') THEN fd.value ELSE 0 END))
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

  -- Expenses split: total approved (route cost) vs. approved-AND-reimbursable (driver payable)
  SELECT
    COALESCE(sum(amount) FILTER (WHERE approval_status='approved'),0),
    COALESCE(sum(amount) FILTER (WHERE approval_status='pending'),0),
    COALESCE(sum(amount) FILTER (WHERE approval_status='rejected'),0),
    COALESCE(sum(amount),0),
    COALESCE(sum(amount) FILTER (WHERE approval_status='approved' AND COALESCE(reimbursable,true)=true),0)
  INTO v_appr, v_pend, v_rej, v_exp_total, v_appr_reimb
  FROM public.driver_expenses
  WHERE tenant_id = _tenant_id AND dispatch_trip_id = _dispatch_trip_id;

  -- Origin: prefer first linked load's origin; else null
  SELECT l.origin INTO v_route_origin
  FROM public.loads l
  WHERE l.id IN (
    SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
    UNION SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
  ) AND l.origin IS NOT NULL
  ORDER BY l.created_at ASC NULLS LAST
  LIMIT 1;

  -- If no load origin, use first stop destination as origin proxy
  IF v_route_origin IS NULL THEN
    SELECT ds.destination INTO v_route_origin
    FROM public.dispatch_stops ds
    WHERE ds.dispatch_trip_id = _dispatch_trip_id
    ORDER BY ds.stop_order ASC NULLS LAST, ds.created_at ASC NULLS LAST
    LIMIT 1;
  END IF;

  -- Destination: last stop's destination; fallback to load destination
  SELECT ds.destination INTO v_route_destination
  FROM public.dispatch_stops ds
  WHERE ds.dispatch_trip_id = _dispatch_trip_id
  ORDER BY ds.stop_order DESC NULLS LAST, ds.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_route_destination IS NULL THEN
    SELECT l.destination INTO v_route_destination
    FROM public.loads l
    WHERE l.id IN (
      SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
      UNION SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
    ) AND l.destination IS NOT NULL
    ORDER BY l.created_at DESC NULLS LAST
    LIMIT 1;
  END IF;

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

  -- Snapshot (fotografia)
  v_snapshot := jsonb_build_object(
    'calculation_version', 'driver_settlement_v2',
    'generated_at', now(),
    'trip', jsonb_build_object('id', v_trip.id, 'status', v_trip.status, 'started_at', v_trip.actual_start_at, 'ended_at', v_trip.actual_end_at, 'notes', v_trip.notes),
    'driver_id', v_trip.driver_id, 'vehicle_id', v_trip.vehicle_id,
    'route', jsonb_build_object('origin', v_route_origin, 'destination', v_route_destination, 'estimated_km', v_estimated_km),
    'loads', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM public.loads l WHERE l.id IN (
        SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
        UNION SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
      )), '[]'::jsonb),
    'documents', COALESCE((SELECT jsonb_agg(to_jsonb(fd)) FROM public.fiscal_documents fd WHERE fd.id IN (SELECT id FROM _tmp_doc_ids)), '[]'::jsonb),
    'expenses', COALESCE((SELECT jsonb_agg(to_jsonb(de)) FROM public.driver_expenses de WHERE de.tenant_id = _tenant_id AND de.dispatch_trip_id = _dispatch_trip_id), '[]'::jsonb),
    'totals', jsonb_build_object(
      'total_goods_value', v_total_goods,
      'total_freight_revenue', v_total_freight_rev,
      'approved_expenses_total', v_appr,
      'driver_reimbursement_total', v_appr_reimb,
      'route_result', v_route_result,
      'driver_credits_total', v_adj_credits,
      'driver_debits_total', v_adj_debits,
      'driver_payable_amount', v_payable,
      'total_paid_amount', v_total_paid,
      'payment_balance', v_payable - v_total_paid
    )
  );

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
    recalculation_reason = NULL,
    snapshot_json = v_snapshot
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
         jsonb_build_object('approval_status', de.approval_status, 'expense_at', de.expense_at, 'receipt_url', de.receipt_url, 'notes', de.notes,
                            'reimbursable', COALESCE(de.reimbursable, true), 'payment_source', COALESCE(de.payment_source,'driver'))
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
    jsonb_build_object('loads', v_loads_count, 'documents', v_documents_count, 'freight', v_total_freight_rev, 'goods', v_total_goods, 'expenses_approved', v_appr, 'driver_reimbursement', v_appr_reimb)
  );

  RETURN v_settlement_id;
END;
$fn$;

-- 4) Revoke PUBLIC on internal SECURITY DEFINER
-- SET search_path = public helpers/triggers
REVOKE ALL ON FUNCTION public._build_driver_settlement(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._log_settlement_event(uuid, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_driver_settlement_outdated(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._tg_mark_outdated_expense() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._tg_mark_outdated_trip_loads() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._tg_mark_outdated_trip_routes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._on_dispatch_trip_completed_create_settlement() FROM PUBLIC;

-- 5) remove_driver_settlement_adjustment: enforce reason + existence
CREATE OR REPLACE FUNCTION public.remove_driver_settlement_adjustment(_settlement_id uuid, _item_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE v_s public.driver_settlements; v_rows int;
BEGIN
  IF length(trim(COALESCE(_reason,''))) = 0 THEN RAISE EXCEPTION 'reason_required'; END IF;
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_s.status NOT IN ('pending_review','in_review','reopened') THEN RAISE EXCEPTION 'settlement_locked'; END IF;
  DELETE FROM public.driver_settlement_items
    WHERE id = _item_id AND settlement_id = _settlement_id AND item_type='adjustment';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RAISE EXCEPTION 'adjustment_not_found'; END IF;
  PERFORM public._build_driver_settlement(v_s.tenant_id, v_s.dispatch_trip_id);
  PERFORM public._log_settlement_event(_settlement_id, 'manual_adjustment_removed', NULL, NULL, _reason,
    jsonb_build_object('item_id', _item_id));
END; $$;
REVOKE ALL ON FUNCTION public.remove_driver_settlement_adjustment(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remove_driver_settlement_adjustment(uuid, uuid, text) TO authenticated;

-- 6) register_driver_settlement_payment: overpayment control + optional admin exception
DROP FUNCTION IF EXISTS public.register_driver_settlement_payment(uuid, numeric, text, text, text, text, text);
CREATE OR REPLACE FUNCTION public.register_driver_settlement_payment(
  _settlement_id uuid, _amount numeric, _payment_method text DEFAULT NULL,
  _payment_account text DEFAULT NULL, _payment_reference text DEFAULT NULL,
  _receipt_url text DEFAULT NULL, _notes text DEFAULT NULL,
  _allow_overpayment boolean DEFAULT false, _overpayment_reason text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE
  v_s public.driver_settlements; v_id uuid; v_total numeric;
  v_balance numeric; v_is_admin boolean;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_s.status NOT IN ('approved','paid') THEN RAISE EXCEPTION 'must_be_approved'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

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

  PERFORM public._log_settlement_event(_settlement_id, 'payment_registered', v_s.status,
    (SELECT status FROM public.driver_settlements WHERE id=_settlement_id), _notes,
    jsonb_build_object('payment_id', v_id, 'amount', _amount, 'method', _payment_method, 'reference', _payment_reference,
                       'total_paid', v_total, 'overpayment', _amount > v_balance,
                       'overpayment_reason', CASE WHEN _amount > v_balance THEN _overpayment_reason ELSE NULL END));
  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.register_driver_settlement_payment(uuid, numeric, text, text, text, text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_driver_settlement_payment(uuid, numeric, text, text, text, text, text, boolean, text) TO authenticated;

-- 7) list_driver_settlements: fix total + return summary (KPIs on filtered universe)
DROP FUNCTION IF EXISTS public.list_driver_settlements(uuid, text, uuid, uuid, text, date, date, boolean, boolean, boolean, boolean, integer, integer);
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
  v_offset int; v_q text;
  v_total int; v_items jsonb; v_summary jsonb;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  v_offset := GREATEST(0, (COALESCE(_page,1)-1) * COALESCE(_page_size,50));
  v_q := NULLIF(trim(COALESCE(_search,'')), '');

  CREATE TEMP TABLE IF NOT EXISTS _tmp_settlement_base (LIKE public.driver_settlements INCLUDING ALL) ON COMMIT DROP;
  -- Use a fresh CTE flow instead of TEMP TABLE (avoid clashes). Inline below:

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
      count(*) AS total_count,
      count(*) FILTER (WHERE status='pending_review') AS pending_count,
      count(*) FILTER (WHERE status='in_review') AS in_review_count,
      count(*) FILTER (WHERE status='approved') AS approved_count,
      count(*) FILTER (WHERE status IN ('paid','closed')) AS paid_closed_count,
      count(*) FILTER (WHERE needs_recalculation = true) AS needs_recalculation_count,
      count(*) FILTER (WHERE km_review_status='pending') AS km_pending_count,
      count(*) FILTER (WHERE COALESCE(pending_expenses_total,0) > 0) AS expense_pending_count,
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
    'page', _page, 'page_size', _page_size,
    'summary', v_summary
  );
END; $$;
REVOKE ALL ON FUNCTION public.list_driver_settlements(uuid,text,uuid,uuid,text,date,date,boolean,boolean,boolean,boolean,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_driver_settlements(uuid,text,uuid,uuid,text,date,date,boolean,boolean,boolean,boolean,integer,integer) TO authenticated;

-- 8) Filter options RPC (drivers + vehicles with at least one settlement in tenant)
CREATE OR REPLACE FUNCTION public.list_driver_settlement_filter_options(_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE v_drivers jsonb; v_vehicles jsonb;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) ORDER BY d.name), '[]'::jsonb)
    INTO v_drivers
    FROM public.drivers d
   WHERE d.tenant_id = _tenant_id
     AND EXISTS (SELECT 1 FROM public.driver_settlements s WHERE s.tenant_id = _tenant_id AND s.driver_id = d.id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', v.id, 'plate', v.plate) ORDER BY v.plate), '[]'::jsonb)
    INTO v_vehicles
    FROM public.vehicles v
   WHERE v.tenant_id = _tenant_id
     AND EXISTS (SELECT 1 FROM public.driver_settlements s WHERE s.tenant_id = _tenant_id AND s.vehicle_id = v.id);
  RETURN jsonb_build_object('drivers', v_drivers, 'vehicles', v_vehicles);
END; $$;
REVOKE ALL ON FUNCTION public.list_driver_settlement_filter_options(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_driver_settlement_filter_options(uuid) TO authenticated;
