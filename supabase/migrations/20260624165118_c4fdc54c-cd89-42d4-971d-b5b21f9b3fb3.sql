
-- ============================================================
-- HARDENING WAVE 1: Portal access helper, RLS estrita, RPCs motorista, multi-carga
-- ============================================================

-- 1.1 Helper central de acesso do portal a fiscal_document
CREATE OR REPLACE FUNCTION public.portal_user_can_access_fiscal_document(_tenant_id uuid, _fiscal_document_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.fiscal_documents fd
    JOIN public.client_portal_access cpa
      ON cpa.tenant_id = fd.tenant_id
     AND cpa.user_id = auth.uid()
     AND cpa.active = true
    LEFT JOIN public.clients c ON c.id = cpa.client_id
    WHERE fd.id = _fiscal_document_id
      AND fd.tenant_id = _tenant_id
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
GRANT EXECUTE ON FUNCTION public.portal_user_can_access_fiscal_document(uuid,uuid) TO authenticated;

-- Helper financeiro
CREATE OR REPLACE FUNCTION public.portal_user_can_view_financial(_tenant_id uuid, _fiscal_document_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.fiscal_documents fd
    JOIN public.client_portal_access cpa
      ON cpa.tenant_id = fd.tenant_id
     AND cpa.user_id = auth.uid()
     AND cpa.active = true
     AND cpa.can_view_financial = true
    LEFT JOIN public.clients c ON c.id = cpa.client_id
    WHERE fd.id = _fiscal_document_id
      AND fd.tenant_id = _tenant_id
      AND (
        cpa.client_id = fd.client_id
        OR (c.tax_id IS NOT NULL AND c.tax_id IN (fd.remitter_cnpj, fd.recipient_cnpj))
      )
  );
$$;
GRANT EXECUTE ON FUNCTION public.portal_user_can_view_financial(uuid,uuid) TO authenticated;

-- 1.2 Recriar get_client_portal_shipment_detail usando helpers
CREATE OR REPLACE FUNCTION public.get_client_portal_shipment_detail(_fiscal_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path = public
AS $$
DECLARE
  _fd public.fiscal_documents;
  _tenant uuid;
  _can_financial boolean := false;
  _trip_id uuid;
BEGIN
  SELECT * INTO _fd FROM public.fiscal_documents WHERE id = _fiscal_document_id;
  IF _fd.id IS NULL THEN RAISE EXCEPTION 'Documento não encontrado'; END IF;
  _tenant := _fd.tenant_id;

  IF NOT public.portal_user_can_access_fiscal_document(_tenant, _fiscal_document_id) THEN
    RAISE EXCEPTION 'Acesso negado a este documento';
  END IF;

  _can_financial := public.portal_user_can_view_financial(_tenant, _fiscal_document_id);

  -- trip via stop_documents (multi-load aware)
  SELECT ds.dispatch_trip_id INTO _trip_id
  FROM public.dispatch_stop_documents dsd
  JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
  WHERE dsd.fiscal_document_id = _fd.id
  LIMIT 1;

  RETURN jsonb_build_object(
    'document', jsonb_build_object(
      'id', _fd.id, 'invoice_number', _fd.invoice_number, 'access_key', _fd.access_key,
      'document_type', _fd.document_type, 'issue_date', _fd.issue_date, 'status', _fd.status,
      'client_load_number', _fd.client_load_number, 'reference_number', _fd.reference_number,
      'remitter', _fd.remitter, 'remitter_cnpj', _fd.remitter_cnpj,
      'recipient', _fd.recipient, 'recipient_cnpj', _fd.recipient_cnpj,
      'recipient_city', _fd.recipient_city, 'recipient_state', _fd.recipient_state,
      'recipient_neighborhood', _fd.recipient_neighborhood,
      'product_summary', _fd.product_summary, 'pallet_count', _fd.pallet_count, 'weight_kg', _fd.weight_kg,
      'value', CASE WHEN _can_financial THEN _fd.value END,
      'freight_value', CASE WHEN _can_financial THEN _fd.freight_value END
    ),
    'load', (SELECT jsonb_build_object('id', l.id, 'load_number', l.load_number, 'status', l.status,
              'origin', l.origin, 'destination', l.destination,
              'total_pallet_count', l.total_pallet_count, 'total_weight_kg', l.total_weight_kg)
             FROM public.loads l WHERE l.id = _fd.load_id),
    'trip', (SELECT jsonb_build_object('id', dt.id, 'status', dt.status,
              'planned_start_at', dt.planned_start_at, 'actual_start_at', dt.actual_start_at,
              'planned_end_at', dt.planned_end_at, 'actual_end_at', dt.actual_end_at)
             FROM public.dispatch_trips dt WHERE dt.id = _trip_id),
    'stop', (SELECT jsonb_build_object('id', ds.id, 'stop_order', ds.stop_order,
              'destination', ds.destination, 'status', ds.status,
              'planned_arrival_at', ds.planned_arrival_at,
              'actual_arrival_at', ds.actual_arrival_at,
              'actual_departure_at', ds.actual_departure_at)
             FROM public.dispatch_stops ds
             JOIN public.dispatch_stop_documents dsd ON dsd.dispatch_stop_id = ds.id
             WHERE dsd.fiscal_document_id = _fd.id LIMIT 1),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type,
                'notes', e.notes, 'created_at', e.created_at) ORDER BY e.created_at)
                FROM public.dispatch_events e WHERE e.dispatch_trip_id = _trip_id), '[]'::jsonb),
    'occurrences', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', oe.id, 'event_type', oe.event_type,
                    'severity', oe.severity, 'description', oe.description,
                    'public_status', oe.public_status, 'resolved_at', oe.resolved_at,
                    'created_at', oe.created_at) ORDER BY oe.created_at DESC)
                    FROM public.operational_events oe
                    WHERE oe.tenant_id = _tenant AND oe.load_id = _fd.load_id
                      AND oe.visible_to_client = true), '[]'::jsonb),
    'proofs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'proof_type', p.proof_type,
                'status', p.status, 'receiver_name', p.receiver_name, 'receiver_role', p.receiver_role,
                'received_at', p.received_at, 'validated_at', p.validated_at,
                'has_file', (p.storage_path IS NOT NULL)) ORDER BY p.created_at DESC)
                FROM public.proof_of_delivery p WHERE p.fiscal_document_id = _fd.id), '[]'::jsonb)
  );
END;
$$;

-- 1.3 Recriar get_active_trips_live explicitamente (com 'arrived' já incluído e ORDER BY correto)
CREATE OR REPLACE FUNCTION public.get_active_trips_live(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path = public
AS $$
DECLARE _result jsonb;
BEGIN
  IF NOT public.is_tenant_member(_tenant_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_jsonb(t)), '[]'::jsonb) INTO _result
  FROM (
    SELECT
      dt.id AS trip_id,
      COALESCE(l.load_number, dt.id::text) AS trip_code,
      dt.vehicle_id, v.plate AS vehicle_plate, v.nickname AS vehicle_name,
      dt.driver_id, d.name AS driver_name, d.phone AS driver_phone,
      pl.lat, pl.lng, COALESCE(pl.speed, 0) AS speed_kmh, pl.heading,
      COALESCE(tls.state, 'normal') AS state,
      COALESCE(tls.severity, 'info') AS severity,
      tls.message AS status_message,
      tr.geometry_geojson AS route_geometry_geojson,
      tls.distance_from_route_meters, tls.delay_minutes, tls.stopped_minutes,
      tls.average_speed_kmh, tls.eta_next_stop_at,
      tls.last_signal_at, tls.last_signal_age_seconds,
      pl.captured_at AS position_captured_at,
      (SELECT row_to_jsonb(ns) FROM (
         SELECT s.id, s.stop_order AS sequence, s.destination AS client_name,
                s.planned_arrival_at, s.status
         FROM public.dispatch_stops s
         WHERE s.dispatch_trip_id = dt.id
           AND s.status IN ('pending','arriving','arrived','in_progress')
         ORDER BY s.stop_order ASC LIMIT 1) ns) AS next_stop,
      (SELECT COALESCE(jsonb_agg(row_to_jsonb(ps) ORDER BY (ps.sequence)), '[]'::jsonb)
       FROM (SELECT s.id, s.stop_order AS sequence, s.destination AS client_name,
                    s.actual_arrival_at, s.actual_departure_at, s.status
             FROM public.dispatch_stops s
             WHERE s.dispatch_trip_id = dt.id
               AND s.status IN ('completed','delivered','skipped','failed')
             ORDER BY s.stop_order ASC) ps) AS previous_stops,
      (SELECT COALESCE(jsonb_agg(row_to_jsonb(pe) ORDER BY (pe.sequence)), '[]'::jsonb)
       FROM (SELECT s.id, s.stop_order AS sequence, s.destination AS client_name,
                    s.planned_arrival_at, s.status
             FROM public.dispatch_stops s
             WHERE s.dispatch_trip_id = dt.id
               AND s.status IN ('pending','arriving','arrived','in_progress')
             ORDER BY s.stop_order ASC) pe) AS pending_stops,
      (SELECT COALESCE(jsonb_agg(row_to_jsonb(ld)), '[]'::jsonb)
       FROM (SELECT lo.id, lo.load_number AS code,
                    (SELECT count(*) FROM public.load_items li WHERE li.load_id = lo.id) AS documents_count,
                    lo.total_weight_kg AS total_weight, lo.status
             FROM public.dispatch_trip_loads dtl
             JOIN public.loads lo ON lo.id = dtl.load_id
             WHERE dtl.dispatch_trip_id = dt.id) ld) AS loads
    FROM public.dispatch_trips dt
    LEFT JOIN public.loads l ON l.id = dt.load_id
    LEFT JOIN public.vehicles v ON v.id = dt.vehicle_id
    LEFT JOIN public.drivers d ON d.id = dt.driver_id
    LEFT JOIN public.positions_last pl ON pl.vehicle_id = dt.vehicle_id AND pl.tenant_id = dt.tenant_id
    LEFT JOIN public.trip_live_status tls ON tls.trip_id = dt.id AND tls.tenant_id = dt.tenant_id
    LEFT JOIN public.trip_routes tr ON tr.trip_id = dt.id AND tr.tenant_id = dt.tenant_id AND tr.provider = 'osrm'
    WHERE dt.tenant_id = _tenant_id
      AND dt.status IN ('planned','loading','dispatched','in_progress')
  ) t;

  RETURN COALESCE(_result, '[]'::jsonb);
END;
$$;

-- ============================================================
-- 1.4 RLS estrita
-- ============================================================

-- dispatch_trips
DROP POLICY IF EXISTS "Members can view dispatch_trips" ON public.dispatch_trips;
CREATE POLICY "Operators view dispatch_trips" ON public.dispatch_trips
  FOR SELECT TO authenticated
  USING (
    public.is_tenant_admin(tenant_id) OR public.has_tenant_role(tenant_id,'operator')
  );
CREATE POLICY "Drivers view own dispatch_trips" ON public.dispatch_trips
  FOR SELECT TO authenticated
  USING (
    driver_id IN (SELECT d.id FROM public.drivers d WHERE d.user_id = auth.uid() AND d.tenant_id = dispatch_trips.tenant_id)
  );

-- dispatch_stops
DROP POLICY IF EXISTS "Members can view dispatch_stops" ON public.dispatch_stops;
CREATE POLICY "Operators view dispatch_stops" ON public.dispatch_stops
  FOR SELECT TO authenticated
  USING (public.is_tenant_admin(tenant_id) OR public.has_tenant_role(tenant_id,'operator'));
-- Drivers can view own trip stops already exists

-- dispatch_events
DROP POLICY IF EXISTS "Members can view dispatch_events" ON public.dispatch_events;
CREATE POLICY "Operators view dispatch_events" ON public.dispatch_events
  FOR SELECT TO authenticated
  USING (public.is_tenant_admin(tenant_id) OR public.has_tenant_role(tenant_id,'operator'));

-- driver_expenses
DROP POLICY IF EXISTS "Members can view driver_expenses" ON public.driver_expenses;
CREATE POLICY "Operators view driver_expenses" ON public.driver_expenses
  FOR SELECT TO authenticated
  USING (public.is_tenant_admin(tenant_id) OR public.has_tenant_role(tenant_id,'operator'));

-- dispatch_stop_documents: restringir writes a admin/operator
DROP POLICY IF EXISTS "Tenant members write dispatch_stop_documents" ON public.dispatch_stop_documents;
DROP POLICY IF EXISTS "Tenant members update dispatch_stop_documents" ON public.dispatch_stop_documents;
DROP POLICY IF EXISTS "Tenant members delete dispatch_stop_documents" ON public.dispatch_stop_documents;
DROP POLICY IF EXISTS "Tenant members read dispatch_stop_documents" ON public.dispatch_stop_documents;
CREATE POLICY "Operators read dispatch_stop_documents" ON public.dispatch_stop_documents
  FOR SELECT TO authenticated
  USING (public.is_tenant_admin(tenant_id) OR public.has_tenant_role(tenant_id,'operator'));
CREATE POLICY "Operators manage dispatch_stop_documents" ON public.dispatch_stop_documents
  FOR ALL TO authenticated
  USING (public.is_tenant_admin(tenant_id) OR public.has_tenant_role(tenant_id,'operator'))
  WITH CHECK (public.is_tenant_admin(tenant_id) OR public.has_tenant_role(tenant_id,'operator'));
CREATE POLICY "Drivers read own stop documents" ON public.dispatch_stop_documents
  FOR SELECT TO authenticated
  USING (
    dispatch_stop_id IN (
      SELECT s.id FROM public.dispatch_stops s
      WHERE s.dispatch_trip_id IN (SELECT _driver_trip_ids())
    )
  );

-- proof_of_delivery: nem driver nem client escrevem; admin/operator gerenciam
DROP POLICY IF EXISTS "Tenant manages POD" ON public.proof_of_delivery;
CREATE POLICY "Operators manage POD" ON public.proof_of_delivery
  FOR ALL TO authenticated
  USING (public.is_tenant_admin(tenant_id) OR public.has_tenant_role(tenant_id,'operator'))
  WITH CHECK (public.is_tenant_admin(tenant_id) OR public.has_tenant_role(tenant_id,'operator'));
-- "Clients read own POD" mantida

-- ============================================================
-- 1.5 RPCs novas do motorista
-- ============================================================

CREATE OR REPLACE FUNCTION public.driver_update_stop_status(
  _stop_id uuid, _new_status text, _reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public
AS $$
DECLARE v_trip uuid; v_tenant uuid; v_event_type text; v_event uuid;
BEGIN
  IF _new_status NOT IN ('partial_delivery','refused','damaged','returned','skipped') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  SELECT dispatch_trip_id, tenant_id INTO v_trip, v_tenant
  FROM public.dispatch_stops WHERE id = _stop_id;
  IF v_trip IS NULL THEN RAISE EXCEPTION 'stop_not_found'; END IF;
  PERFORM public._assert_driver_owns_trip(v_trip);

  v_event_type := 'stop_' || _new_status;

  UPDATE public.dispatch_stops
    SET status = _new_status,
        notes = COALESCE(_reason, notes),
        actual_departure_at = COALESCE(actual_departure_at, now()),
        updated_at = now()
    WHERE id = _stop_id;

  INSERT INTO public.dispatch_events(tenant_id, dispatch_trip_id, dispatch_stop_id, event_type, payload, notes, created_by)
  VALUES (v_tenant, v_trip, _stop_id, v_event_type,
          jsonb_build_object('source','driver_app','new_status',_new_status,'reason',_reason),
          _reason, auth.uid())
  RETURNING id INTO v_event;

  RETURN v_event;
END; $$;
GRANT EXECUTE ON FUNCTION public.driver_update_stop_status(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.driver_create_operational_occurrence(
  _trip_id uuid, _event_type text, _description text,
  _severity text DEFAULT 'medium',
  _stop_id uuid DEFAULT NULL,
  _client_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public
AS $$
DECLARE v_tenant uuid; v_load uuid; v_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public._assert_driver_owns_trip(_trip_id);
  SELECT load_id INTO v_load FROM public.dispatch_trips WHERE id = _trip_id;

  -- also emit dispatch event for traceability
  INSERT INTO public.dispatch_events(tenant_id, dispatch_trip_id, dispatch_stop_id, event_type, payload, notes, created_by)
  VALUES (v_tenant, _trip_id, _stop_id, 'occurrence',
          jsonb_build_object('source','driver_app','severity',_severity,'kind',_event_type),
          _description, auth.uid());

  INSERT INTO public.operational_events(
    tenant_id, client_id, load_id, event_type, severity, description,
    visible_to_client, public_status, created_by
  ) VALUES (
    v_tenant, _client_id, v_load, _event_type, _severity, _description,
    (_client_id IS NOT NULL), 'reported_by_driver', auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.driver_create_operational_occurrence(uuid,text,text,text,uuid,uuid) TO authenticated;

-- ============================================================
-- 1.6 driver_mark_arrival: cascade in_transit em primeira chegada
-- ============================================================
CREATE OR REPLACE FUNCTION public.driver_mark_arrival(_stop_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public
AS $$
DECLARE v_trip uuid; v_tenant uuid; v_event uuid; v_was_active boolean;
BEGIN
  SELECT dispatch_trip_id, tenant_id INTO v_trip, v_tenant
  FROM public.dispatch_stops WHERE id = _stop_id;
  IF v_trip IS NULL THEN RAISE EXCEPTION 'stop_not_found'; END IF;
  PERFORM public._assert_driver_owns_trip(v_trip);

  SELECT (status = 'in_progress') INTO v_was_active
  FROM public.dispatch_trips WHERE id = v_trip;

  UPDATE public.dispatch_stops
    SET status = CASE WHEN status IN ('completed','delivered','cancelled') THEN status ELSE 'arrived' END,
        actual_arrival_at = COALESCE(actual_arrival_at, now()),
        updated_at = now()
    WHERE id = _stop_id;

  INSERT INTO public.dispatch_events(tenant_id, dispatch_trip_id, dispatch_stop_id, event_type, payload, created_by)
  VALUES (v_tenant, v_trip, _stop_id, 'arrival', jsonb_build_object('source','driver_app'), auth.uid())
  RETURNING id INTO v_event;

  UPDATE public.dispatch_trips
    SET status='in_progress', actual_start_at = COALESCE(actual_start_at, now()), updated_at = now()
    WHERE id = v_trip AND status IN ('planned','loading','dispatched');

  -- Cascade in_transit on first arrival
  IF NOT COALESCE(v_was_active, false) THEN
    UPDATE public.loads SET status='in_transit', updated_at=now()
    WHERE id IN (SELECT load_id FROM public.dispatch_trip_loads WHERE dispatch_trip_id = v_trip)
      AND status NOT IN ('delivered','cancelled');
    -- also the legacy single load_id on trip
    UPDATE public.loads l SET status='in_transit', updated_at=now()
    FROM public.dispatch_trips dt
    WHERE dt.id = v_trip AND l.id = dt.load_id
      AND l.status NOT IN ('delivered','cancelled','in_transit');
  END IF;

  RETURN v_event;
END; $$;

-- ============================================================
-- 1.7 driver_finalize_delivery multi-carga
-- ============================================================
CREATE OR REPLACE FUNCTION public.driver_finalize_delivery(
  _stop_id uuid, _receiver_name text, _signature_path text DEFAULT NULL,
  _photo_paths text[] DEFAULT ARRAY[]::text[],
  _receiver_document text DEFAULT NULL, _receiver_role text DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public
AS $$
DECLARE
  v_trip uuid; v_tenant uuid; v_stop_status text;
  v_event uuid; v_pod_ids uuid[] := ARRAY[]::uuid[]; v_pod uuid;
  v_fd uuid; v_doc_load uuid; v_pending int; v_proof_type text;
BEGIN
  SELECT dispatch_trip_id, tenant_id, status
    INTO v_trip, v_tenant, v_stop_status
  FROM public.dispatch_stops WHERE id = _stop_id;
  IF v_trip IS NULL THEN RAISE EXCEPTION 'stop_not_found'; END IF;
  PERFORM public._assert_driver_owns_trip(v_trip);

  IF v_stop_status IN ('completed','delivered','cancelled') THEN
    RAISE EXCEPTION 'stop_already_completed';
  END IF;
  IF _receiver_name IS NULL OR length(btrim(_receiver_name)) < 2 THEN
    RAISE EXCEPTION 'receiver_required';
  END IF;

  INSERT INTO public.dispatch_events(
    tenant_id, dispatch_trip_id, dispatch_stop_id, event_type, notes, payload, created_by
  ) VALUES (
    v_tenant, v_trip, _stop_id, 'delivery_delivered', _notes,
    jsonb_build_object(
      'event_subtype','entregue',
      'receiver_name', btrim(_receiver_name),
      'receiver_document', NULLIF(btrim(coalesce(_receiver_document,'')),''),
      'receiver_role', NULLIF(btrim(coalesce(_receiver_role,'')),''),
      'photo_paths', coalesce(to_jsonb(_photo_paths),'[]'::jsonb),
      'signature_path', _signature_path
    ),
    auth.uid()
  ) RETURNING id INTO v_event;

  UPDATE public.dispatch_stops
    SET status='completed',
        actual_arrival_at = COALESCE(actual_arrival_at, now()),
        actual_departure_at = now(),
        notes = COALESCE(_notes, notes),
        updated_at = now()
    WHERE id = _stop_id;

  v_proof_type := CASE WHEN _signature_path IS NOT NULL THEN 'receiver_confirmation' ELSE 'delivery_photo' END;

  FOR v_fd, v_doc_load IN
    SELECT dsd.fiscal_document_id, COALESCE(dsd.load_id, fd.load_id)
    FROM public.dispatch_stop_documents dsd
    JOIN public.fiscal_documents fd ON fd.id = dsd.fiscal_document_id
    WHERE dsd.dispatch_stop_id = _stop_id
      AND dsd.tenant_id = v_tenant
      AND fd.tenant_id = v_tenant
  LOOP
    INSERT INTO public.proof_of_delivery(
      tenant_id, fiscal_document_id, load_id, dispatch_trip_id, dispatch_stop_id,
      proof_type, status, storage_bucket, storage_path,
      receiver_name, receiver_document, receiver_role, received_at, metadata
    ) VALUES (
      v_tenant, v_fd, v_doc_load, v_trip, _stop_id,
      v_proof_type, 'uploaded', 'receipts',
      COALESCE(_signature_path, CASE WHEN array_length(_photo_paths,1) > 0 THEN _photo_paths[1] END),
      btrim(_receiver_name),
      NULLIF(btrim(coalesce(_receiver_document,'')),''),
      NULLIF(btrim(coalesce(_receiver_role,'')),''),
      now(),
      jsonb_build_object('photo_paths', coalesce(to_jsonb(_photo_paths),'[]'::jsonb),
                         'signature_path', _signature_path,
                         'event_id', v_event)
    )
    ON CONFLICT (fiscal_document_id) DO UPDATE SET
      load_id = COALESCE(EXCLUDED.load_id, public.proof_of_delivery.load_id),
      status = EXCLUDED.status,
      storage_bucket = EXCLUDED.storage_bucket,
      storage_path = COALESCE(EXCLUDED.storage_path, public.proof_of_delivery.storage_path),
      receiver_name = EXCLUDED.receiver_name,
      receiver_document = COALESCE(EXCLUDED.receiver_document, public.proof_of_delivery.receiver_document),
      receiver_role = COALESCE(EXCLUDED.receiver_role, public.proof_of_delivery.receiver_role),
      received_at = EXCLUDED.received_at,
      dispatch_stop_id = EXCLUDED.dispatch_stop_id,
      dispatch_trip_id = EXCLUDED.dispatch_trip_id,
      proof_type = EXCLUDED.proof_type,
      metadata = public.proof_of_delivery.metadata || EXCLUDED.metadata,
      updated_at = now()
    RETURNING id INTO v_pod;
    v_pod_ids := v_pod_ids || v_pod;

    UPDATE public.fiscal_documents SET status='delivered', updated_at=now() WHERE id=v_fd;
  END LOOP;

  -- close trip when all stops done
  SELECT count(*) INTO v_pending FROM public.dispatch_stops
   WHERE dispatch_trip_id = v_trip
     AND status NOT IN ('completed','delivered','cancelled','skipped');
  IF v_pending = 0 THEN
    UPDATE public.dispatch_trips
       SET status='completed', actual_end_at=now(), updated_at=now()
     WHERE id = v_trip AND status <> 'completed';
    -- mark ALL loads of the trip as delivered (multi-load)
    UPDATE public.loads SET status='delivered', updated_at=now()
     WHERE id IN (SELECT load_id FROM public.dispatch_trip_loads WHERE dispatch_trip_id = v_trip)
       AND status <> 'delivered';
    -- legacy single trip.load_id
    UPDATE public.loads l SET status='delivered', updated_at=now()
     FROM public.dispatch_trips dt
     WHERE dt.id = v_trip AND l.id = dt.load_id AND l.status <> 'delivered';
  END IF;

  RETURN jsonb_build_object('event_id', v_event, 'pod_ids', to_jsonb(v_pod_ids));
END; $$;
