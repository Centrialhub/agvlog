CREATE OR REPLACE FUNCTION public._build_manual_driver_settlement(_settlement_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path TO 'public'
AS $$
DECLARE
  v_s record;
  v_tenant uuid;
  v_loads_count int := 0;
  v_documents_count int := 0;
  v_total_goods numeric := 0;
  v_total_freight_rev numeric := 0;
  v_total_weight numeric := 0;
  v_appr numeric := 0;
  v_appr_reimb numeric := 0;
  v_adj_credits numeric := 0;
  v_adj_debits numeric := 0;
  v_route_origin text;
  v_route_destination text;
  v_total_paid numeric := 0;
  v_payable numeric := 0;
  v_route_result numeric := 0;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF NOT v_s.is_manual THEN RAISE EXCEPTION 'not_manual_settlement'; END IF;
  IF v_s.status NOT IN ('pending_review','in_review','reopened') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;
  v_tenant := v_s.tenant_id;

  CREATE TEMP TABLE IF NOT EXISTS _tmp_ms_doc_ids (id uuid PRIMARY KEY) ON COMMIT DROP;
  DELETE FROM _tmp_ms_doc_ids WHERE true; -- Fixed: added WHERE clause
  INSERT INTO _tmp_ms_doc_ids(id)
  SELECT DISTINCT fd.id FROM public.fiscal_documents fd
    JOIN public.driver_settlement_loads dsl ON dsl.load_id = fd.load_id
   WHERE dsl.settlement_id = _settlement_id
  ON CONFLICT (id) DO NOTHING;

  SELECT
    (SELECT count(*) FROM public.driver_settlement_loads WHERE settlement_id = _settlement_id),
    (SELECT count(*) FROM _tmp_ms_doc_ids),
    COALESCE((SELECT sum(fd.value) FROM public.fiscal_documents fd JOIN _tmp_ms_doc_ids d ON d.id=fd.id
              WHERE COALESCE(fd.document_type,'nfe') NOT IN ('cte','ct-e','CTe')),0),
    COALESCE((SELECT sum(COALESCE(NULLIF(fd.freight_value,0),
                        CASE WHEN COALESCE(fd.document_type,'nfe') IN ('cte','ct-e','CTe') THEN fd.value ELSE 0 END))
              FROM public.fiscal_documents fd JOIN _tmp_ms_doc_ids d ON d.id=fd.id),0),
    COALESCE(NULLIF((SELECT sum(fd.weight_kg) FROM public.fiscal_documents fd JOIN _tmp_ms_doc_ids d ON d.id=fd.id),0),
             COALESCE((SELECT sum(l.total_weight_kg) FROM public.loads l
                       JOIN public.driver_settlement_loads dsl ON dsl.load_id = l.id
                       WHERE dsl.settlement_id = _settlement_id),0))
  INTO v_loads_count, v_documents_count, v_total_goods, v_total_freight_rev, v_total_weight;

  SELECT l.origin INTO v_route_origin
  FROM public.loads l
  JOIN public.driver_settlement_loads dsl ON dsl.load_id = l.id
  WHERE dsl.settlement_id = _settlement_id AND l.origin IS NOT NULL
  ORDER BY l.created_at ASC NULLS LAST LIMIT 1;

  SELECT l.destination INTO v_route_destination
  FROM public.loads l
  JOIN public.driver_settlement_loads dsl ON dsl.load_id = l.id
  WHERE dsl.settlement_id = _settlement_id AND l.destination IS NOT NULL
  ORDER BY l.created_at DESC NULLS LAST LIMIT 1;

  v_route_result := COALESCE(v_total_freight_rev,0) - COALESCE(v_appr,0);

  SELECT
    COALESCE(sum(amount) FILTER (WHERE nature='credit'),0),
    COALESCE(sum(amount) FILTER (WHERE nature='debit'),0)
  INTO v_adj_credits, v_adj_debits
  FROM public.driver_settlement_items
  WHERE settlement_id = _settlement_id AND item_type='adjustment';

  SELECT COALESCE(sum(amount),0) INTO v_total_paid
  FROM public.driver_settlement_payments WHERE settlement_id = _settlement_id;

  v_payable := v_adj_credits + v_appr_reimb - v_adj_debits;

  v_snapshot := jsonb_build_object(
    'calculation_version','manual_driver_settlement_v1',
    'generated_at', now(),
    'driver_id', v_s.driver_id, 'vehicle_id', v_s.vehicle_id,
    'route', jsonb_build_object('origin', v_route_origin, 'destination', v_route_destination),
    'loads', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM public.loads l
                       JOIN public.driver_settlement_loads dsl ON dsl.load_id = l.id
                       WHERE dsl.settlement_id = _settlement_id), '[]'::jsonb),
    'documents', COALESCE((SELECT jsonb_agg(to_jsonb(fd)) FROM public.fiscal_documents fd WHERE fd.id IN (SELECT id FROM _tmp_ms_doc_ids)), '[]'::jsonb),
    'totals', jsonb_build_object(
      'total_goods_value', v_total_goods,
      'total_freight_revenue', v_total_freight_rev,
      'route_result', v_route_result,
      'driver_credits_total', v_adj_credits,
      'driver_debits_total', v_adj_debits,
      'driver_payable_amount', v_payable,
      'total_paid_amount', v_total_paid,
      'payment_balance', v_payable - v_total_paid
    )
  );

  UPDATE public.driver_settlements SET
    route_origin = v_route_origin,
    route_destination = v_route_destination,
    loads_count = v_loads_count,
    documents_count = v_documents_count,
    total_invoice_value = v_total_goods,
    total_freight_value = v_total_freight_rev,
    total_weight_kg = v_total_weight,
    total_goods_value = v_total_goods,
    total_freight_revenue = v_total_freight_rev,
    route_result = v_route_result,
    approved_expenses_total = 0,
    pending_expenses_total = 0,
    rejected_expenses_total = 0,
    expenses_total = 0,
    driver_reimbursement_total = 0,
    driver_credits_total = v_adj_credits,
    driver_debits_total = v_adj_debits,
    driver_payable_amount = v_payable,
    manual_adjustments_total = v_adj_credits - v_adj_debits,
    total_paid_amount = v_total_paid,
    payment_balance = v_payable - v_total_paid,
    invoice_balance = v_total_goods,
    operational_balance = v_route_result,
    final_amount = v_payable,
    last_recalculated_at = now(),
    needs_recalculation = false,
    recalculation_reason = NULL,
    snapshot_json = v_snapshot
  WHERE id = _settlement_id;

  DELETE FROM public.driver_settlement_items
   WHERE settlement_id = _settlement_id AND item_type <> 'adjustment';

  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
  SELECT v_tenant, _settlement_id, 'load', 'loads', l.id,
         COALESCE(l.load_number, l.origin || ' → ' || l.destination), 0, l.total_weight_kg,
         jsonb_build_object('origin', l.origin, 'destination', l.destination, 'status', l.status, 'pallets', l.total_pallet_count)
  FROM public.loads l
  JOIN public.driver_settlement_loads dsl ON dsl.load_id = l.id
  WHERE dsl.settlement_id = _settlement_id;

  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
  SELECT v_tenant, _settlement_id, 'fiscal_document', 'fiscal_documents', fd.id,
         COALESCE(fd.invoice_number, fd.access_key), fd.value, fd.weight_kg,
         jsonb_build_object('document_type', fd.document_type, 'freight_value', fd.freight_value, 'recipient', fd.recipient, 'recipient_city', fd.recipient_city, 'recipient_state', fd.recipient_state, 'status', fd.status)
  FROM public.fiscal_documents fd
  WHERE fd.id IN (SELECT id FROM _tmp_ms_doc_ids);

  PERFORM public._log_settlement_event(_settlement_id, 'recalculated_manual', NULL, NULL, NULL,
    jsonb_build_object('loads', v_loads_count, 'documents', v_documents_count, 'freight', v_total_freight_rev, 'goods', v_total_goods));

  RETURN _settlement_id;
END;
$$;