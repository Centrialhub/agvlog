
-- 1) Allow manual settlements (no trip)
ALTER TABLE public.driver_settlements
  ALTER COLUMN dispatch_trip_id DROP NOT NULL;

ALTER TABLE public.driver_settlements
  ADD COLUMN IF NOT EXISTS is_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS manual_reference_date date;

-- 2) Link table: settlement <-> loads (exclusive)
CREATE TABLE IF NOT EXISTS public.driver_settlement_loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  settlement_id uuid NOT NULL REFERENCES public.driver_settlements(id) ON DELETE CASCADE,
  load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (load_id)
);
CREATE INDEX IF NOT EXISTS idx_dsl_settlement ON public.driver_settlement_loads(settlement_id);
CREATE INDEX IF NOT EXISTS idx_dsl_tenant ON public.driver_settlement_loads(tenant_id);

GRANT SELECT ON public.driver_settlement_loads TO authenticated;
GRANT ALL ON public.driver_settlement_loads TO service_role;

ALTER TABLE public.driver_settlement_loads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dsl_tenant_select" ON public.driver_settlement_loads
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_memberships tm WHERE tm.user_id = auth.uid()));

-- 3) Build manual settlement (recalculate totals from linked loads)
CREATE OR REPLACE FUNCTION public._build_manual_driver_settlement(_settlement_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_s record;
  v_tenant uuid;
  v_status text;
  v_loads_count int := 0;
  v_documents_count int := 0;
  v_total_goods numeric := 0;
  v_total_freight_rev numeric := 0;
  v_total_weight numeric := 0;
  v_appr numeric := 0;
  v_pend numeric := 0;
  v_rej numeric := 0;
  v_exp_total numeric := 0;
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
  v_tenant := v_s.tenant_id;
  v_status := v_s.status;
  IF v_status NOT IN ('pending_review','in_review','reopened') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;

  -- distinct fiscal doc ids from linked loads
  CREATE TEMP TABLE IF NOT EXISTS _tmp_ms_doc_ids (id uuid PRIMARY KEY) ON COMMIT DROP;
  DELETE FROM _tmp_ms_doc_ids;
  INSERT INTO _tmp_ms_doc_ids(id)
  SELECT DISTINCT fd.id
    FROM public.fiscal_documents fd
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

  -- expenses for this driver, excluding those already tied to another trip settlement
  IF v_s.driver_id IS NOT NULL THEN
    SELECT
      COALESCE(sum(amount) FILTER (WHERE approval_status='approved'),0),
      COALESCE(sum(amount) FILTER (WHERE approval_status='pending'),0),
      COALESCE(sum(amount) FILTER (WHERE approval_status='rejected'),0),
      COALESCE(sum(amount),0),
      COALESCE(sum(amount) FILTER (WHERE approval_status='approved' AND COALESCE(reimbursable,true)=true),0)
    INTO v_appr, v_pend, v_rej, v_exp_total, v_appr_reimb
    FROM public.driver_expenses de
    WHERE de.tenant_id = v_tenant
      AND de.driver_id = v_s.driver_id
      AND de.dispatch_trip_id IS NULL
      AND (de.manual_settlement_id = _settlement_id OR de.manual_settlement_id IS NULL AND false);
    -- Note: driver_expenses may not have manual_settlement_id column; guard below.
  END IF;

  -- origin/destination from first/last linked load
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

-- Fix: driver_expenses may lack manual_settlement_id; redefine to avoid it.
CREATE OR REPLACE FUNCTION public._build_manual_driver_settlement(_settlement_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
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
  DELETE FROM _tmp_ms_doc_ids;
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

-- 4) Check helper: is load available for a new manual settlement (or attaching to given one)?
CREATE OR REPLACE FUNCTION public._load_available_for_settlement(_tenant_id uuid, _load_id uuid, _allow_settlement_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.driver_settlement_loads dsl
     WHERE dsl.load_id = _load_id
       AND dsl.tenant_id = _tenant_id
       AND (_allow_settlement_id IS NULL OR dsl.settlement_id <> _allow_settlement_id)
  ) AND NOT EXISTS (
    -- automatic settlements: load referenced via dispatch_trip
    SELECT 1
      FROM public.driver_settlements ds
      JOIN public.dispatch_trips dt ON dt.id = ds.dispatch_trip_id
     WHERE ds.tenant_id = _tenant_id
       AND ds.status IN ('pending_review','in_review','approved','paid','closed','reopened')
       AND (
         dt.load_id = _load_id
         OR EXISTS (SELECT 1 FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = dt.id AND dtl.load_id = _load_id)
       )
  );
$$;

-- 5) Create manual settlement
CREATE OR REPLACE FUNCTION public.create_manual_driver_settlement(
  _tenant_id uuid,
  _driver_id uuid,
  _vehicle_id uuid,
  _reference_date date,
  _load_ids uuid[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_load uuid;
BEGIN
  IF _driver_id IS NULL THEN RAISE EXCEPTION 'driver_required'; END IF;
  IF _load_ids IS NULL OR array_length(_load_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'no_loads_selected';
  END IF;

  INSERT INTO public.driver_settlements (
    tenant_id, dispatch_trip_id, driver_id, vehicle_id, status,
    is_manual, manual_reference_date,
    trip_started_at, trip_completed_at,
    route_name, route_origin, route_destination,
    loads_count, stops_count, documents_count,
    total_invoice_value, total_freight_value, total_weight_kg,
    total_goods_value, total_freight_revenue, route_result,
    approved_expenses_total, pending_expenses_total, rejected_expenses_total, expenses_total,
    driver_reimbursement_total, invoice_balance, operational_balance,
    last_recalculated_at, needs_recalculation, recalculation_reason, created_by
  ) VALUES (
    _tenant_id, NULL, _driver_id, _vehicle_id, 'pending_review',
    true, COALESCE(_reference_date, current_date),
    NULL, (COALESCE(_reference_date, current_date))::timestamptz,
    'Acerto manual', NULL, NULL,
    0, 0, 0,
    0, 0, 0,
    0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0,
    now(), false, NULL, auth.uid()
  ) RETURNING id INTO v_id;

  FOREACH v_load IN ARRAY _load_ids LOOP
    IF NOT public._load_available_for_settlement(_tenant_id, v_load, NULL) THEN
      RAISE EXCEPTION 'load_already_linked: %', v_load;
    END IF;
    INSERT INTO public.driver_settlement_loads(tenant_id, settlement_id, load_id, created_by)
    VALUES (_tenant_id, v_id, v_load, auth.uid());
  END LOOP;

  PERFORM public._log_settlement_event(v_id, 'created_manual', NULL, NULL, NULL,
    jsonb_build_object('loads', array_length(_load_ids,1), 'driver_id', _driver_id));

  PERFORM public._build_manual_driver_settlement(v_id);
  RETURN v_id;
END;
$$;

-- 6) Attach loads
CREATE OR REPLACE FUNCTION public.attach_loads_to_driver_settlement(
  _settlement_id uuid, _load_ids uuid[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_s record;
  v_load uuid;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF NOT v_s.is_manual THEN RAISE EXCEPTION 'not_manual_settlement'; END IF;
  IF v_s.status NOT IN ('pending_review','in_review','reopened') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;

  IF _load_ids IS NULL OR array_length(_load_ids,1) IS NULL THEN RETURN; END IF;
  FOREACH v_load IN ARRAY _load_ids LOOP
    IF NOT public._load_available_for_settlement(v_s.tenant_id, v_load, _settlement_id) THEN
      RAISE EXCEPTION 'load_already_linked: %', v_load;
    END IF;
    INSERT INTO public.driver_settlement_loads(tenant_id, settlement_id, load_id, created_by)
    VALUES (v_s.tenant_id, _settlement_id, v_load, auth.uid())
    ON CONFLICT (load_id) DO NOTHING;
  END LOOP;

  PERFORM public._log_settlement_event(_settlement_id, 'loads_attached', NULL, NULL, NULL,
    jsonb_build_object('count', array_length(_load_ids,1)));

  PERFORM public._build_manual_driver_settlement(_settlement_id);
END;
$$;

-- 7) Detach load
CREATE OR REPLACE FUNCTION public.detach_load_from_driver_settlement(
  _settlement_id uuid, _load_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_s record;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF NOT v_s.is_manual THEN RAISE EXCEPTION 'not_manual_settlement'; END IF;
  IF v_s.status NOT IN ('pending_review','in_review','reopened') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;

  DELETE FROM public.driver_settlement_loads
   WHERE settlement_id = _settlement_id AND load_id = _load_id;

  PERFORM public._log_settlement_event(_settlement_id, 'load_detached', NULL, NULL, NULL,
    jsonb_build_object('load_id', _load_id));

  PERFORM public._build_manual_driver_settlement(_settlement_id);
END;
$$;

-- 8) List available loads for linking
CREATE OR REPLACE FUNCTION public.list_available_loads_for_settlement(
  _tenant_id uuid,
  _driver_id uuid DEFAULT NULL,
  _search text DEFAULT NULL,
  _include_settlement_id uuid DEFAULT NULL,
  _limit int DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v
  FROM (
    SELECT
      l.id,
      l.load_number,
      l.origin,
      l.destination,
      l.status,
      l.total_weight_kg,
      l.total_pallet_count,
      l.gross_cargo_value,
      l.freight_amount,
      l.invoice_count,
      l.load_date,
      l.driver_id,
      d.name AS driver_name,
      v.plate AS vehicle_plate
    FROM public.loads l
    LEFT JOIN public.drivers d ON d.id = l.driver_id
    LEFT JOIN public.vehicles v ON v.id = l.vehicle_id
    WHERE l.tenant_id = _tenant_id
      AND (_driver_id IS NULL OR l.driver_id = _driver_id OR l.driver_id IS NULL)
      AND (_search IS NULL OR _search = '' OR
           l.load_number ILIKE '%'||_search||'%' OR
           l.origin ILIKE '%'||_search||'%' OR
           l.destination ILIKE '%'||_search||'%' OR
           l.external_load_number ILIKE '%'||_search||'%')
      AND public._load_available_for_settlement(_tenant_id, l.id, _include_settlement_id)
    ORDER BY l.load_date DESC NULLS LAST, l.created_at DESC
    LIMIT _limit
  ) x;
  RETURN v;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_manual_driver_settlement(uuid,uuid,uuid,date,uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_loads_to_driver_settlement(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detach_load_from_driver_settlement(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_available_loads_for_settlement(uuid, uuid, text, uuid, int) TO authenticated;
