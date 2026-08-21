
-- ============================================================
-- Hardening round: consistência funcional, auditoria e portal
-- ============================================================

-- 1) get_public_shipment_status: considera ocorrências por documento, parada (via dsd) ou cliente
CREATE OR REPLACE FUNCTION public.get_public_shipment_status(_fiscal_document_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_fd_status text; v_load_status text; v_stop_status text;
  v_has_pod boolean; v_has_critical_occ boolean;
  v_tenant uuid; v_client uuid; v_load uuid;
BEGIN
  SELECT fd.status, l.status, fd.tenant_id, fd.client_id, fd.load_id
    INTO v_fd_status, v_load_status, v_tenant, v_client, v_load
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

  -- Ocorrência crítica vinculada à NF, à parada que contém a NF, ou ao cliente da NF (visível)
  SELECT EXISTS(
    SELECT 1 FROM public.operational_events oe
    WHERE oe.tenant_id = v_tenant
      AND oe.visible_to_client = true
      AND oe.public_status = 'open'
      AND oe.severity IN ('high','critical')
      AND (
        oe.fiscal_document_id = _fiscal_document_id
        OR oe.dispatch_stop_id IN (
          SELECT dsd.dispatch_stop_id FROM public.dispatch_stop_documents dsd
          WHERE dsd.fiscal_document_id = _fiscal_document_id
        )
        OR (oe.client_id IS NOT NULL AND oe.client_id = v_client
            AND (oe.fiscal_document_id IS NULL OR oe.fiscal_document_id = _fiscal_document_id))
      )
  ) INTO v_has_critical_occ;

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

-- 2) search_client_portal_shipments: inclui public_status e refina has_open_occurrence
CREATE OR REPLACE FUNCTION public.search_client_portal_shipments(
  _tenant_id uuid, _search text DEFAULT NULL, _status text[] DEFAULT NULL,
  _start_date date DEFAULT NULL, _end_date date DEFAULT NULL,
  _city text DEFAULT NULL, _state text DEFAULT NULL,
  _has_pod boolean DEFAULT NULL, _has_occurrence boolean DEFAULT NULL,
  _limit integer DEFAULT 50, _offset integer DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
      EXISTS (
        SELECT 1 FROM public.operational_events oe
        WHERE oe.tenant_id = _tenant_id AND oe.visible_to_client = true AND oe.public_status = 'open'
          AND (
            oe.fiscal_document_id = fd.id
            OR oe.dispatch_stop_id IN (SELECT dsd.dispatch_stop_id FROM public.dispatch_stop_documents dsd WHERE dsd.fiscal_document_id = fd.id)
            OR (oe.client_id IS NOT NULL AND oe.client_id = fd.client_id
                AND (oe.fiscal_document_id IS NULL OR oe.fiscal_document_id = fd.id))
          )
      ) AS has_open_occurrence,
      public.get_public_shipment_status(fd.id) AS public_status
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

-- 3) list_client_pickups: usa portal_user_can_access_pickup_order
CREATE OR REPLACE FUNCTION public.list_client_pickups(
  _tenant_id uuid, _status text DEFAULT NULL,
  _start_date timestamptz DEFAULT NULL, _end_date timestamptz DEFAULT NULL,
  _limit integer DEFAULT 100, _offset integer DEFAULT 0)
RETURNS TABLE(id uuid, pickup_number text, remitter_name text, remitter_cnpj text,
              recipient_name text, pickup_at timestamptz, status text, notes text,
              linked_docs_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.id, p.pickup_number, p.remitter_name, p.remitter_cnpj, p.recipient_name,
    p.pickup_at, p.status, p.notes,
    (SELECT COUNT(*) FROM public.fiscal_documents fd WHERE fd.pickup_order_id = p.id) AS linked_docs_count
  FROM public.pickup_orders p
  WHERE p.tenant_id = _tenant_id
    AND public.portal_user_can_access_pickup_order(_tenant_id, p.id)
    AND (_status IS NULL OR p.status = _status)
    AND (_start_date IS NULL OR p.pickup_at >= _start_date)
    AND (_end_date IS NULL OR p.pickup_at <= _end_date)
  ORDER BY p.pickup_at DESC NULLS LAST
  LIMIT _limit OFFSET _offset;
$$;

-- 4) record_operational_event_with_status: valida transição (não regride terminais), audita por entidade certa
CREATE OR REPLACE FUNCTION public.record_operational_event_with_status(
  _tenant_id uuid, _entity_type text, _entity_id uuid,
  _event_type text, _description text,
  _severity text DEFAULT 'medium', _new_status text DEFAULT NULL,
  _visible_to_client boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid; v_load uuid; v_fd uuid; v_stop uuid; v_client uuid;
  v_old_status text; v_terminal text[] := ARRAY[
    'delivered','partial_delivery','returned','refused','failed','cancelled','not_delivered'];
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _entity_type NOT IN ('load','fiscal_document','dispatch_stop') THEN
    RAISE EXCEPTION 'invalid_entity_type';
  END IF;

  IF _entity_type = 'load' THEN
    v_load := _entity_id;
    SELECT status INTO v_old_status FROM public.loads WHERE id = _entity_id AND tenant_id = _tenant_id;
  ELSIF _entity_type = 'fiscal_document' THEN
    v_fd := _entity_id;
    SELECT status, load_id, client_id INTO v_old_status, v_load, v_client
      FROM public.fiscal_documents WHERE id = _entity_id AND tenant_id = _tenant_id;
  ELSE
    v_stop := _entity_id;
    SELECT status, client_id INTO v_old_status, v_client
      FROM public.dispatch_stops WHERE id = _entity_id AND tenant_id = _tenant_id;
  END IF;

  IF _new_status IS NOT NULL THEN
    -- Bloqueia regredir de terminal salvo se for o mesmo
    IF v_old_status = ANY(v_terminal) AND _new_status <> v_old_status THEN
      RAISE EXCEPTION 'terminal_status_locked: % -> %', v_old_status, _new_status;
    END IF;

    IF _entity_type = 'load' THEN
      UPDATE public.loads SET status = _new_status, updated_at = now()
        WHERE id = _entity_id AND tenant_id = _tenant_id;
    ELSIF _entity_type = 'fiscal_document' THEN
      UPDATE public.fiscal_documents SET status = _new_status, updated_at = now()
        WHERE id = _entity_id AND tenant_id = _tenant_id;
      -- Propaga para carga apenas se todas as NFs forem terminais
      IF v_load IS NOT NULL AND _new_status = ANY(v_terminal) THEN
        IF NOT EXISTS (
          SELECT 1 FROM public.fiscal_documents fd
          WHERE fd.load_id = v_load AND NOT (fd.status = ANY(v_terminal))
        ) THEN
          UPDATE public.loads SET status = 'delivered', updated_at = now()
            WHERE id = v_load AND tenant_id = _tenant_id
              AND NOT (status = ANY(v_terminal));
        END IF;
      END IF;
    ELSE
      UPDATE public.dispatch_stops SET status = _new_status, updated_at = now()
        WHERE id = _entity_id AND tenant_id = _tenant_id;
    END IF;

    PERFORM public._log_entity_audit(
      _tenant_id, _entity_type, _entity_id, 'status_change',
      jsonb_build_object('old_status', v_old_status),
      jsonb_build_object('new_status', _new_status),
      'record_operational_event_with_status');
  END IF;

  INSERT INTO public.operational_events(
    tenant_id, client_id, load_id, fiscal_document_id, dispatch_stop_id,
    event_type, severity, description, visible_to_client, public_status, created_by
  ) VALUES (
    _tenant_id, v_client, v_load, v_fd, v_stop,
    _event_type, _severity, _description, _visible_to_client, 'reported_by_operator', auth.uid()
  ) RETURNING id INTO v_id;

  PERFORM public._log_entity_audit(
    _tenant_id, _entity_type, _entity_id, 'operational_event',
    NULL,
    jsonb_build_object('event_id', v_id, 'event_type', _event_type, 'severity', _severity,
                       'visible_to_client', _visible_to_client),
    'record_operational_event_with_status');

  RETURN v_id;
END $$;

-- 5) delete_load_safely: reforça checks (dispatch_trip_loads, documentos entregues, ocorrência crítica)
CREATE OR REPLACE FUNCTION public.delete_load_safely(_tenant_id uuid, _load_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_pod int; v_terminal_doc int; v_dtl int; v_crit_occ int;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF public._load_is_locked(_load_id) THEN RAISE EXCEPTION 'load_locked'; END IF;

  SELECT count(*) INTO v_pod FROM public.proof_of_delivery WHERE load_id = _load_id;
  IF v_pod > 0 THEN RAISE EXCEPTION 'load_has_pod'; END IF;

  SELECT count(*) INTO v_terminal_doc
    FROM public.fiscal_documents
    WHERE load_id = _load_id AND tenant_id = _tenant_id
      AND status IN ('delivered','partial_delivery','returned','refused','failed','not_delivered');
  IF v_terminal_doc > 0 THEN RAISE EXCEPTION 'load_has_terminal_documents'; END IF;

  SELECT count(*) INTO v_dtl FROM public.dispatch_trip_loads WHERE load_id = _load_id;
  IF v_dtl > 0 THEN RAISE EXCEPTION 'load_in_dispatch_trip'; END IF;

  SELECT count(*) INTO v_crit_occ
    FROM public.operational_events
    WHERE load_id = _load_id AND public_status = 'open' AND severity IN ('high','critical');
  IF v_crit_occ > 0 THEN RAISE EXCEPTION 'load_has_critical_occurrence'; END IF;

  UPDATE public.fiscal_documents SET load_id = NULL, updated_at = now()
    WHERE load_id = _load_id AND tenant_id = _tenant_id;
  DELETE FROM public.load_items WHERE load_id = _load_id AND tenant_id = _tenant_id;
  DELETE FROM public.loads WHERE id = _load_id AND tenant_id = _tenant_id;

  PERFORM public._log_entity_audit(_tenant_id, 'load', _load_id, 'delete_safely', NULL, NULL, 'composition_rpc');

  RETURN jsonb_build_object('deleted', true, 'load_id', _load_id);
END $$;

-- 6) delete_loads_safely (bulk): retorna jsonb por carga com sucesso/erro
CREATE OR REPLACE FUNCTION public.delete_loads_safely(_tenant_id uuid, _load_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid; v_result jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _load_ids IS NULL THEN RETURN v_result; END IF;
  FOREACH v_id IN ARRAY _load_ids LOOP
    BEGIN
      PERFORM public.delete_load_safely(_tenant_id, v_id);
      v_result := v_result || jsonb_build_object('load_id', v_id, 'ok', true);
    EXCEPTION WHEN OTHERS THEN
      v_result := v_result || jsonb_build_object('load_id', v_id, 'ok', false, 'error', SQLERRM);
    END;
  END LOOP;
  RETURN v_result;
END $$;

-- 7) audit_data_consistency: expande verificações
CREATE OR REPLACE FUNCTION public.audit_data_consistency(_tenant_id uuid)
RETURNS TABLE(severity text, category text, entity_type text, entity_id uuid, message text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_tenant_admin(_tenant_id) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  -- Composição
  RETURN QUERY SELECT 'critical','composition','fiscal_document',fd.id,
    'load_id de fiscal_document diverge de load_items'
  FROM public.fiscal_documents fd JOIN public.load_items li ON li.fiscal_document_id = fd.id
  WHERE fd.tenant_id=_tenant_id AND fd.load_id IS NOT NULL AND li.load_id IS NOT NULL
    AND fd.load_id <> li.load_id;

  RETURN QUERY SELECT 'critical','composition','fiscal_document',fd.id,
    'fiscal_document.load_id preenchido sem load_items correspondente'
  FROM public.fiscal_documents fd
  WHERE fd.tenant_id=_tenant_id AND fd.load_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.load_items li WHERE li.fiscal_document_id = fd.id AND li.load_id = fd.load_id);

  RETURN QUERY SELECT 'warning','composition','load_item',li.id,
    'load_item sem fiscal_document.load_id correspondente'
  FROM public.load_items li
  JOIN public.fiscal_documents fd ON fd.id = li.fiscal_document_id
  WHERE li.tenant_id=_tenant_id AND li.load_id IS NOT NULL
    AND (fd.load_id IS NULL OR fd.load_id <> li.load_id);

  -- Dispatch
  RETURN QUERY SELECT 'critical','dispatch','dispatch_trip',dt.id,
    'dispatch_trips sem dispatch_trip_loads'
  FROM public.dispatch_trips dt WHERE dt.tenant_id=_tenant_id
    AND NOT EXISTS (SELECT 1 FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = dt.id);

  RETURN QUERY SELECT 'critical','dispatch','dispatch_stop_document',dsd.dispatch_stop_id,
    'dispatch_stop_documents.fiscal_document_id fora das cargas da viagem'
  FROM public.dispatch_stop_documents dsd
  JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
  JOIN public.fiscal_documents fd ON fd.id = dsd.fiscal_document_id
  WHERE ds.tenant_id=_tenant_id AND fd.load_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.dispatch_trip_loads dtl
      WHERE dtl.dispatch_trip_id = ds.dispatch_trip_id AND dtl.load_id = fd.load_id
    );

  RETURN QUERY SELECT 'warning','dispatch','dispatch_stop',ds.id,
    'parada sem documentos vinculados em viagem com cargas'
  FROM public.dispatch_stops ds JOIN public.dispatch_trips dt ON dt.id = ds.dispatch_trip_id
  WHERE ds.tenant_id=_tenant_id
    AND EXISTS (SELECT 1 FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id=dt.id)
    AND NOT EXISTS (SELECT 1 FROM public.dispatch_stop_documents dsd WHERE dsd.dispatch_stop_id = ds.id);

  RETURN QUERY SELECT 'critical','dispatch','dispatch_stop_document',dsd1.dispatch_stop_id,
    'documento duplicado em duas paradas ativas da mesma viagem'
  FROM public.dispatch_stop_documents dsd1
  JOIN public.dispatch_stops ds1 ON ds1.id = dsd1.dispatch_stop_id
  JOIN public.dispatch_stop_documents dsd2 ON dsd2.fiscal_document_id = dsd1.fiscal_document_id AND dsd2.dispatch_stop_id <> dsd1.dispatch_stop_id
  JOIN public.dispatch_stops ds2 ON ds2.id = dsd2.dispatch_stop_id AND ds2.dispatch_trip_id = ds1.dispatch_trip_id
  WHERE ds1.tenant_id=_tenant_id
    AND NOT (ds1.status = ANY(public.stop_terminal_statuses()))
    AND NOT (ds2.status = ANY(public.stop_terminal_statuses()));

  -- POD
  RETURN QUERY SELECT 'critical','pod','proof_of_delivery',pod.id,
    'POD.fiscal_document_id não pertence ao dispatch_stop_id'
  FROM public.proof_of_delivery pod
  WHERE pod.tenant_id=_tenant_id AND pod.dispatch_stop_id IS NOT NULL AND pod.fiscal_document_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.dispatch_stop_documents dsd
      WHERE dsd.dispatch_stop_id = pod.dispatch_stop_id AND dsd.fiscal_document_id = pod.fiscal_document_id
    );

  RETURN QUERY SELECT 'warning','pod','proof_of_delivery',pod.id,
    'POD.load_id diverge do load do documento'
  FROM public.proof_of_delivery pod
  JOIN public.fiscal_documents fd ON fd.id = pod.fiscal_document_id
  WHERE pod.tenant_id=_tenant_id AND pod.load_id IS NOT NULL AND fd.load_id IS NOT NULL
    AND pod.load_id <> fd.load_id;

  RETURN QUERY SELECT 'critical','pod','proof_of_delivery',pod.id,
    'POD uploaded/validated sem storage_path'
  FROM public.proof_of_delivery pod
  WHERE pod.tenant_id=_tenant_id AND pod.status IN ('uploaded','validated')
    AND (pod.storage_path IS NULL OR pod.storage_path = '');

  -- Status
  RETURN QUERY SELECT 'warning','status','load',l.id,
    'carga delivered com documentos não terminais'
  FROM public.loads l WHERE l.tenant_id=_tenant_id AND l.status='delivered'
    AND EXISTS (SELECT 1 FROM public.fiscal_documents fd WHERE fd.load_id=l.id
                AND fd.status NOT IN ('delivered','partial_delivery','returned','refused','failed','not_delivered','cancelled'));

  RETURN QUERY SELECT 'warning','pod','fiscal_document',fd.id,
    'documento delivered sem POD registrado'
  FROM public.fiscal_documents fd WHERE fd.tenant_id=_tenant_id AND fd.status='delivered'
    AND NOT EXISTS (SELECT 1 FROM public.proof_of_delivery p WHERE p.fiscal_document_id=fd.id);

  RETURN QUERY SELECT 'warning','status','dispatch_stop',ds.id,
    'parada terminal com documento em status não terminal'
  FROM public.dispatch_stops ds
  JOIN public.dispatch_stop_documents dsd ON dsd.dispatch_stop_id = ds.id
  JOIN public.fiscal_documents fd ON fd.id = dsd.fiscal_document_id
  WHERE ds.tenant_id=_tenant_id AND ds.status = ANY(public.stop_terminal_statuses())
    AND fd.status NOT IN ('delivered','partial_delivery','returned','refused','failed','not_delivered','cancelled');

  RETURN QUERY SELECT 'warning','dispatch','dispatch_trip',dt.id,
    'viagem completed com parada não terminal'
  FROM public.dispatch_trips dt WHERE dt.tenant_id=_tenant_id AND dt.status='completed'
    AND EXISTS (SELECT 1 FROM public.dispatch_stops ds WHERE ds.dispatch_trip_id=dt.id
                AND NOT (ds.status = ANY(public.stop_terminal_statuses())));

  -- Ocorrências / Portal
  RETURN QUERY SELECT 'warning','occurrence','operational_event',oe.id,
    'ocorrência visível ao cliente sem client/document/stop'
  FROM public.operational_events oe WHERE oe.tenant_id=_tenant_id AND oe.visible_to_client=true
    AND oe.client_id IS NULL AND oe.fiscal_document_id IS NULL AND oe.dispatch_stop_id IS NULL;

  RETURN QUERY SELECT 'warning','occurrence','operational_event',oe.id,
    'ocorrência visível com client_id que não bate com documento'
  FROM public.operational_events oe
  JOIN public.fiscal_documents fd ON fd.id = oe.fiscal_document_id
  WHERE oe.tenant_id=_tenant_id AND oe.visible_to_client=true
    AND oe.client_id IS NOT NULL AND fd.client_id IS NOT NULL AND oe.client_id <> fd.client_id;

  RETURN QUERY SELECT 'warning','portal','client_portal_access',cpa.id,
    'client_portal_access órfão (cliente, usuário ou tenant inválido)'
  FROM public.client_portal_access cpa
  WHERE cpa.tenant_id=_tenant_id
    AND (NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = cpa.client_id)
         OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = cpa.user_id));

  RETURN QUERY SELECT 'warning','pickup','pickup_order',po.id,
    'pickup_orders sem cliente válido'
  FROM public.pickup_orders po
  WHERE po.tenant_id=_tenant_id AND po.remitter_client_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = po.remitter_client_id);

  RETURN QUERY SELECT 'warning','composition','load',l.id,
    'load.trip_id sem dispatch_trip_loads correspondente'
  FROM public.loads l WHERE l.tenant_id=_tenant_id AND l.trip_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.dispatch_trip_loads dtl
                    WHERE dtl.dispatch_trip_id=l.trip_id AND dtl.load_id=l.id);

  RETURN QUERY SELECT 'critical','composition','dispatch_trip_load',dtl.dispatch_trip_id,
    'dispatch_trip_loads.load_id sem carga válida'
  FROM public.dispatch_trip_loads dtl
  JOIN public.dispatch_trips dt ON dt.id = dtl.dispatch_trip_id
  WHERE dt.tenant_id=_tenant_id
    AND NOT EXISTS (SELECT 1 FROM public.loads l WHERE l.id = dtl.load_id);

  RETURN;
END $$;

-- 8) Audit POD download via entity_audit_log (RPC chamável da Edge Function)
CREATE OR REPLACE FUNCTION public.log_pod_access(
  _tenant_id uuid, _pod_id uuid, _fiscal_document_id uuid,
  _success boolean, _source text DEFAULT 'portal_pod_download')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_role text;
BEGIN
  SELECT 'portal'::text INTO v_role;
  INSERT INTO public.entity_audit_log(
    tenant_id, entity_type, entity_id, action,
    old_data, new_data, actor_user_id, actor_role, source
  ) VALUES (
    _tenant_id, 'proof_of_delivery', _pod_id, 'pod_download',
    NULL,
    jsonb_build_object('fiscal_document_id', _fiscal_document_id, 'success', _success),
    auth.uid(), v_role, _source
  );
END $$;

GRANT EXECUTE ON FUNCTION public.log_pod_access(uuid, uuid, uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_loads_safely(uuid, uuid[]) TO authenticated, service_role;
