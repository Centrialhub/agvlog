
-- ============================================================
-- 1. ENTITY AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS public.entity_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  old_data jsonb,
  new_data jsonb,
  actor_user_id uuid,
  actor_role text,
  source text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_audit_log_tenant_created ON public.entity_audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_entity_audit_log_entity ON public.entity_audit_log(entity_type, entity_id);

GRANT SELECT ON public.entity_audit_log TO authenticated;
GRANT ALL ON public.entity_audit_log TO service_role;

ALTER TABLE public.entity_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_admin_read" ON public.entity_audit_log;
CREATE POLICY "audit_log_admin_read" ON public.entity_audit_log
  FOR SELECT TO authenticated
  USING (public.is_tenant_admin(tenant_id));

CREATE OR REPLACE FUNCTION public._log_entity_audit(
  _tenant_id uuid, _entity_type text, _entity_id uuid, _action text,
  _old jsonb DEFAULT NULL, _new jsonb DEFAULT NULL, _source text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_role text;
BEGIN
  SELECT role::text INTO v_role FROM public.tenant_memberships
   WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true
   ORDER BY CASE role::text WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'operator' THEN 3 ELSE 4 END
   LIMIT 1;
  INSERT INTO public.entity_audit_log(
    tenant_id, entity_type, entity_id, action,
    old_data, new_data, actor_user_id, actor_role, source
  ) VALUES (
    _tenant_id, _entity_type, _entity_id, _action,
    _old, _new, auth.uid(), v_role, _source
  );
END $$;

-- ============================================================
-- 2. FIX request_client_pickup
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_client_pickup(
  _tenant_id uuid, _client_id uuid, _pickup_at timestamptz,
  _recipient_name text DEFAULT NULL, _notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid; v_num text;
  v_requester_name text; v_requester_doc text;
BEGIN
  IF NOT public._portal_user_has_perm(_tenant_id, _client_id, 'can_request_pickup') THEN
    RAISE EXCEPTION 'Permission denied: cannot request pickup for this client';
  END IF;

  SELECT COALESCE(c.trade_name, c.company_name, c.legal_name), c.tax_id
    INTO v_requester_name, v_requester_doc
  FROM public.clients c
  WHERE c.id = _client_id AND c.tenant_id = _tenant_id;
  IF v_requester_name IS NULL THEN RAISE EXCEPTION 'Client not found'; END IF;

  BEGIN
    SELECT public.peek_next_pickup_number(_tenant_id) INTO v_num;
  EXCEPTION WHEN OTHERS THEN
    v_num := to_char(now(), 'YYYYMMDDHH24MISS');
  END;

  INSERT INTO public.pickup_orders (
    tenant_id, pickup_number, remitter_client_id, remitter_name, remitter_cnpj,
    recipient_name, pickup_at, status, notes, created_by
  ) VALUES (
    _tenant_id, v_num, _client_id, v_requester_name, v_requester_doc,
    _recipient_name, _pickup_at, 'pendente', _notes, auth.uid()
  ) RETURNING id INTO v_id;

  PERFORM public._log_entity_audit(_tenant_id, 'pickup_order', v_id, 'create_by_client',
    NULL, jsonb_build_object('client_id', _client_id, 'pickup_at', _pickup_at), 'portal');

  RETURN v_id;
END $$;

-- ============================================================
-- 3. FIX create_client_occurrence
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_client_occurrence(
  _tenant_id uuid, _client_id uuid, _event_type text, _description text,
  _severity text DEFAULT 'medium', _load_id uuid DEFAULT NULL, _order_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_ok boolean;
BEGIN
  IF NOT public._portal_user_has_perm(_tenant_id, _client_id, 'can_open_occurrences') THEN
    RAISE EXCEPTION 'Permission denied: cannot open occurrences for this client';
  END IF;

  IF _load_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.loads l
      WHERE l.id = _load_id AND l.tenant_id = _tenant_id
        AND (
          EXISTS(SELECT 1 FROM public.fiscal_documents fd WHERE fd.load_id = l.id AND fd.client_id = _client_id)
          OR EXISTS(
            SELECT 1 FROM public.load_items li
            JOIN public.fiscal_documents fd ON fd.id = li.fiscal_document_id
            WHERE li.load_id = l.id AND fd.client_id = _client_id
          )
          OR EXISTS(
            SELECT 1 FROM public.load_items li
            JOIN public.orders o ON o.id = li.order_id
            WHERE li.load_id = l.id AND o.client_id = _client_id
          )
        )
    ) INTO v_ok;
    IF NOT v_ok THEN RAISE EXCEPTION 'access_denied: load does not belong to client/tenant'; END IF;
  END IF;

  IF _order_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.orders o
      WHERE o.id = _order_id AND o.tenant_id = _tenant_id AND o.client_id = _client_id
    ) INTO v_ok;
    IF NOT v_ok THEN RAISE EXCEPTION 'access_denied: order does not belong to client/tenant'; END IF;
  END IF;

  INSERT INTO public.operational_events (
    tenant_id, client_id, load_id, order_id, event_type, severity, description,
    visible_to_client, client_opened, public_status, created_by
  ) VALUES (
    _tenant_id, _client_id, _load_id, _order_id, _event_type, _severity, _description,
    true, true, 'reported_by_client', auth.uid()
  ) RETURNING id INTO v_id;

  PERFORM public._log_entity_audit(_tenant_id, 'operational_event', v_id, 'create_by_client',
    NULL, jsonb_build_object('client_id', _client_id, 'load_id', _load_id, 'severity', _severity), 'portal');

  RETURN v_id;
END $$;

-- ============================================================
-- 4. driver_update_stop_status — drop + recreate with jsonb return
-- ============================================================
DROP FUNCTION IF EXISTS public.driver_update_stop_status(uuid, text, text);

CREATE OR REPLACE FUNCTION public.driver_update_stop_status(
  _stop_id uuid, _new_status text, _reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trip uuid; v_tenant uuid; v_event_type text; v_event uuid; v_current text;
  v_terminal text[] := public.stop_terminal_statuses();
  v_pending int; v_load_id uuid;
  v_load_terminals text[]; v_new_load_status text;
  v_doc_ids uuid[]; v_doc_status text; v_load_ids uuid[] := ARRAY[]::uuid[];
  v_trip_completed boolean := false;
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

  v_doc_status := CASE _new_status
    WHEN 'refused' THEN 'refused'
    WHEN 'returned' THEN 'returned'
    WHEN 'partial_delivery' THEN 'partial_delivery'
    WHEN 'failed' THEN 'failed'
    WHEN 'skipped' THEN 'not_delivered'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'delivered' THEN 'delivered'
    WHEN 'completed' THEN 'delivered'
    ELSE NULL
  END;

  SELECT COALESCE(array_agg(DISTINCT dsd.fiscal_document_id), ARRAY[]::uuid[])
    INTO v_doc_ids
  FROM public.dispatch_stop_documents dsd
  WHERE dsd.dispatch_stop_id = _stop_id;

  IF v_doc_status IS NOT NULL AND array_length(v_doc_ids, 1) IS NOT NULL THEN
    UPDATE public.fiscal_documents
      SET status = v_doc_status, updated_at = now()
      WHERE id = ANY(v_doc_ids) AND tenant_id = v_tenant
        AND status NOT IN ('delivered','returned','refused','partial_delivery','failed','cancelled');
    PERFORM public._log_entity_audit(v_tenant, 'fiscal_document', x,
      'status_change_by_driver', NULL,
      jsonb_build_object('new_status', v_doc_status, 'stop_id', _stop_id), 'driver_app')
      FROM unnest(v_doc_ids) AS x;
  END IF;

  PERFORM public._log_entity_audit(v_tenant, 'dispatch_stop', _stop_id, 'status_change',
    jsonb_build_object('status', v_current), jsonb_build_object('status', _new_status, 'reason', _reason), 'driver_app');

  IF _new_status = ANY(v_terminal) THEN
    SELECT count(*) INTO v_pending FROM public.dispatch_stops
     WHERE dispatch_trip_id = v_trip AND NOT (status = ANY(v_terminal));

    IF v_pending = 0 THEN
      UPDATE public.dispatch_trips
         SET status='completed', actual_end_at=now(), updated_at=now()
       WHERE id = v_trip AND status <> 'completed';
      v_trip_completed := true;

      FOR v_load_id IN
        SELECT DISTINCT load_id FROM (
          SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = v_trip
          UNION
          SELECT l.id FROM public.loads l WHERE l.trip_id = v_trip
        ) x
      LOOP
        v_load_ids := v_load_ids || v_load_id;
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

        PERFORM public._log_entity_audit(v_tenant, 'load', v_load_id, 'status_change',
          NULL, jsonb_build_object('new_status', v_new_load_status, 'trip_id', v_trip), 'driver_app');
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_event,
    'updated_stop_id', _stop_id,
    'updated_document_ids', COALESCE(to_jsonb(v_doc_ids), '[]'::jsonb),
    'updated_load_ids', COALESCE(to_jsonb(v_load_ids), '[]'::jsonb),
    'trip_completed', v_trip_completed
  );
END $$;

-- ============================================================
-- 5. COMPOSIÇÃO DE CARGA
-- ============================================================
CREATE OR REPLACE FUNCTION public._load_is_locked(_load_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.loads l
    WHERE l.id = _load_id
      AND (l.status IN ('in_transit','delivered','partial_delivery','returned','refused','failed','cancelled')
           OR EXISTS (SELECT 1 FROM public.dispatch_trips dt
                       WHERE dt.load_id = l.id AND dt.status IN ('in_progress','completed'))
           OR EXISTS (SELECT 1 FROM public.dispatch_trip_loads dtl
                       JOIN public.dispatch_trips dt ON dt.id = dtl.dispatch_trip_id
                       WHERE dtl.load_id = l.id AND dt.status IN ('in_progress','completed')))
  );
$$;

CREATE OR REPLACE FUNCTION public.assign_fiscal_documents_to_load(
  _tenant_id uuid, _load_id uuid, _document_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _load_id IS NULL OR _document_ids IS NULL OR array_length(_document_ids,1) IS NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;
  IF public._load_is_locked(_load_id) THEN RAISE EXCEPTION 'load_locked'; END IF;

  UPDATE public.fiscal_documents
    SET load_id = _load_id, updated_at = now()
    WHERE id = ANY(_document_ids) AND tenant_id = _tenant_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.load_items (tenant_id, load_id, fiscal_document_id, item_description, pallet_count, weight_kg, volume_m3)
  SELECT _tenant_id, _load_id, fd.id,
         COALESCE(fd.product_summary, 'Documento ' || fd.invoice_number),
         COALESCE(fd.pallet_count, 0), COALESCE(fd.weight_kg, 0), COALESCE(fd.volume_m3, 0)
  FROM public.fiscal_documents fd
  WHERE fd.id = ANY(_document_ids) AND fd.tenant_id = _tenant_id
    AND NOT EXISTS (SELECT 1 FROM public.load_items li
                    WHERE li.fiscal_document_id = fd.id AND li.load_id = _load_id);

  PERFORM public._log_entity_audit(_tenant_id, 'load', _load_id, 'assign_documents',
    NULL, jsonb_build_object('document_ids', to_jsonb(_document_ids)), 'composition_rpc');

  RETURN jsonb_build_object('updated', v_count, 'load_id', _load_id);
END $$;

CREATE OR REPLACE FUNCTION public.remove_fiscal_documents_from_load(
  _tenant_id uuid, _load_id uuid, _document_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF public._load_is_locked(_load_id) THEN RAISE EXCEPTION 'load_locked'; END IF;

  DELETE FROM public.load_items
    WHERE load_id = _load_id AND fiscal_document_id = ANY(_document_ids) AND tenant_id = _tenant_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE public.fiscal_documents
    SET load_id = NULL, updated_at = now()
    WHERE id = ANY(_document_ids) AND tenant_id = _tenant_id AND load_id = _load_id;

  PERFORM public._log_entity_audit(_tenant_id, 'load', _load_id, 'remove_documents',
    NULL, jsonb_build_object('document_ids', to_jsonb(_document_ids)), 'composition_rpc');

  RETURN jsonb_build_object('removed', v_count, 'load_id', _load_id);
END $$;

CREATE OR REPLACE FUNCTION public.move_load_items_between_loads(
  _tenant_id uuid, _source_load_id uuid, _target_load_id uuid, _item_ids uuid[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_moved int; v_doc_ids uuid[];
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _source_load_id = _target_load_id THEN RAISE EXCEPTION 'same_load'; END IF;
  IF public._load_is_locked(_source_load_id) THEN RAISE EXCEPTION 'source_load_locked'; END IF;
  IF public._load_is_locked(_target_load_id) THEN RAISE EXCEPTION 'target_load_locked'; END IF;

  SELECT COALESCE(array_agg(DISTINCT fiscal_document_id) FILTER (WHERE fiscal_document_id IS NOT NULL),
                  ARRAY[]::uuid[])
    INTO v_doc_ids
  FROM public.load_items
  WHERE id = ANY(_item_ids) AND load_id = _source_load_id AND tenant_id = _tenant_id;

  UPDATE public.load_items
    SET load_id = _target_load_id, updated_at = now()
    WHERE id = ANY(_item_ids) AND load_id = _source_load_id AND tenant_id = _tenant_id;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  IF array_length(v_doc_ids, 1) IS NOT NULL THEN
    UPDATE public.fiscal_documents
      SET load_id = _target_load_id, updated_at = now()
      WHERE id = ANY(v_doc_ids) AND tenant_id = _tenant_id;
  END IF;

  PERFORM public._log_entity_audit(_tenant_id, 'load', _source_load_id, 'move_items_out',
    NULL, jsonb_build_object('target_load_id', _target_load_id, 'item_ids', to_jsonb(_item_ids),
                             'document_ids', to_jsonb(v_doc_ids)), 'composition_rpc');
  PERFORM public._log_entity_audit(_tenant_id, 'load', _target_load_id, 'move_items_in',
    NULL, jsonb_build_object('source_load_id', _source_load_id, 'item_ids', to_jsonb(_item_ids),
                             'document_ids', to_jsonb(v_doc_ids)), 'composition_rpc');

  RETURN jsonb_build_object('moved', v_moved, 'document_ids', COALESCE(to_jsonb(v_doc_ids), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.delete_load_safely(_tenant_id uuid, _load_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_pod_count int;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF public._load_is_locked(_load_id) THEN RAISE EXCEPTION 'load_locked'; END IF;

  SELECT count(*) INTO v_pod_count FROM public.proof_of_delivery WHERE load_id = _load_id;
  IF v_pod_count > 0 THEN RAISE EXCEPTION 'load_has_pod'; END IF;

  UPDATE public.fiscal_documents SET load_id = NULL, updated_at = now()
    WHERE load_id = _load_id AND tenant_id = _tenant_id;
  DELETE FROM public.load_items WHERE load_id = _load_id AND tenant_id = _tenant_id;
  DELETE FROM public.loads WHERE id = _load_id AND tenant_id = _tenant_id;

  PERFORM public._log_entity_audit(_tenant_id, 'load', _load_id, 'delete_safely', NULL, NULL, 'composition_rpc');

  RETURN jsonb_build_object('deleted', true, 'load_id', _load_id);
END $$;

-- ============================================================
-- 6. STATUS PÚBLICO CENTRAL
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_public_shipment_status(_fiscal_document_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fd_status text; v_load_status text; v_stop_status text;
  v_has_pod boolean; v_has_critical_occ boolean;
  v_tenant uuid;
BEGIN
  SELECT fd.status, l.status, fd.tenant_id
    INTO v_fd_status, v_load_status, v_tenant
  FROM public.fiscal_documents fd
  LEFT JOIN public.loads l ON l.id = fd.load_id
  WHERE fd.id = _fiscal_document_id;

  SELECT ds.status INTO v_stop_status
  FROM public.dispatch_stop_documents dsd
  JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
  WHERE dsd.fiscal_document_id = _fiscal_document_id
  ORDER BY ds.updated_at DESC NULLS LAST LIMIT 1;

  SELECT EXISTS(SELECT 1 FROM public.proof_of_delivery
    WHERE fiscal_document_id = _fiscal_document_id AND status IN ('uploaded','validated'))
    INTO v_has_pod;

  SELECT EXISTS(SELECT 1 FROM public.operational_events oe
    WHERE oe.tenant_id = v_tenant AND oe.visible_to_client = true AND oe.public_status = 'open'
      AND oe.severity IN ('high','critical')
      AND oe.fiscal_document_id = _fiscal_document_id)
    INTO v_has_critical_occ;

  IF v_has_critical_occ THEN RETURN 'exception'; END IF;
  IF v_fd_status = 'refused' THEN RETURN 'not_delivered'; END IF;
  IF v_fd_status = 'returned' THEN RETURN 'returned'; END IF;
  IF v_fd_status IN ('failed','not_delivered') THEN RETURN 'not_delivered'; END IF;
  IF v_fd_status = 'partial_delivery' THEN RETURN 'exception'; END IF;
  IF v_fd_status = 'cancelled' THEN RETURN 'cancelled'; END IF;
  IF v_fd_status = 'delivered' THEN
    RETURN CASE WHEN v_has_pod THEN 'pod_available' ELSE 'pod_pending' END;
  END IF;
  IF v_stop_status IN ('arrived','servicing','in_progress') THEN RETURN 'arrived_at_destination'; END IF;
  IF v_stop_status = 'departed' THEN RETURN 'out_for_delivery'; END IF;
  IF v_load_status = 'in_transit' OR v_fd_status = 'in_transit' THEN RETURN 'in_transit'; END IF;
  IF v_load_status IN ('loading','loaded') OR v_fd_status IN ('loading','loaded') THEN RETURN 'loaded'; END IF;
  IF v_load_status IN ('planned','assembling','ready') THEN RETURN 'being_prepared'; END IF;
  IF v_fd_status IN ('confirmed','assigned','pending') THEN RETURN 'received'; END IF;
  RETURN COALESCE(v_fd_status, 'received');
END $$;

-- ============================================================
-- 7. RECORD OPERATIONAL EVENT WITH STATUS
-- ============================================================
CREATE OR REPLACE FUNCTION public.record_operational_event_with_status(
  _tenant_id uuid, _entity_type text, _entity_id uuid,
  _event_type text, _description text, _severity text DEFAULT 'medium',
  _new_status text DEFAULT NULL, _visible_to_client boolean DEFAULT false
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_load uuid; v_fd uuid; v_stop uuid; v_client uuid;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  IF _entity_type = 'load' THEN v_load := _entity_id;
  ELSIF _entity_type = 'fiscal_document' THEN
    v_fd := _entity_id;
    SELECT load_id, client_id INTO v_load, v_client FROM public.fiscal_documents WHERE id = _entity_id;
  ELSIF _entity_type = 'dispatch_stop' THEN
    v_stop := _entity_id;
    SELECT client_id INTO v_client FROM public.dispatch_stops WHERE id = _entity_id;
  ELSE
    RAISE EXCEPTION 'invalid_entity_type';
  END IF;

  IF _new_status IS NOT NULL THEN
    IF _entity_type = 'load' THEN
      UPDATE public.loads SET status = _new_status, updated_at = now()
        WHERE id = _entity_id AND tenant_id = _tenant_id;
    ELSIF _entity_type = 'fiscal_document' THEN
      UPDATE public.fiscal_documents SET status = _new_status, updated_at = now()
        WHERE id = _entity_id AND tenant_id = _tenant_id;
    ELSIF _entity_type = 'dispatch_stop' THEN
      UPDATE public.dispatch_stops SET status = _new_status, updated_at = now()
        WHERE id = _entity_id AND tenant_id = _tenant_id;
    END IF;
    PERFORM public._log_entity_audit(_tenant_id, _entity_type, _entity_id, 'status_change',
      NULL, jsonb_build_object('new_status', _new_status), 'traceability');
  END IF;

  INSERT INTO public.operational_events(
    tenant_id, client_id, load_id, fiscal_document_id, dispatch_stop_id,
    event_type, severity, description, visible_to_client, public_status, created_by
  ) VALUES (
    _tenant_id, v_client, v_load, v_fd, v_stop,
    _event_type, _severity, _description, _visible_to_client, 'reported_by_operator', auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- ============================================================
-- 8. AUDITORIA DE CONSISTÊNCIA
-- ============================================================
CREATE OR REPLACE FUNCTION public.audit_data_consistency(_tenant_id uuid)
RETURNS TABLE(severity text, category text, entity_type text, entity_id uuid, message text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_tenant_admin(_tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  RETURN QUERY
  SELECT 'critical'::text, 'composition'::text, 'fiscal_document'::text, fd.id,
    'load_id de fiscal_document diverge de load_items'::text
  FROM public.fiscal_documents fd
  JOIN public.load_items li ON li.fiscal_document_id = fd.id
  WHERE fd.tenant_id = _tenant_id AND fd.load_id IS NOT NULL AND li.load_id IS NOT NULL
    AND fd.load_id <> li.load_id;

  RETURN QUERY
  SELECT 'critical'::text, 'dispatch'::text, 'dispatch_trip'::text, dt.id,
    'dispatch_trips sem dispatch_trip_loads'::text
  FROM public.dispatch_trips dt
  WHERE dt.tenant_id = _tenant_id
    AND NOT EXISTS (SELECT 1 FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = dt.id);

  RETURN QUERY
  SELECT 'warning'::text, 'dispatch'::text, 'dispatch_stop'::text, ds.id,
    'parada sem documentos vinculados em viagem com cargas'::text
  FROM public.dispatch_stops ds
  JOIN public.dispatch_trips dt ON dt.id = ds.dispatch_trip_id
  WHERE ds.tenant_id = _tenant_id
    AND EXISTS (SELECT 1 FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = dt.id)
    AND NOT EXISTS (SELECT 1 FROM public.dispatch_stop_documents dsd WHERE dsd.dispatch_stop_id = ds.id);

  RETURN QUERY
  SELECT 'warning'::text, 'status'::text, 'load'::text, l.id,
    'carga delivered com documentos não terminais'::text
  FROM public.loads l
  WHERE l.tenant_id = _tenant_id AND l.status = 'delivered'
    AND EXISTS (SELECT 1 FROM public.fiscal_documents fd
                WHERE fd.load_id = l.id AND fd.status NOT IN
                  ('delivered','partial_delivery','returned','refused','failed','not_delivered','cancelled'));

  RETURN QUERY
  SELECT 'warning'::text, 'pod'::text, 'fiscal_document'::text, fd.id,
    'documento entregue sem POD registrado'::text
  FROM public.fiscal_documents fd
  WHERE fd.tenant_id = _tenant_id AND fd.status = 'delivered'
    AND NOT EXISTS (SELECT 1 FROM public.proof_of_delivery pod WHERE pod.fiscal_document_id = fd.id);

  RETURN QUERY
  SELECT 'warning'::text, 'status'::text, 'dispatch_stop'::text, ds.id,
    'parada terminal com documento em status não terminal'::text
  FROM public.dispatch_stops ds
  JOIN public.dispatch_stop_documents dsd ON dsd.dispatch_stop_id = ds.id
  JOIN public.fiscal_documents fd ON fd.id = dsd.fiscal_document_id
  WHERE ds.tenant_id = _tenant_id
    AND ds.status = ANY(public.stop_terminal_statuses())
    AND fd.status NOT IN ('delivered','partial_delivery','returned','refused','failed','not_delivered','cancelled');

  RETURN QUERY
  SELECT 'warning'::text, 'dispatch'::text, 'dispatch_trip'::text, dt.id,
    'viagem completed com parada não terminal'::text
  FROM public.dispatch_trips dt
  WHERE dt.tenant_id = _tenant_id AND dt.status = 'completed'
    AND EXISTS (SELECT 1 FROM public.dispatch_stops ds
                WHERE ds.dispatch_trip_id = dt.id
                  AND NOT (ds.status = ANY(public.stop_terminal_statuses())));

  RETURN QUERY
  SELECT 'warning'::text, 'occurrence'::text, 'operational_event'::text, oe.id,
    'ocorrência visível ao cliente sem client/document/stop'::text
  FROM public.operational_events oe
  WHERE oe.tenant_id = _tenant_id AND oe.visible_to_client = true
    AND oe.client_id IS NULL AND oe.fiscal_document_id IS NULL AND oe.dispatch_stop_id IS NULL;

  RETURN QUERY
  SELECT 'warning'::text, 'composition'::text, 'load'::text, l.id,
    'load.trip_id sem dispatch_trip_loads correspondente'::text
  FROM public.loads l
  WHERE l.tenant_id = _tenant_id AND l.trip_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.dispatch_trip_loads dtl
                    WHERE dtl.dispatch_trip_id = l.trip_id AND dtl.load_id = l.id);

  RETURN;
END $$;
