-- Read-only production capture, 2026-08-30. QA fixture only; not a deployment or recovery script.
-- Exact pg_get_functiondef bodies; schema/ACL setup belongs to the test harness.

CREATE OR REPLACE FUNCTION public._build_driver_settlement(_tenant_id uuid, _dispatch_trip_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public._log_settlement_event(_settlement_id uuid, _event_type text, _from_status text DEFAULT NULL::text, _to_status text DEFAULT NULL::text, _reason text DEFAULT NULL::text, _payload jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_t uuid;
BEGIN
  SELECT tenant_id INTO v_t FROM public.driver_settlements WHERE id = _settlement_id;
  IF v_t IS NULL THEN RETURN; END IF;
  INSERT INTO public.driver_settlement_events(tenant_id, settlement_id, event_type, from_status, to_status, reason, payload, created_by)
  VALUES (v_t, _settlement_id, _event_type, _from_status, _to_status, _reason, COALESCE(_payload,'{}'::jsonb), auth.uid());
END; $function$;

CREATE OR REPLACE FUNCTION public._on_dispatch_trip_completed_create_settlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$;

CREATE OR REPLACE FUNCTION public._tg_sync_obligations_from_settlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END; $function$;

CREATE OR REPLACE FUNCTION public._touch_driver_settlements_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;

CREATE OR REPLACE FUNCTION public.release_inbound_notes_from_failed_cte()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
  v_sefaz_status text;
  v_outbound_id uuid;
BEGIN
  v_outbound_id := COALESCE(NEW.id, OLD.id);
  v_status := lower(trim(COALESCE(NEW.status, OLD.status, '')));
  v_sefaz_status := lower(trim(COALESCE(NEW.sefaz_status, OLD.sefaz_status, '')));

  IF COALESCE(NEW.document_type, OLD.document_type) = 'outbound'
     AND (
       v_status IN ('rejected', 'rejeitada', 'rejeitado', 'error', 'erro', 'failed', 'denied', 'denegada', 'denegado')
       OR v_sefaz_status IN ('rejected', 'rejeitada', 'rejeitado', 'error', 'erro', 'failed', 'processed_error', 'sent_error', 'sefaz_error', 'denied', 'denegada', 'denegado')
     ) THEN
    UPDATE public.fiscal_documents
       SET cte_emitted_at = NULL,
           cte_emitted_outbound_id = NULL
     WHERE cte_emitted_outbound_id = v_outbound_id
       AND document_type = 'inbound';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_handle_empty_load_on_doc_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
    -- If it's an UPDATE that changed load_id, check the OLD load_id
    IF TG_OP = 'UPDATE' THEN
        IF OLD.load_id IS NOT NULL AND (NEW.load_id IS NULL OR NEW.load_id <> OLD.load_id OR NEW.status = 'deleted') THEN
            PERFORM public.delete_load_if_empty(OLD.load_id);
        END IF;
    -- If it's a DELETE, check the OLD load_id
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.load_id IS NOT NULL THEN
            PERFORM public.delete_load_if_empty(OLD.load_id);
        END IF;
    END IF;
    RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $function$;
