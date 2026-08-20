
-- =========================================================
-- Driver Settlements (Acerto de Motoristas) - additive module
-- =========================================================

-- A) driver_settlements
CREATE TABLE IF NOT EXISTS public.driver_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  dispatch_trip_id uuid NOT NULL REFERENCES public.dispatch_trips(id) ON DELETE RESTRICT,
  driver_id uuid REFERENCES public.drivers(id),
  vehicle_id uuid REFERENCES public.vehicles(id),
  status text NOT NULL DEFAULT 'pending_review',
  trip_started_at timestamptz,
  trip_completed_at timestamptz,
  route_name text,
  route_origin text,
  route_destination text,
  loads_count integer DEFAULT 0,
  stops_count integer DEFAULT 0,
  documents_count integer DEFAULT 0,
  total_invoice_value numeric DEFAULT 0,
  total_freight_value numeric DEFAULT 0,
  total_weight_kg numeric DEFAULT 0,
  estimated_km numeric,
  audited_km numeric,
  km_review_status text DEFAULT 'pending',
  km_review_notes text,
  approved_expenses_total numeric DEFAULT 0,
  pending_expenses_total numeric DEFAULT 0,
  rejected_expenses_total numeric DEFAULT 0,
  expenses_total numeric DEFAULT 0,
  invoice_balance numeric DEFAULT 0,
  operational_balance numeric DEFAULT 0,
  manual_adjustments_total numeric DEFAULT 0,
  final_amount numeric DEFAULT 0,
  snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  paid_by uuid,
  paid_at timestamptz,
  closed_by uuid,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_settlements_trip_unique UNIQUE (tenant_id, dispatch_trip_id),
  CONSTRAINT driver_settlements_status_chk CHECK (status IN ('pending_review','in_review','approved','paid','closed','reopened')),
  CONSTRAINT driver_settlements_km_status_chk CHECK (km_review_status IN ('pending','reviewed','disputed'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_settlements TO authenticated;
GRANT ALL ON public.driver_settlements TO service_role;

CREATE INDEX IF NOT EXISTS idx_driver_settlements_tenant ON public.driver_settlements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_driver_settlements_trip ON public.driver_settlements(dispatch_trip_id);
CREATE INDEX IF NOT EXISTS idx_driver_settlements_driver ON public.driver_settlements(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_settlements_vehicle ON public.driver_settlements(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_driver_settlements_status ON public.driver_settlements(status);
CREATE INDEX IF NOT EXISTS idx_driver_settlements_completed ON public.driver_settlements(trip_completed_at);

ALTER TABLE public.driver_settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settlements_select" ON public.driver_settlements;
CREATE POLICY "settlements_select" ON public.driver_settlements FOR SELECT TO authenticated
USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "settlements_manage" ON public.driver_settlements;
CREATE POLICY "settlements_manage" ON public.driver_settlements FOR ALL TO authenticated
USING (public.is_tenant_operator_or_admin(tenant_id))
WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));

CREATE OR REPLACE FUNCTION public._touch_driver_settlements_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_driver_settlements_touch ON public.driver_settlements;
CREATE TRIGGER trg_driver_settlements_touch BEFORE UPDATE ON public.driver_settlements
FOR EACH ROW EXECUTE FUNCTION public._touch_driver_settlements_updated_at();

-- B) driver_settlement_items
CREATE TABLE IF NOT EXISTS public.driver_settlement_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  settlement_id uuid NOT NULL REFERENCES public.driver_settlements(id) ON DELETE CASCADE,
  item_type text NOT NULL,
  source_table text,
  source_id uuid,
  description text,
  amount numeric DEFAULT 0,
  quantity numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_settlement_items_type_chk CHECK (item_type IN ('load','fiscal_document','expense','adjustment','km'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_settlement_items TO authenticated;
GRANT ALL ON public.driver_settlement_items TO service_role;

CREATE INDEX IF NOT EXISTS idx_dsi_settlement ON public.driver_settlement_items(settlement_id);
CREATE INDEX IF NOT EXISTS idx_dsi_tenant ON public.driver_settlement_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dsi_type ON public.driver_settlement_items(item_type);
CREATE INDEX IF NOT EXISTS idx_dsi_source ON public.driver_settlement_items(source_id);

ALTER TABLE public.driver_settlement_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dsi_select" ON public.driver_settlement_items;
CREATE POLICY "dsi_select" ON public.driver_settlement_items FOR SELECT TO authenticated
USING (public.is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "dsi_manage" ON public.driver_settlement_items;
CREATE POLICY "dsi_manage" ON public.driver_settlement_items FOR ALL TO authenticated
USING (public.is_tenant_operator_or_admin(tenant_id))
WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));

-- =========================================================
-- RPC: generate_driver_settlement
-- =========================================================
CREATE OR REPLACE FUNCTION public.generate_driver_settlement(_tenant_id uuid, _dispatch_trip_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_trip record;
  v_settlement_id uuid;
  v_existing_status text;
  v_loads_count int := 0;
  v_stops_count int := 0;
  v_documents_count int := 0;
  v_total_invoice numeric := 0;
  v_total_freight numeric := 0;
  v_total_weight numeric := 0;
  v_estimated_km numeric;
  v_appr numeric := 0;
  v_pend numeric := 0;
  v_rej numeric := 0;
  v_exp_total numeric := 0;
  v_invoice_balance numeric := 0;
  v_operational_balance numeric := 0;
  v_manual_adj numeric := 0;
  v_final numeric := 0;
  v_route_origin text;
  v_route_destination text;
  v_route_name text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT dt.*
  INTO v_trip
  FROM public.dispatch_trips dt
  WHERE dt.id = _dispatch_trip_id AND dt.tenant_id = _tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_not_found';
  END IF;
  IF v_trip.status <> 'completed' THEN
    RAISE EXCEPTION 'trip_not_completed';
  END IF;

  SELECT id, status INTO v_settlement_id, v_existing_status
  FROM public.driver_settlements
  WHERE tenant_id = _tenant_id AND dispatch_trip_id = _dispatch_trip_id;

  IF v_settlement_id IS NOT NULL AND v_existing_status NOT IN ('pending_review','in_review','reopened') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;

  -- Collect load ids: trip.load_id + dispatch_trip_loads
  WITH load_ids AS (
    SELECT v_trip.load_id AS load_id WHERE v_trip.load_id IS NOT NULL
    UNION
    SELECT dtl.load_id FROM public.dispatch_trip_loads dtl
      WHERE dtl.dispatch_trip_id = _dispatch_trip_id AND dtl.load_id IS NOT NULL
  ),
  load_set AS (
    SELECT DISTINCT load_id FROM load_ids WHERE load_id IS NOT NULL
  ),
  doc_ids AS (
    SELECT DISTINCT fd.id
    FROM public.fiscal_documents fd
    JOIN load_set ls ON ls.load_id = fd.load_id
    WHERE fd.tenant_id = _tenant_id
    UNION
    SELECT DISTINCT dsd.fiscal_document_id AS id
    FROM public.dispatch_stop_documents dsd
    JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
    WHERE ds.dispatch_trip_id = _dispatch_trip_id
      AND dsd.fiscal_document_id IS NOT NULL
  )
  SELECT
    (SELECT count(*) FROM load_set),
    (SELECT count(*) FROM public.dispatch_stops WHERE dispatch_trip_id = _dispatch_trip_id),
    (SELECT count(*) FROM doc_ids),
    COALESCE((SELECT sum(fd.value) FROM public.fiscal_documents fd JOIN doc_ids d ON d.id = fd.id), 0),
    COALESCE((SELECT sum(fd.freight_value) FROM public.fiscal_documents fd JOIN doc_ids d ON d.id = fd.id), 0),
    COALESCE(
      NULLIF((SELECT sum(fd.weight_kg) FROM public.fiscal_documents fd JOIN doc_ids d ON d.id = fd.id), 0),
      COALESCE((SELECT sum(l.total_weight_kg) FROM public.loads l JOIN load_set ls ON ls.load_id = l.id), 0)
    )
  INTO v_loads_count, v_stops_count, v_documents_count, v_total_invoice, v_total_freight, v_total_weight;

  -- Estimated KM from trip_routes (try dispatch_trip_id then trip.load_id as trip_id fallback)
  SELECT (tr.distance_meters / 1000.0) INTO v_estimated_km
  FROM public.trip_routes tr
  WHERE tr.tenant_id = _tenant_id
    AND tr.provider = 'osrm'
    AND tr.trip_id = _dispatch_trip_id
  ORDER BY tr.created_at DESC LIMIT 1;

  -- Expenses
  SELECT
    COALESCE(sum(amount) FILTER (WHERE approval_status='approved'), 0),
    COALESCE(sum(amount) FILTER (WHERE approval_status='pending'), 0),
    COALESCE(sum(amount) FILTER (WHERE approval_status='rejected'), 0),
    COALESCE(sum(amount), 0)
  INTO v_appr, v_pend, v_rej, v_exp_total
  FROM public.driver_expenses
  WHERE tenant_id = _tenant_id AND dispatch_trip_id = _dispatch_trip_id;

  v_invoice_balance := v_total_invoice - v_appr;
  v_operational_balance := v_total_freight - v_appr;

  -- Route name/origin/destination heuristic: first stop ordered
  SELECT min(ds.destination), max(ds.destination)
  INTO v_route_origin, v_route_destination
  FROM public.dispatch_stops ds WHERE ds.dispatch_trip_id = _dispatch_trip_id;
  v_route_name := COALESCE(v_trip.notes, NULL);

  IF v_settlement_id IS NULL THEN
    INSERT INTO public.driver_settlements (
      tenant_id, dispatch_trip_id, driver_id, vehicle_id, status,
      trip_started_at, trip_completed_at, route_name, route_origin, route_destination,
      loads_count, stops_count, documents_count,
      total_invoice_value, total_freight_value, total_weight_kg,
      estimated_km,
      approved_expenses_total, pending_expenses_total, rejected_expenses_total, expenses_total,
      invoice_balance, operational_balance, manual_adjustments_total, final_amount,
      created_by
    ) VALUES (
      _tenant_id, _dispatch_trip_id, v_trip.driver_id, v_trip.vehicle_id, 'pending_review',
      v_trip.actual_start_at, v_trip.actual_end_at, v_route_name, v_route_origin, v_route_destination,
      v_loads_count, v_stops_count, v_documents_count,
      v_total_invoice, v_total_freight, v_total_weight,
      v_estimated_km,
      v_appr, v_pend, v_rej, v_exp_total,
      v_invoice_balance, v_operational_balance, 0, v_operational_balance,
      v_user
    ) RETURNING id INTO v_settlement_id;
  ELSE
    SELECT manual_adjustments_total INTO v_manual_adj FROM public.driver_settlements WHERE id = v_settlement_id;
    v_final := v_operational_balance + COALESCE(v_manual_adj, 0);
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
      total_invoice_value = v_total_invoice,
      total_freight_value = v_total_freight,
      total_weight_kg = v_total_weight,
      estimated_km = v_estimated_km,
      approved_expenses_total = v_appr,
      pending_expenses_total = v_pend,
      rejected_expenses_total = v_rej,
      expenses_total = v_exp_total,
      invoice_balance = v_invoice_balance,
      operational_balance = v_operational_balance,
      final_amount = v_final
    WHERE id = v_settlement_id;
  END IF;

  -- Rebuild items
  DELETE FROM public.driver_settlement_items WHERE settlement_id = v_settlement_id;

  -- Loads
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

  -- Fiscal documents (distinct)
  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
  SELECT _tenant_id, v_settlement_id, 'fiscal_document', 'fiscal_documents', fd.id,
         COALESCE(fd.invoice_number, fd.access_key), fd.value, fd.weight_kg,
         jsonb_build_object('freight_value', fd.freight_value, 'recipient', fd.recipient, 'recipient_city', fd.recipient_city, 'recipient_state', fd.recipient_state, 'status', fd.status)
  FROM public.fiscal_documents fd
  WHERE fd.id IN (
    SELECT DISTINCT fd2.id FROM public.fiscal_documents fd2
    WHERE fd2.tenant_id = _tenant_id AND fd2.load_id IN (
      SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
      UNION
      SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
    )
    UNION
    SELECT DISTINCT dsd.fiscal_document_id FROM public.dispatch_stop_documents dsd
    JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
    WHERE ds.dispatch_trip_id = _dispatch_trip_id AND dsd.fiscal_document_id IS NOT NULL
  );

  -- Expenses
  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
  SELECT _tenant_id, v_settlement_id, 'expense', 'driver_expenses', de.id,
         de.category, de.amount, NULL,
         jsonb_build_object('approval_status', de.approval_status, 'expense_at', de.expense_at, 'receipt_url', de.receipt_url, 'notes', de.notes)
  FROM public.driver_expenses de
  WHERE de.tenant_id = _tenant_id AND de.dispatch_trip_id = _dispatch_trip_id;

  -- KM item
  IF v_estimated_km IS NOT NULL THEN
    INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
    VALUES (_tenant_id, v_settlement_id, 'km', 'trip_routes', NULL, 'KM estimado (OSRM)', 0, v_estimated_km, jsonb_build_object('provider','osrm'));
  END IF;

  RETURN v_settlement_id;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_driver_settlement(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_driver_settlement(uuid, uuid) TO authenticated;

-- =========================================================
-- RPC: generate_pending_driver_settlements
-- =========================================================
CREATE OR REPLACE FUNCTION public.generate_pending_driver_settlements(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_trip_id uuid;
  v_generated int := 0;
  v_skipped int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  FOR v_trip_id IN
    SELECT dt.id FROM public.dispatch_trips dt
    LEFT JOIN public.driver_settlements ds ON ds.dispatch_trip_id = dt.id AND ds.tenant_id = dt.tenant_id
    WHERE dt.tenant_id = _tenant_id AND dt.status = 'completed' AND ds.id IS NULL
  LOOP
    BEGIN
      PERFORM public.generate_driver_settlement(_tenant_id, v_trip_id);
      v_generated := v_generated + 1;
    EXCEPTION WHEN OTHERS THEN
      v_skipped := v_skipped + 1;
      v_errors := v_errors || jsonb_build_object('trip_id', v_trip_id, 'error', SQLERRM);
    END;
  END LOOP;

  RETURN jsonb_build_object('generated', v_generated, 'skipped', v_skipped, 'errors', v_errors);
END;
$$;

REVOKE ALL ON FUNCTION public.generate_pending_driver_settlements(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_pending_driver_settlements(uuid) TO authenticated;

-- =========================================================
-- RPC: update_driver_settlement_status
-- =========================================================
CREATE OR REPLACE FUNCTION public.update_driver_settlement_status(_settlement_id uuid, _new_status text)
RETURNS public.driver_settlements
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_s public.driver_settlements;
  v_allowed boolean := false;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Allowed transitions
  v_allowed := CASE
    WHEN v_s.status = 'pending_review' AND _new_status IN ('in_review') THEN true
    WHEN v_s.status = 'in_review' AND _new_status IN ('approved','pending_review') THEN true
    WHEN v_s.status = 'approved' AND _new_status IN ('paid') THEN true
    WHEN v_s.status = 'paid' AND _new_status IN ('closed') THEN true
    WHEN v_s.status = 'closed' AND _new_status = 'reopened' THEN public.is_tenant_admin(v_s.tenant_id)
    WHEN v_s.status = 'paid' AND _new_status = 'reopened' THEN public.is_tenant_admin(v_s.tenant_id)
    WHEN v_s.status = 'reopened' AND _new_status IN ('in_review','approved') THEN true
    ELSE false
  END;

  IF NOT v_allowed THEN RAISE EXCEPTION 'invalid_transition'; END IF;

  UPDATE public.driver_settlements SET
    status = _new_status,
    reviewed_by = CASE WHEN _new_status='in_review' THEN v_user ELSE reviewed_by END,
    reviewed_at = CASE WHEN _new_status='in_review' THEN now() ELSE reviewed_at END,
    approved_by = CASE WHEN _new_status='approved' THEN v_user ELSE approved_by END,
    approved_at = CASE WHEN _new_status='approved' THEN now() ELSE approved_at END,
    paid_by = CASE WHEN _new_status='paid' THEN v_user ELSE paid_by END,
    paid_at = CASE WHEN _new_status='paid' THEN now() ELSE paid_at END,
    closed_by = CASE WHEN _new_status='closed' THEN v_user ELSE closed_by END,
    closed_at = CASE WHEN _new_status='closed' THEN now() ELSE closed_at END
  WHERE id = _settlement_id
  RETURNING * INTO v_s;

  RETURN v_s;
END;
$$;

REVOKE ALL ON FUNCTION public.update_driver_settlement_status(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_driver_settlement_status(uuid, text) TO authenticated;

-- =========================================================
-- RPC: update_settlement_km_review
-- =========================================================
CREATE OR REPLACE FUNCTION public.update_settlement_km_review(_settlement_id uuid, _audited_km numeric, _km_status text, _notes text)
RETURNS public.driver_settlements
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE v_s public.driver_settlements;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_s.status NOT IN ('pending_review','in_review','reopened') THEN RAISE EXCEPTION 'settlement_locked'; END IF;
  IF _km_status NOT IN ('pending','reviewed','disputed') THEN RAISE EXCEPTION 'invalid_km_status'; END IF;

  UPDATE public.driver_settlements SET
    audited_km = _audited_km,
    km_review_status = _km_status,
    km_review_notes = _notes
  WHERE id = _settlement_id RETURNING * INTO v_s;
  RETURN v_s;
END;
$$;

REVOKE ALL ON FUNCTION public.update_settlement_km_review(uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_settlement_km_review(uuid, numeric, text, text) TO authenticated;

-- =========================================================
-- Trigger: when dispatch_trips is marked completed, create stub settlement
-- =========================================================
CREATE OR REPLACE FUNCTION public._on_dispatch_trip_completed_create_settlement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    BEGIN
      INSERT INTO public.driver_settlements (tenant_id, dispatch_trip_id, driver_id, vehicle_id, status, trip_started_at, trip_completed_at)
      VALUES (NEW.tenant_id, NEW.id, NEW.driver_id, NEW.vehicle_id, 'pending_review', NEW.actual_start_at, NEW.actual_end_at)
      ON CONFLICT (tenant_id, dispatch_trip_id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
      -- never block trip completion
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispatch_trip_completed_settlement ON public.dispatch_trips;
CREATE TRIGGER trg_dispatch_trip_completed_settlement
AFTER UPDATE OF status ON public.dispatch_trips
FOR EACH ROW EXECUTE FUNCTION public._on_dispatch_trip_completed_create_settlement();
