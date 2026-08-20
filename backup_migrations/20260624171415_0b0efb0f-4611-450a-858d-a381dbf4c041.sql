
-- ============================================================
-- 1.1 Helper: portal_user_can_download_fiscal_document
-- ============================================================
CREATE OR REPLACE FUNCTION public.portal_user_can_download_fiscal_document(
  _tenant_id uuid, _fiscal_document_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.fiscal_documents fd
    JOIN public.client_portal_access cpa
      ON cpa.tenant_id = fd.tenant_id
     AND cpa.user_id = auth.uid()
     AND cpa.active = true
     AND cpa.can_download_documents = true
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
GRANT EXECUTE ON FUNCTION public.portal_user_can_download_fiscal_document(uuid,uuid) TO authenticated, service_role;

-- ============================================================
-- 1.2 Canonical stop terminal statuses
-- ============================================================
CREATE OR REPLACE FUNCTION public.stop_terminal_statuses()
RETURNS text[]
LANGUAGE sql IMMUTABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public' AS $$
  SELECT ARRAY[
    'completed','delivered','cancelled','skipped',
    'refused','returned','partial_delivery','failed'
  ]::text[];
$$;
GRANT EXECUTE ON FUNCTION public.stop_terminal_statuses() TO authenticated, service_role, anon;

-- ============================================================
-- 1.3 driver_finalize_delivery: use canonical terminal list
-- ============================================================
CREATE OR REPLACE FUNCTION public.driver_finalize_delivery(
  _stop_id uuid, _receiver_name text, _signature_path text DEFAULT NULL::text,
  _photo_paths text[] DEFAULT ARRAY[]::text[],
  _receiver_document text DEFAULT NULL::text, _receiver_role text DEFAULT NULL::text,
  _notes text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path TO 'public' AS $$
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

  IF v_stop_status = ANY(public.stop_terminal_statuses()) THEN
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
    SET status='delivered',
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

  -- close trip when all stops in terminal state
  SELECT count(*) INTO v_pending FROM public.dispatch_stops
   WHERE dispatch_trip_id = v_trip
     AND NOT (status = ANY(public.stop_terminal_statuses()));
  IF v_pending = 0 THEN
    UPDATE public.dispatch_trips
       SET status='completed', actual_end_at=now(), updated_at=now()
     WHERE id = v_trip AND status <> 'completed';
    UPDATE public.loads SET status='delivered', updated_at=now()
     WHERE id IN (SELECT load_id FROM public.dispatch_trip_loads WHERE dispatch_trip_id = v_trip)
       AND status <> 'delivered';
    UPDATE public.loads l SET status='delivered', updated_at=now()
     FROM public.dispatch_trips dt
     WHERE dt.id = v_trip AND l.id = dt.load_id AND l.status <> 'delivered';
  END IF;

  RETURN jsonb_build_object('event_id', v_event, 'pod_ids', to_jsonb(v_pod_ids));
END; $$;

-- ============================================================
-- driver_mark_arrival: bloqueia se já terminal
-- ============================================================
CREATE OR REPLACE FUNCTION public.driver_mark_arrival(_stop_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path TO 'public' AS $$
DECLARE v_trip uuid; v_tenant uuid; v_event uuid; v_was_active boolean; v_status text;
BEGIN
  SELECT dispatch_trip_id, tenant_id, status INTO v_trip, v_tenant, v_status
  FROM public.dispatch_stops WHERE id = _stop_id;
  IF v_trip IS NULL THEN RAISE EXCEPTION 'stop_not_found'; END IF;
  PERFORM public._assert_driver_owns_trip(v_trip);

  IF v_status = ANY(public.stop_terminal_statuses()) THEN
    RAISE EXCEPTION 'stop_already_terminal';
  END IF;

  SELECT (status = 'in_progress') INTO v_was_active
  FROM public.dispatch_trips WHERE id = v_trip;

  UPDATE public.dispatch_stops
    SET status = 'arrived',
        actual_arrival_at = COALESCE(actual_arrival_at, now()),
        updated_at = now()
    WHERE id = _stop_id;

  INSERT INTO public.dispatch_events(tenant_id, dispatch_trip_id, dispatch_stop_id, event_type, payload, created_by)
  VALUES (v_tenant, v_trip, _stop_id, 'arrival', jsonb_build_object('source','driver_app'), auth.uid())
  RETURNING id INTO v_event;

  UPDATE public.dispatch_trips
    SET status='in_progress', actual_start_at = COALESCE(actual_start_at, now()), updated_at = now()
    WHERE id = v_trip AND status IN ('planned','loading','dispatched');

  IF NOT COALESCE(v_was_active, false) THEN
    UPDATE public.loads SET status='in_transit', updated_at=now()
    WHERE id IN (SELECT load_id FROM public.dispatch_trip_loads WHERE dispatch_trip_id = v_trip)
      AND status NOT IN ('delivered','cancelled');
    UPDATE public.loads l SET status='in_transit', updated_at=now()
    FROM public.dispatch_trips dt
    WHERE dt.id = v_trip AND l.id = dt.load_id
      AND l.status NOT IN ('delivered','cancelled','in_transit');
  END IF;

  RETURN v_event;
END; $$;

-- ============================================================
-- driver_update_stop_status: expanded
-- ============================================================
CREATE OR REPLACE FUNCTION public.driver_update_stop_status(
  _stop_id uuid, _new_status text, _reason text DEFAULT NULL::text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path TO 'public' AS $$
DECLARE
  v_trip uuid; v_tenant uuid; v_event_type text; v_event uuid; v_current text;
  v_terminal text[] := public.stop_terminal_statuses();
  v_close_trip boolean := false; v_pending int;
BEGIN
  IF _new_status NOT IN (
    'partial_delivery','refused','damaged','returned','skipped',
    'cancelled','failed','delivered','completed','arrived','departed'
  ) THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

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

  -- Try to auto-close trip if every stop is terminal
  IF _new_status = ANY(v_terminal) THEN
    SELECT count(*) INTO v_pending FROM public.dispatch_stops
     WHERE dispatch_trip_id = v_trip
       AND NOT (status = ANY(v_terminal));
    IF v_pending = 0 THEN
      UPDATE public.dispatch_trips
         SET status='completed', actual_end_at=now(), updated_at=now()
       WHERE id = v_trip AND status <> 'completed';
    END IF;
  END IF;

  RETURN v_event;
END; $$;

-- ============================================================
-- driver_register_departure
-- ============================================================
CREATE OR REPLACE FUNCTION public.driver_register_departure(
  _stop_id uuid, _notes text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path TO 'public' AS $$
DECLARE v_trip uuid; v_tenant uuid; v_event uuid;
BEGIN
  SELECT dispatch_trip_id, tenant_id INTO v_trip, v_tenant
  FROM public.dispatch_stops WHERE id = _stop_id;
  IF v_trip IS NULL THEN RAISE EXCEPTION 'stop_not_found'; END IF;
  PERFORM public._assert_driver_owns_trip(v_trip);

  UPDATE public.dispatch_stops
    SET actual_departure_at = COALESCE(actual_departure_at, now()),
        updated_at = now()
    WHERE id = _stop_id;

  INSERT INTO public.dispatch_events(tenant_id, dispatch_trip_id, dispatch_stop_id, event_type, payload, notes, created_by)
  VALUES (v_tenant, v_trip, _stop_id, 'departure',
          jsonb_build_object('source','driver_app'), _notes, auth.uid())
  RETURNING id INTO v_event;

  RETURN v_event;
END; $$;
GRANT EXECUTE ON FUNCTION public.driver_register_departure(uuid,text) TO authenticated, service_role;

-- ============================================================
-- 1.4 get_client_portal_shipment_detail: isolated per client/stop
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_client_portal_shipment_detail(_fiscal_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public' AS $$
DECLARE
  _fd public.fiscal_documents;
  _tenant uuid;
  _can_financial boolean := false;
  _trip_id uuid; _stop_id uuid;
BEGIN
  SELECT * INTO _fd FROM public.fiscal_documents WHERE id = _fiscal_document_id;
  IF _fd.id IS NULL THEN RAISE EXCEPTION 'Documento não encontrado'; END IF;
  _tenant := _fd.tenant_id;

  IF NOT public.portal_user_can_access_fiscal_document(_tenant, _fiscal_document_id) THEN
    RAISE EXCEPTION 'Acesso negado a este documento';
  END IF;

  _can_financial := public.portal_user_can_view_financial(_tenant, _fiscal_document_id);

  SELECT ds.dispatch_trip_id, ds.id INTO _trip_id, _stop_id
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
             FROM public.dispatch_stops ds WHERE ds.id = _stop_id),
    -- events: ONLY for this specific stop (the client's stop)
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type,
                'notes', e.notes, 'created_at', e.created_at) ORDER BY e.created_at)
                FROM public.dispatch_events e
                WHERE e.dispatch_stop_id = _stop_id), '[]'::jsonb),
    -- occurrences: only the ones tied to this fiscal_document, this stop, or this client
    'occurrences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', oe.id, 'event_type', oe.event_type,
              'severity', oe.severity, 'description', oe.description,
              'public_status', oe.public_status, 'resolved_at', oe.resolved_at,
              'created_at', oe.created_at) ORDER BY oe.created_at DESC)
      FROM public.operational_events oe
      WHERE oe.tenant_id = _tenant
        AND oe.visible_to_client = true
        AND (
          oe.client_id = _fd.client_id
          OR (oe.load_id = _fd.load_id AND _fd.client_id IS NOT NULL AND oe.client_id = _fd.client_id)
        )
    ), '[]'::jsonb),
    'proofs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'proof_type', p.proof_type,
                'status', p.status, 'receiver_name', p.receiver_name, 'receiver_role', p.receiver_role,
                'received_at', p.received_at, 'validated_at', p.validated_at,
                'has_file', (p.storage_path IS NOT NULL)) ORDER BY p.created_at DESC)
                FROM public.proof_of_delivery p WHERE p.fiscal_document_id = _fd.id), '[]'::jsonb)
  );
END;
$$;

-- ============================================================
-- 1.5 Portal RPCs using unified access helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.list_client_documents(
  _tenant_id uuid, _document_type text DEFAULT NULL, _search text DEFAULT NULL,
  _start_date date DEFAULT NULL, _end_date date DEFAULT NULL,
  _limit integer DEFAULT 100, _offset integer DEFAULT 0
) RETURNS TABLE(
  id uuid, document_type text, invoice_number text, access_key text, issue_date date,
  remitter text, recipient text, recipient_city text, recipient_state text,
  value numeric, weight_kg numeric, status text, load_id uuid, client_id uuid, has_pod boolean
) LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public' AS $$
  SELECT fd.id, fd.document_type, fd.invoice_number, fd.access_key, fd.issue_date,
    fd.remitter, fd.recipient, fd.recipient_city, fd.recipient_state,
    CASE WHEN public.portal_user_can_view_financial(_tenant_id, fd.id) THEN fd.value END,
    fd.weight_kg, fd.status, fd.load_id, fd.client_id,
    EXISTS(SELECT 1 FROM public.proof_of_delivery pod WHERE pod.fiscal_document_id = fd.id)
  FROM public.fiscal_documents fd
  WHERE fd.tenant_id = _tenant_id
    AND public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
    AND (_document_type IS NULL OR fd.document_type = _document_type)
    AND (_start_date IS NULL OR fd.issue_date >= _start_date)
    AND (_end_date   IS NULL OR fd.issue_date <= _end_date)
    AND (_search IS NULL OR (
      fd.invoice_number ILIKE '%' || _search || '%'
      OR fd.access_key  ILIKE '%' || _search || '%'
      OR fd.remitter    ILIKE '%' || _search || '%'
      OR fd.recipient   ILIKE '%' || _search || '%'
    ))
  ORDER BY fd.issue_date DESC NULLS LAST, fd.created_at DESC
  LIMIT _limit OFFSET _offset;
$$;

CREATE OR REPLACE FUNCTION public.list_client_pods(
  _tenant_id uuid, _status text DEFAULT NULL,
  _start_date timestamptz DEFAULT NULL, _end_date timestamptz DEFAULT NULL,
  _limit integer DEFAULT 100, _offset integer DEFAULT 0
) RETURNS TABLE(
  id uuid, fiscal_document_id uuid, load_id uuid, invoice_number text, proof_type text,
  status text, has_file boolean, receiver_name text, receiver_document text,
  receiver_role text, received_at timestamptz, validated_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public' AS $$
  SELECT pod.id, pod.fiscal_document_id, pod.load_id, fd.invoice_number,
    pod.proof_type, pod.status, (pod.storage_path IS NOT NULL) AS has_file,
    pod.receiver_name, pod.receiver_document, pod.receiver_role,
    pod.received_at, pod.validated_at
  FROM public.proof_of_delivery pod
  JOIN public.fiscal_documents fd ON fd.id = pod.fiscal_document_id
  WHERE pod.tenant_id = _tenant_id
    AND public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
    AND (_status IS NULL OR pod.status = _status)
    AND (_start_date IS NULL OR pod.received_at >= _start_date)
    AND (_end_date   IS NULL OR pod.received_at <= _end_date)
  ORDER BY pod.received_at DESC NULLS LAST, pod.created_at DESC
  LIMIT _limit OFFSET _offset;
$$;

CREATE OR REPLACE FUNCTION public.get_client_pod_metadata(_tenant_id uuid, _pod_id uuid)
RETURNS TABLE(storage_bucket text, storage_path text)
LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public' AS $$
  SELECT pod.storage_bucket, pod.storage_path
  FROM public.proof_of_delivery pod
  WHERE pod.id = _pod_id
    AND pod.tenant_id = _tenant_id
    AND public.portal_user_can_download_fiscal_document(_tenant_id, pod.fiscal_document_id);
$$;

CREATE OR REPLACE FUNCTION public.get_client_portal_summary(
  _tenant_id uuid, _start_date date DEFAULT NULL, _end_date date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public' AS $$
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
                         AND po.remitter_client_id IN (SELECT unnest(public._portal_user_client_ids(_tenant_id)))),
    'pending_pod', (SELECT count(*) FROM fds fd WHERE fd.status='delivered'
                    AND NOT EXISTS (SELECT 1 FROM public.proof_of_delivery p
                                    WHERE p.fiscal_document_id = fd.id AND p.status IN ('uploaded','validated'))),
    'open_occurrences', (SELECT count(*) FROM public.operational_events oe
                         WHERE oe.tenant_id = _tenant_id AND oe.visible_to_client = true
                           AND oe.public_status = 'open'
                           AND oe.client_id IN (SELECT unnest(public._portal_user_client_ids(_tenant_id)))),
    'deliveries_today',    (SELECT count(*) FROM fds fd
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

-- ============================================================
-- 1.6 get_active_trips_live / get_open_trip_alerts: admin/operator only
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_active_trips_live(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public' AS $$
DECLARE _result jsonb;
BEGIN
  IF NOT (public.is_tenant_admin(_tenant_id) OR public.has_tenant_role(_tenant_id,'operator')) THEN
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
           AND NOT (s.status = ANY(public.stop_terminal_statuses()))
         ORDER BY s.stop_order ASC LIMIT 1) ns) AS next_stop,
      (SELECT COALESCE(jsonb_agg(row_to_jsonb(ps) ORDER BY (ps.sequence)), '[]'::jsonb)
       FROM (SELECT s.id, s.stop_order AS sequence, s.destination AS client_name,
                    s.actual_arrival_at, s.actual_departure_at, s.status
             FROM public.dispatch_stops s
             WHERE s.dispatch_trip_id = dt.id
               AND s.status = ANY(public.stop_terminal_statuses())
             ORDER BY s.stop_order ASC) ps) AS previous_stops,
      (SELECT COALESCE(jsonb_agg(row_to_jsonb(pe) ORDER BY (pe.sequence)), '[]'::jsonb)
       FROM (SELECT s.id, s.stop_order AS sequence, s.destination AS client_name,
                    s.planned_arrival_at, s.status
             FROM public.dispatch_stops s
             WHERE s.dispatch_trip_id = dt.id
               AND NOT (s.status = ANY(public.stop_terminal_statuses()))
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
END; $$;

CREATE OR REPLACE FUNCTION public.get_open_trip_alerts(_tenant_id uuid)
RETURNS SETOF public.trip_alerts
LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public' AS $$
  SELECT * FROM public.trip_alerts
  WHERE tenant_id = _tenant_id AND status = 'open'
    AND (public.is_tenant_admin(_tenant_id) OR public.has_tenant_role(_tenant_id,'operator'))
  ORDER BY
    CASE severity WHEN 'critical' THEN 1 WHEN 'danger' THEN 2 WHEN 'warning' THEN 3
                  WHEN 'info' THEN 4 WHEN 'success' THEN 5 ELSE 6 END,
    opened_at DESC;
$$;

-- ============================================================
-- 1.7 Receipts bucket: restrict to admin/operator/driver
-- Force clients to use Edge Function
-- ============================================================
DROP POLICY IF EXISTS "receipts_tenant_select" ON storage.objects;
CREATE POLICY "receipts_tenant_select" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'receipts'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND EXISTS (
    SELECT 1 FROM public.tenant_memberships tm
    WHERE tm.user_id = auth.uid()
      AND tm.tenant_id::text = (storage.foldername(name))[1]
      AND tm.active = true
      AND tm.role IN ('owner','admin','operator','driver')
  )
);

-- Remove client direct-read on POD (force via RPC)
DROP POLICY IF EXISTS "Clients read own POD" ON public.proof_of_delivery;

-- ============================================================
-- 1.8 Unique index drivers(tenant_id, user_id)
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_tenant_user
  ON public.drivers(tenant_id, user_id) WHERE user_id IS NOT NULL;
