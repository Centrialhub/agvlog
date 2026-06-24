
-- =========================================================================
-- 1) Bloquear role='client' em tenant_memberships
-- =========================================================================
CREATE OR REPLACE FUNCTION public._block_client_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role = 'client' THEN
    RAISE EXCEPTION 'role_client_not_allowed_in_memberships'
      USING HINT = 'Use client_portal_access para acesso de cliente externo.',
            ERRCODE = '22023';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_block_client_membership ON public.tenant_memberships;
CREATE TRIGGER trg_block_client_membership
  BEFORE INSERT OR UPDATE OF role ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION public._block_client_membership();

UPDATE public.tenant_memberships SET active = false, updated_at = now()
 WHERE role = 'client' AND active = true;

-- =========================================================================
-- 2) Helpers
-- =========================================================================
CREATE OR REPLACE FUNCTION public.is_user_internal_role(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.tenant_memberships
    WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true
      AND role IN ('owner','admin','operator'));
$$;

CREATE OR REPLACE FUNCTION public._driver_load_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT dtl.load_id FROM public.dispatch_trip_loads dtl
  JOIN public.dispatch_trips dt ON dt.id = dtl.dispatch_trip_id
  JOIN public.drivers d ON d.id = dt.driver_id
  WHERE d.user_id = auth.uid() AND d.active = true
  UNION
  SELECT l.id FROM public.loads l
  JOIN public.dispatch_trips dt ON dt.id = l.trip_id
  JOIN public.drivers d ON d.id = dt.driver_id
  WHERE d.user_id = auth.uid() AND d.active = true;
$$;

CREATE OR REPLACE FUNCTION public._driver_fiscal_document_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.fiscal_documents WHERE load_id IN (SELECT public._driver_load_ids());
$$;

CREATE OR REPLACE FUNCTION public._driver_order_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT lo.order_id FROM public.load_orders lo
  WHERE lo.load_id IN (SELECT public._driver_load_ids());
$$;

CREATE OR REPLACE FUNCTION public._driver_client_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT client_id FROM public.fiscal_documents
   WHERE load_id IN (SELECT public._driver_load_ids()) AND client_id IS NOT NULL
  UNION
  SELECT DISTINCT client_id FROM public.orders
   WHERE id IN (SELECT public._driver_order_ids()) AND client_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public._driver_pickup_order_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT pickup_order_id FROM public.fiscal_documents
   WHERE load_id IN (SELECT public._driver_load_ids()) AND pickup_order_id IS NOT NULL;
$$;

-- =========================================================================
-- 3) Policies por role
-- =========================================================================
DROP POLICY IF EXISTS "Members can view clients" ON public.clients;
CREATE POLICY "Internal roles view clients" ON public.clients FOR SELECT TO authenticated
  USING (public.is_user_internal_role(tenant_id));
CREATE POLICY "Drivers view own trip clients" ON public.clients FOR SELECT TO authenticated
  USING (id IN (SELECT public._driver_client_ids()));

DROP POLICY IF EXISTS "Members can view orders" ON public.orders;
CREATE POLICY "Internal roles view orders" ON public.orders FOR SELECT TO authenticated
  USING (public.is_user_internal_role(tenant_id));
CREATE POLICY "Drivers view own trip orders" ON public.orders FOR SELECT TO authenticated
  USING (id IN (SELECT public._driver_order_ids()));

DROP POLICY IF EXISTS "Members can view fiscal_documents" ON public.fiscal_documents;
CREATE POLICY "Internal roles view fiscal_documents" ON public.fiscal_documents FOR SELECT TO authenticated
  USING (public.is_user_internal_role(tenant_id));
CREATE POLICY "Drivers view own trip fiscal_documents" ON public.fiscal_documents FOR SELECT TO authenticated
  USING (id IN (SELECT public._driver_fiscal_document_ids()));

DROP POLICY IF EXISTS "Members can view loads" ON public.loads;
CREATE POLICY "Internal roles view loads" ON public.loads FOR SELECT TO authenticated
  USING (public.is_user_internal_role(tenant_id));
CREATE POLICY "Drivers view own trip loads" ON public.loads FOR SELECT TO authenticated
  USING (id IN (SELECT public._driver_load_ids()));

DROP POLICY IF EXISTS "Members can view load_orders" ON public.load_orders;
CREATE POLICY "Internal roles view load_orders" ON public.load_orders FOR SELECT TO authenticated
  USING (public.is_user_internal_role(tenant_id));
CREATE POLICY "Drivers view own trip load_orders" ON public.load_orders FOR SELECT TO authenticated
  USING (load_id IN (SELECT public._driver_load_ids()));

DROP POLICY IF EXISTS "Tenant members can view pickup orders" ON public.pickup_orders;
DROP POLICY IF EXISTS "Tenant members can insert pickup orders" ON public.pickup_orders;
DROP POLICY IF EXISTS "Tenant members can update pickup orders" ON public.pickup_orders;
CREATE POLICY "Internal roles view pickup_orders" ON public.pickup_orders FOR SELECT TO authenticated
  USING (public.is_user_internal_role(tenant_id));
CREATE POLICY "Internal roles insert pickup_orders" ON public.pickup_orders FOR INSERT TO authenticated
  WITH CHECK (public.is_user_internal_role(tenant_id));
CREATE POLICY "Internal roles update pickup_orders" ON public.pickup_orders FOR UPDATE TO authenticated
  USING (public.is_user_internal_role(tenant_id)) WITH CHECK (public.is_user_internal_role(tenant_id));
CREATE POLICY "Drivers view own trip pickup_orders" ON public.pickup_orders FOR SELECT TO authenticated
  USING (id IN (SELECT public._driver_pickup_order_ids()));

DROP POLICY IF EXISTS "Members can view operational_events" ON public.operational_events;
CREATE POLICY "Internal roles view operational_events" ON public.operational_events FOR SELECT TO authenticated
  USING (public.is_user_internal_role(tenant_id));
CREATE POLICY "Drivers view own trip operational_events" ON public.operational_events FOR SELECT TO authenticated
  USING (
    load_id IN (SELECT public._driver_load_ids())
    OR driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Tenant members read dispatch_trip_loads" ON public.dispatch_trip_loads;
DROP POLICY IF EXISTS "Tenant members write dispatch_trip_loads" ON public.dispatch_trip_loads;
DROP POLICY IF EXISTS "Tenant members update dispatch_trip_loads" ON public.dispatch_trip_loads;
DROP POLICY IF EXISTS "Tenant members delete dispatch_trip_loads" ON public.dispatch_trip_loads;
CREATE POLICY "Internal roles manage dispatch_trip_loads" ON public.dispatch_trip_loads FOR ALL TO authenticated
  USING (public.is_user_internal_role(tenant_id)) WITH CHECK (public.is_user_internal_role(tenant_id));
CREATE POLICY "Drivers view own trip dispatch_trip_loads" ON public.dispatch_trip_loads FOR SELECT TO authenticated
  USING (dispatch_trip_id IN (SELECT _driver_trip_ids()));

-- =========================================================================
-- 4) Storage receipts UPDATE/DELETE só interno
-- =========================================================================
DROP POLICY IF EXISTS "receipts_tenant_update" ON storage.objects;
DROP POLICY IF EXISTS "receipts_tenant_delete" ON storage.objects;
CREATE POLICY "receipts_tenant_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND public.is_user_internal_role(((storage.foldername(name))[1])::uuid)
  ) WITH CHECK (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND public.is_user_internal_role(((storage.foldername(name))[1])::uuid)
  );
CREATE POLICY "receipts_tenant_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'receipts'
    AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
    AND public.is_user_internal_role(((storage.foldername(name))[1])::uuid)
  );

-- =========================================================================
-- 5) portal_user_can_view_financial
-- =========================================================================
CREATE OR REPLACE FUNCTION public.portal_user_can_view_financial(_tenant_id uuid, _fiscal_document_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.fiscal_documents fd
    JOIN public.client_portal_access cpa
      ON cpa.tenant_id = fd.tenant_id AND cpa.user_id = auth.uid()
     AND cpa.active = true AND cpa.can_view_financial = true
    LEFT JOIN public.clients c ON c.id = cpa.client_id
    WHERE fd.id = _fiscal_document_id AND fd.tenant_id = _tenant_id
      AND (
        cpa.client_id = fd.client_id
        OR (cpa.access_type IN ('remitter','full','financial','documents_only')
            AND c.tax_id IS NOT NULL AND c.tax_id = fd.remitter_cnpj)
        OR (cpa.access_type IN ('recipient','full','financial','documents_only')
            AND c.tax_id IS NOT NULL AND c.tax_id = fd.recipient_cnpj)
        OR (cpa.access_type = 'full' AND c.tax_id IS NOT NULL
            AND c.tax_id IN (fd.remitter_cnpj, fd.recipient_cnpj))
      )
  );
$$;

-- =========================================================================
-- 6) Helpers de portal (pickup_orders / operational_events)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.portal_user_can_access_pickup_order(_tenant_id uuid, _pickup_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.pickup_orders po
    JOIN public.client_portal_access cpa
      ON cpa.tenant_id = po.tenant_id AND cpa.user_id = auth.uid() AND cpa.active = true
    LEFT JOIN public.clients c ON c.id = cpa.client_id
    WHERE po.id = _pickup_order_id AND po.tenant_id = _tenant_id
      AND (
        cpa.client_id = po.remitter_client_id
        OR (cpa.access_type IN ('remitter','full','documents_only','financial')
            AND c.tax_id IS NOT NULL AND c.tax_id = po.remitter_cnpj)
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.portal_user_can_access_operational_event(_tenant_id uuid, _event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.operational_events oe
    WHERE oe.id = _event_id AND oe.tenant_id = _tenant_id AND oe.visible_to_client = true
      AND (
        (oe.client_id IS NOT NULL
         AND oe.client_id IN (SELECT unnest(public._portal_user_client_ids(_tenant_id))))
        OR (oe.load_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.fiscal_documents fd
              WHERE fd.load_id = oe.load_id
                AND public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)))
      )
  );
$$;

-- =========================================================================
-- 7) search_client_portal_shipments
-- =========================================================================
CREATE OR REPLACE FUNCTION public.search_client_portal_shipments(
  _tenant_id uuid, _search text DEFAULT NULL, _status text[] DEFAULT NULL,
  _start_date date DEFAULT NULL, _end_date date DEFAULT NULL,
  _city text DEFAULT NULL, _state text DEFAULT NULL,
  _has_pod boolean DEFAULT NULL, _has_occurrence boolean DEFAULT NULL,
  _limit int DEFAULT 50, _offset int DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _rows jsonb; _total int; _search_norm text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.client_portal_access
                WHERE tenant_id=_tenant_id AND user_id=auth.uid() AND active=true) THEN
    RETURN jsonb_build_object('rows','[]'::jsonb,'total',0);
  END IF;
  _search_norm := NULLIF(trim(_search), '');

  WITH base AS (
    SELECT fd.id AS fiscal_document_id, fd.tenant_id, fd.client_id,
      fd.invoice_number, fd.access_key, fd.issue_date, fd.document_type,
      fd.status AS document_status, fd.client_load_number, fd.reference_number,
      fd.remitter, fd.remitter_cnpj, fd.recipient, fd.recipient_cnpj,
      fd.recipient_city, fd.recipient_state, fd.recipient_neighborhood,
      fd.product_summary, fd.pallet_count, fd.weight_kg,
      CASE WHEN public.portal_user_can_view_financial(_tenant_id, fd.id) THEN fd.value END AS value,
      CASE WHEN public.portal_user_can_view_financial(_tenant_id, fd.id) THEN fd.freight_value END AS freight_value,
      fd.load_id, fd.pickup_order_id, fd.updated_at,
      l.load_number, l.status AS load_status, l.trip_id,
      ds.id AS dispatch_stop_id, ds.status AS stop_status,
      ds.planned_arrival_at, ds.actual_arrival_at, ds.actual_departure_at,
      EXISTS (SELECT 1 FROM public.proof_of_delivery p
              WHERE p.fiscal_document_id = fd.id AND p.status IN ('uploaded','validated')) AS has_pod,
      EXISTS (SELECT 1 FROM public.operational_events oe
              WHERE oe.tenant_id = _tenant_id AND oe.visible_to_client = true AND oe.public_status = 'open'
                AND oe.load_id = fd.load_id AND oe.client_id = fd.client_id) AS has_open_occurrence
    FROM public.fiscal_documents fd
    LEFT JOIN public.loads l ON l.id = fd.load_id
    LEFT JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
    LEFT JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
    WHERE fd.tenant_id = _tenant_id
      AND public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
      AND (_start_date IS NULL OR fd.issue_date >= _start_date)
      AND (_end_date   IS NULL OR fd.issue_date <= _end_date)
      AND (_city  IS NULL OR fd.recipient_city  ILIKE _city)
      AND (_state IS NULL OR fd.recipient_state ILIKE _state)
      AND (_status IS NULL OR fd.status = ANY(_status))
      AND ( _search_norm IS NULL
            OR fd.invoice_number ILIKE '%' || _search_norm || '%'
            OR fd.access_key ILIKE '%' || _search_norm || '%'
            OR fd.client_load_number ILIKE '%' || _search_norm || '%'
            OR fd.reference_number ILIKE '%' || _search_norm || '%'
            OR fd.recipient ILIKE '%' || _search_norm || '%'
            OR fd.recipient_cnpj ILIKE '%' || _search_norm || '%'
            OR fd.recipient_city ILIKE '%' || _search_norm || '%'
            OR COALESCE(l.load_number,'') ILIKE '%' || _search_norm || '%' )
  ),
  filtered AS (
    SELECT * FROM base
    WHERE (_has_pod IS NULL OR has_pod = _has_pod)
      AND (_has_occurrence IS NULL OR has_open_occurrence = _has_occurrence)
  )
  SELECT COALESCE(jsonb_agg(row_to_jsonb(f) ORDER BY f.issue_date DESC NULLS LAST, f.updated_at DESC), '[]'::jsonb),
         (SELECT count(*) FROM filtered)
  INTO _rows, _total
  FROM (SELECT * FROM filtered ORDER BY issue_date DESC NULLS LAST, updated_at DESC
        LIMIT _limit OFFSET _offset) f;

  RETURN jsonb_build_object('rows', _rows, 'total', _total);
END; $$;

-- =========================================================================
-- 8) get_client_portal_summary
-- =========================================================================
CREATE OR REPLACE FUNCTION public.get_client_portal_summary(_tenant_id uuid, _start_date date DEFAULT NULL, _end_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _result jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.client_portal_access
                WHERE tenant_id=_tenant_id AND user_id=auth.uid() AND active=true) THEN
    RETURN jsonb_build_object('in_transit',0,'delivered',0,'delayed',0,'pending_pickup',0,
      'pending_pod',0,'open_occurrences',0,'deliveries_today',0,'deliveries_tomorrow',0);
  END IF;

  WITH fds AS (
    SELECT fd.* FROM public.fiscal_documents fd
    WHERE fd.tenant_id = _tenant_id
      AND public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
      AND (_start_date IS NULL OR fd.issue_date >= _start_date)
      AND (_end_date   IS NULL OR fd.issue_date <= _end_date)
  )
  SELECT jsonb_build_object(
    'in_transit', (SELECT count(*) FROM fds WHERE status IN ('in_transit','loading','loaded')),
    'delivered',  (SELECT count(*) FROM fds WHERE status = 'delivered'),
    'delayed',    (SELECT count(*) FROM fds fd
                   JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                   JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                   WHERE ds.status IN ('pending','arriving','arrived','in_progress')
                     AND ds.planned_arrival_at < now()),
    'pending_pickup', (SELECT count(DISTINCT po.id) FROM public.pickup_orders po
                       WHERE po.tenant_id = _tenant_id AND po.status IN ('pendente','vinculada')
                         AND public.portal_user_can_access_pickup_order(_tenant_id, po.id)),
    'pending_pod', (SELECT count(*) FROM fds fd WHERE fd.status='delivered'
                    AND NOT EXISTS (SELECT 1 FROM public.proof_of_delivery p
                                    WHERE p.fiscal_document_id = fd.id AND p.status IN ('uploaded','validated'))),
    'open_occurrences', (SELECT count(*) FROM public.operational_events oe
                         WHERE oe.tenant_id = _tenant_id AND oe.visible_to_client = true
                           AND oe.public_status = 'open'
                           AND public.portal_user_can_access_operational_event(_tenant_id, oe.id)),
    'deliveries_today', (SELECT count(*) FROM fds fd
                          JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                          JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                          WHERE ds.planned_arrival_at::date = CURRENT_DATE),
    'deliveries_tomorrow', (SELECT count(*) FROM fds fd
                             JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                             JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                             WHERE ds.planned_arrival_at::date = CURRENT_DATE + 1)
  ) INTO _result;
  RETURN _result;
END; $$;

-- =========================================================================
-- 9) driver_update_stop_status
-- =========================================================================
CREATE OR REPLACE FUNCTION public.driver_update_stop_status(
  _stop_id uuid, _new_status text, _reason text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trip uuid; v_tenant uuid; v_event_type text; v_event uuid; v_current text;
  v_terminal text[] := public.stop_terminal_statuses();
  v_pending int; v_load_id uuid;
  v_load_terminals text[]; v_new_load_status text;
BEGIN
  IF _new_status NOT IN (
    'partial_delivery','refused','damaged','returned','skipped',
    'cancelled','failed','delivered','completed','arrived','departed'
  ) THEN RAISE EXCEPTION 'invalid_status'; END IF;

  SELECT dispatch_trip_id, tenant_id, status INTO v_trip, v_tenant, v_current
  FROM public.dispatch_stops WHERE id = _stop_id;
  IF v_trip IS NULL THEN RAISE EXCEPTION 'stop_not_found'; END IF;
  PERFORM public._assert_driver_owns_trip(v_trip);

  IF v_current = ANY(v_terminal) AND _new_status <> v_current THEN
    RAISE EXCEPTION 'stop_already_terminal';
  END IF;

  v_event_type := 'stop_' || _new_status;

  UPDATE public.dispatch_stops
    SET status = _new_status,
        notes = COALESCE(_reason, notes),
        actual_arrival_at = COALESCE(actual_arrival_at,
          CASE WHEN _new_status IN ('arrived','delivered','completed','refused','returned','partial_delivery','failed') THEN now() END),
        actual_departure_at = CASE
          WHEN _new_status = 'arrived' THEN actual_departure_at
          ELSE COALESCE(actual_departure_at, now())
        END,
        updated_at = now()
    WHERE id = _stop_id;

  INSERT INTO public.dispatch_events(tenant_id, dispatch_trip_id, dispatch_stop_id, event_type, payload, notes, created_by)
  VALUES (v_tenant, v_trip, _stop_id, v_event_type,
          jsonb_build_object('source','driver_app','new_status',_new_status,'reason',_reason),
          _reason, auth.uid())
  RETURNING id INTO v_event;

  IF _new_status = ANY(v_terminal) THEN
    SELECT count(*) INTO v_pending FROM public.dispatch_stops
     WHERE dispatch_trip_id = v_trip AND NOT (status = ANY(v_terminal));

    IF v_pending = 0 THEN
      UPDATE public.dispatch_trips
         SET status='completed', actual_end_at=now(), updated_at=now()
       WHERE id = v_trip AND status <> 'completed';

      FOR v_load_id IN
        SELECT DISTINCT load_id FROM (
          SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = v_trip
          UNION
          SELECT l.id FROM public.loads l WHERE l.trip_id = v_trip
        ) x
      LOOP
        SELECT array_agg(DISTINCT ds.status) INTO v_load_terminals
          FROM public.dispatch_stops ds
          JOIN public.dispatch_stop_documents dsd ON dsd.dispatch_stop_id = ds.id
          JOIN public.fiscal_documents fd ON fd.id = dsd.fiscal_document_id
         WHERE fd.load_id = v_load_id AND ds.dispatch_trip_id = v_trip;

        v_new_load_status := CASE
          WHEN v_load_terminals IS NULL THEN 'delivered'
          WHEN 'partial_delivery' = ANY(v_load_terminals) THEN 'partial_delivery'
          WHEN 'returned' = ANY(v_load_terminals) THEN 'returned'
          WHEN 'refused'  = ANY(v_load_terminals) THEN 'refused'
          WHEN 'failed'   = ANY(v_load_terminals) THEN 'failed'
          WHEN 'cancelled' = ANY(v_load_terminals) AND array_length(v_load_terminals,1)=1 THEN 'cancelled'
          ELSE 'delivered'
        END;

        UPDATE public.loads
           SET status = v_new_load_status, updated_at = now()
         WHERE id = v_load_id
           AND status NOT IN ('delivered','cancelled','returned','refused','partial_delivery','failed');
      END LOOP;
    END IF;
  END IF;

  RETURN v_event;
END; $$;
