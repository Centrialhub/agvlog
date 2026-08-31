-- Privacy-only read API change. Bodies originate in the versioned local baseline.
-- No business row, Auth setting, table policy, fiscal provider or payment is changed.
set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$
declare c record; target oid;
begin
 for c in select * from(values
  ('public.get_client_portal_shipment_detail(uuid)','998fc3d8c047f0b944a9aa87dd33149c',true),
  ('public.get_client_portal_shipment_detail_v2(uuid)','d0c33a490f3eece9c4584191600092d4',true),
  ('public.portal_user_can_access_fiscal_document(uuid,uuid)','0acc48af61014c810d7b4461df1579dd',false),
  ('public.portal_user_can_view_financial(uuid,uuid)','0699997f6006927c07e314f0d7ff13ba',false),
  ('public.portal_user_can_download_fiscal_document(uuid,uuid)','fcd0d4b1fa8c6c203e2a84c44fbef4f7',false)
 ) expected(signature,hash,is_api) loop
  target:=to_regprocedure(c.signature);
  if md5(replace(pg_get_functiondef(target),E'\r\n',E'\n')) is distinct from c.hash then
   raise exception 'Portal privacy preflight refused: function changed %',c.signature;end if;
  if c.is_api and (has_function_privilege('anon',target,'execute') or not has_function_privilege('authenticated',target,'execute')
     or not has_function_privilege('service_role',target,'execute')) then
   raise exception 'Portal privacy preflight refused: privileges changed %',c.signature;end if;
 end loop;
end;
$guard$;
CREATE OR REPLACE FUNCTION public.get_client_portal_shipment_detail(_fiscal_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _fd public.fiscal_documents; _tenant uuid; _can_financial boolean := false;
  _trip_id uuid; _stop_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Acesso negado a este documento' USING ERRCODE='42501'; END IF;
  SELECT * INTO _fd FROM public.fiscal_documents WHERE id = _fiscal_document_id AND deleted_at IS NULL;
  IF _fd.id IS NULL THEN RAISE EXCEPTION 'Acesso negado a este documento' USING ERRCODE='42501'; END IF;
  _tenant := _fd.tenant_id;
  IF NOT public.portal_user_can_access_fiscal_document(_tenant, _fiscal_document_id) THEN
    RAISE EXCEPTION 'Acesso negado a este documento' USING ERRCODE='42501';
  END IF;
  _can_financial := public.portal_user_can_view_financial(_tenant, _fiscal_document_id);

  SELECT ds.dispatch_trip_id, ds.id INTO _trip_id, _stop_id
  FROM public.dispatch_stop_documents dsd
  JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
  WHERE dsd.fiscal_document_id = _fd.id AND dsd.tenant_id = _tenant AND ds.tenant_id = _tenant
    AND _fd.load_id IS NOT NULL AND (dsd.load_id = _fd.load_id OR (dsd.load_id IS NULL AND EXISTS (
      SELECT 1 FROM public.dispatch_trip_loads dtl WHERE dtl.tenant_id = _tenant
        AND dtl.dispatch_trip_id = ds.dispatch_trip_id AND dtl.load_id = _fd.load_id)))
    AND EXISTS (SELECT 1 FROM public.dispatch_trips dt WHERE dt.id = ds.dispatch_trip_id AND dt.tenant_id = _tenant)
  ORDER BY dsd.created_at DESC, dsd.id DESC LIMIT 1;

  RETURN jsonb_build_object(
    'context', jsonb_build_object('tenant_id', _tenant, 'actor_id', auth.uid(), 'document_id', _fd.id),
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
             FROM public.loads l WHERE l.id = _fd.load_id AND l.tenant_id = _tenant),
    'trip', (SELECT jsonb_build_object('id', dt.id, 'status', dt.status,
              'planned_start_at', dt.planned_start_at, 'actual_start_at', dt.actual_start_at,
              'planned_end_at', dt.planned_end_at, 'actual_end_at', dt.actual_end_at)
             FROM public.dispatch_trips dt WHERE dt.id = _trip_id AND dt.tenant_id = _tenant),
    'stop', (SELECT jsonb_build_object('id', ds.id, 'stop_order', ds.stop_order,
              'destination', ds.destination, 'status', ds.status,
              'planned_arrival_at', ds.planned_arrival_at,
              'actual_arrival_at', ds.actual_arrival_at,
              'actual_departure_at', ds.actual_departure_at)
             FROM public.dispatch_stops ds WHERE ds.id = _stop_id AND ds.tenant_id = _tenant),
    'events', '[]'::jsonb,
    'occurrences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', oe.id, 'event_type', oe.event_type,
              'severity', oe.severity, 'description', oe.description,
              'public_status', oe.public_status, 'resolved_at', oe.resolved_at,
              'created_at', oe.created_at) ORDER BY oe.created_at DESC)
      FROM public.operational_events oe
      WHERE oe.tenant_id = _tenant
        AND oe.visible_to_client = true
        AND (oe.fiscal_document_id = _fd.id OR (oe.fiscal_document_id IS NULL AND oe.client_id = _fd.client_id
          AND ((oe.dispatch_stop_id = _stop_id AND (oe.load_id IS NULL OR oe.load_id = _fd.load_id))
            OR (oe.dispatch_stop_id IS NULL AND oe.load_id = _fd.load_id))))
    ), '[]'::jsonb),
    'proofs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'proof_type', p.proof_type,
                'status', p.status, 'receiver_name', p.receiver_name, 'receiver_role', p.receiver_role,
                'received_at', p.received_at, 'validated_at', p.validated_at,
                'has_file', (p.storage_path IS NOT NULL)) ORDER BY p.created_at DESC)
                FROM public.proof_of_delivery p WHERE p.tenant_id = _tenant AND p.fiscal_document_id = _fd.id), '[]'::jsonb)
  );
END $function$;
CREATE OR REPLACE FUNCTION public.get_client_portal_shipment_detail_v2(_fiscal_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _fd public.fiscal_documents;
  _tenant uuid;
  _can_financial boolean := false;
  _can_driver boolean := false;
  _can_vehicle boolean := false;
  _trip_id uuid; _stop_id uuid;
  _timeline jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Acesso negado a este documento' USING ERRCODE='42501'; END IF;
  SELECT * INTO _fd FROM public.fiscal_documents WHERE id = _fiscal_document_id AND deleted_at IS NULL;
  IF _fd.id IS NULL THEN RAISE EXCEPTION 'Acesso negado a este documento' USING ERRCODE='42501'; END IF;
  _tenant := _fd.tenant_id;

  IF NOT public.portal_user_can_access_fiscal_document(_tenant, _fiscal_document_id) THEN
    RAISE EXCEPTION 'Acesso negado a este documento' USING ERRCODE='42501';
  END IF;

  _can_financial := public.portal_user_can_view_financial(_tenant, _fiscal_document_id);

  SELECT bool_or(can_view_driver_contact), bool_or(can_view_vehicle_live)
  INTO _can_driver, _can_vehicle
  FROM public.client_portal_access
  WHERE tenant_id = _tenant AND user_id = auth.uid() AND active = true
    AND client_id = _fd.client_id;

  SELECT ds.dispatch_trip_id, ds.id INTO _trip_id, _stop_id
  FROM public.dispatch_stop_documents dsd
  JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
  WHERE dsd.fiscal_document_id = _fd.id AND dsd.tenant_id = _tenant AND ds.tenant_id = _tenant
    AND _fd.load_id IS NOT NULL AND (dsd.load_id = _fd.load_id OR (dsd.load_id IS NULL AND EXISTS (
      SELECT 1 FROM public.dispatch_trip_loads dtl WHERE dtl.tenant_id = _tenant
        AND dtl.dispatch_trip_id = ds.dispatch_trip_id AND dtl.load_id = _fd.load_id)))
    AND EXISTS (SELECT 1 FROM public.dispatch_trips dt WHERE dt.id = ds.dispatch_trip_id AND dt.tenant_id = _tenant)
  ORDER BY dsd.created_at DESC, dsd.id DESC LIMIT 1;

  -- Build unified timeline
  WITH tl AS (
    -- Import/emit
    SELECT
      ('doc-' || _fd.id::text) AS id,
      'document'::text AS type,
      'Documento emitido'::text AS title,
      ('NF ' || COALESCE(_fd.invoice_number, '—') || ' registrada no sistema') AS description,
      COALESCE(_fd.imported_at, _fd.created_at) AS occurred_at,
      'info'::text AS severity,
      'received'::text AS public_status
    WHERE _fd.id IS NOT NULL
    UNION ALL
    -- Load link
    SELECT
      ('load-' || l.id::text),
      'status',
      ('Vinculada à carga ' || l.load_number),
      NULL,
      l.updated_at,
      'info',
      'being_prepared'
    FROM public.loads l WHERE l.id = _fd.load_id AND l.tenant_id = _tenant
    UNION ALL
    -- Trip start
    SELECT
      ('trip-start-' || dt.id::text),
      'status',
      'Viagem iniciada',
      NULL,
      dt.actual_start_at,
      'info',
      'in_transit'
    FROM public.dispatch_trips dt WHERE dt.id = _trip_id AND dt.tenant_id = _tenant AND dt.actual_start_at IS NOT NULL
    UNION ALL
    -- Stop arrival
    SELECT
      ('stop-arr-' || ds.id::text),
      'status',
      'Chegou ao destino',
      COALESCE(ds.destination, ''),
      ds.actual_arrival_at,
      'info',
      'arrived_at_destination'
    FROM public.dispatch_stops ds WHERE ds.id = _stop_id AND ds.tenant_id = _tenant AND ds.actual_arrival_at IS NOT NULL
    UNION ALL
    -- Stop departure
    SELECT
      ('stop-dep-' || ds.id::text),
      'status',
      'Saída da parada',
      NULL,
      ds.actual_departure_at,
      'info',
      NULL
    FROM public.dispatch_stops ds WHERE ds.id = _stop_id AND ds.tenant_id = _tenant AND ds.actual_departure_at IS NOT NULL
    UNION ALL
    -- Private dispatch_events are not a client publication channel.
    -- Occurrences visible to client
    SELECT
      ('oc-' || oe.id::text),
      'occurrence',
      ('Ocorrência: ' || COALESCE(oe.event_type, '—')),
      COALESCE(oe.description, ''),
      oe.created_at,
      CASE WHEN oe.severity IN ('critical','high') THEN 'danger'
           WHEN oe.severity = 'medium' THEN 'warning'
           ELSE 'info' END,
      'exception'
    FROM public.operational_events oe
    WHERE oe.tenant_id = _tenant
      AND oe.visible_to_client = true
      AND (oe.fiscal_document_id = _fd.id OR (oe.fiscal_document_id IS NULL AND oe.client_id = _fd.client_id
          AND ((oe.dispatch_stop_id = _stop_id AND (oe.load_id IS NULL OR oe.load_id = _fd.load_id))
            OR (oe.dispatch_stop_id IS NULL AND oe.load_id = _fd.load_id))))
    UNION ALL
    -- POD received
    SELECT
      ('pod-rec-' || p.id::text),
      'pod',
      'Canhoto recebido',
      NULL,
      p.received_at,
      'success',
      'pod_pending'
    FROM public.proof_of_delivery p
    WHERE p.tenant_id = _tenant AND p.fiscal_document_id = _fd.id AND p.received_at IS NOT NULL
    UNION ALL
    -- POD validated
    SELECT
      ('pod-val-' || p.id::text),
      'pod',
      'Canhoto validado',
      NULL,
      p.validated_at,
      'success',
      'pod_available'
    FROM public.proof_of_delivery p
    WHERE p.tenant_id = _tenant AND p.fiscal_document_id = _fd.id AND p.validated_at IS NOT NULL
    UNION ALL
    -- Delivered
    SELECT
      ('deliv-' || _fd.id::text),
      'status',
      'Entrega concluída',
      NULL,
      _fd.updated_at,
      'success',
      'delivered'
    WHERE _fd.status = 'delivered'
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY occurred_at NULLS LAST), '[]'::jsonb)
  INTO _timeline
  FROM (SELECT * FROM tl WHERE occurred_at IS NOT NULL) t;

  RETURN jsonb_build_object(
    'context', jsonb_build_object('tenant_id', _tenant, 'actor_id', auth.uid(), 'document_id', _fd.id),
    'document', jsonb_build_object(
      'id', _fd.id, 'invoice_number', _fd.invoice_number, 'access_key', _fd.access_key,
      'document_type', _fd.document_type, 'issue_date', _fd.issue_date, 'status', _fd.status,
      'client_load_number', _fd.client_load_number, 'reference_number', _fd.reference_number,
      'remitter', _fd.remitter, 'remitter_cnpj', _fd.remitter_cnpj,
      'recipient', _fd.recipient, 'recipient_cnpj', _fd.recipient_cnpj,
      'recipient_city', _fd.recipient_city, 'recipient_state', _fd.recipient_state,
      'recipient_neighborhood', _fd.recipient_neighborhood,
      'product_summary', _fd.product_summary, 'pallet_count', _fd.pallet_count, 'weight_kg', _fd.weight_kg,
      'volume_count', _fd.volume_count,
      'value', CASE WHEN _can_financial THEN _fd.value END,
      'freight_value', CASE WHEN _can_financial THEN _fd.freight_value END,
      'public_status',
        CASE
          WHEN EXISTS (SELECT 1 FROM public.operational_events o WHERE o.tenant_id=_tenant AND o.visible_to_client=true
                        AND o.public_status='open' AND (o.fiscal_document_id = _fd.id OR (o.fiscal_document_id IS NULL AND o.client_id = _fd.client_id
          AND ((o.dispatch_stop_id = _stop_id AND (o.load_id IS NULL OR o.load_id = _fd.load_id))
            OR (o.dispatch_stop_id IS NULL AND o.load_id = _fd.load_id)))))
            THEN 'exception'
          WHEN _fd.status = 'delivered' AND EXISTS (SELECT 1 FROM public.proof_of_delivery p
                        WHERE p.tenant_id = _tenant AND p.fiscal_document_id = _fd.id AND p.status IN ('uploaded','validated'))
            THEN 'pod_available'
          WHEN _fd.status = 'delivered' THEN 'pod_pending'
          WHEN _fd.status = 'in_transit' THEN 'in_transit'
          WHEN _fd.status IN ('loading','loaded') THEN 'loaded'
          ELSE 'received'
        END
    ),
    'load', (SELECT jsonb_build_object('id', l.id, 'load_number', l.load_number, 'status', l.status,
              'origin', l.origin, 'destination', l.destination,
              'total_pallet_count', l.total_pallet_count, 'total_weight_kg', l.total_weight_kg)
             FROM public.loads l WHERE l.id = _fd.load_id AND l.tenant_id = _tenant),
    'trip', (SELECT jsonb_build_object('id', dt.id, 'status', dt.status,
              'planned_start_at', dt.planned_start_at, 'actual_start_at', dt.actual_start_at,
              'planned_end_at', dt.planned_end_at, 'actual_end_at', dt.actual_end_at,
              'driver_name', CASE WHEN _can_driver THEN drv.name END,
              'driver_phone', CASE WHEN _can_driver THEN drv.phone END,
              'vehicle_plate', CASE WHEN _can_vehicle THEN v.plate END)
             FROM public.dispatch_trips dt
             LEFT JOIN public.drivers drv ON drv.id = dt.driver_id AND drv.tenant_id = _tenant
             LEFT JOIN public.vehicles v ON v.id = dt.vehicle_id AND v.tenant_id = _tenant
             WHERE dt.id = _trip_id AND dt.tenant_id = _tenant),
    'stop', (SELECT jsonb_build_object('id', ds.id, 'stop_order', ds.stop_order,
              'destination', ds.destination, 'status', ds.status,
              'planned_arrival_at', ds.planned_arrival_at,
              'actual_arrival_at', ds.actual_arrival_at,
              'actual_departure_at', ds.actual_departure_at)
             FROM public.dispatch_stops ds WHERE ds.id = _stop_id AND ds.tenant_id = _tenant),
    'timeline', _timeline,
    'occurrences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', oe.id, 'event_type', oe.event_type,
              'severity', oe.severity, 'description', oe.description,
              'public_status', oe.public_status, 'resolved_at', oe.resolved_at,
              'client_action_required', oe.client_action_required,
              'client_resolution_note', oe.client_resolution_note,
              'created_at', oe.created_at) ORDER BY oe.created_at DESC)
      FROM public.operational_events oe
      WHERE oe.tenant_id = _tenant
        AND oe.visible_to_client = true
        AND (oe.fiscal_document_id = _fd.id OR (oe.fiscal_document_id IS NULL AND oe.client_id = _fd.client_id
          AND ((oe.dispatch_stop_id = _stop_id AND (oe.load_id IS NULL OR oe.load_id = _fd.load_id))
            OR (oe.dispatch_stop_id IS NULL AND oe.load_id = _fd.load_id))))
    ), '[]'::jsonb),
    'proofs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'proof_type', p.proof_type,
                'status', p.status, 'receiver_name', p.receiver_name, 'receiver_role', p.receiver_role,
                'receiver_document', CASE WHEN _can_financial THEN p.receiver_document END,
                'received_at', p.received_at, 'validated_at', p.validated_at,
                'has_file', (p.storage_path IS NOT NULL)) ORDER BY p.created_at DESC)
                FROM public.proof_of_delivery p WHERE p.tenant_id = _tenant AND p.fiscal_document_id = _fd.id), '[]'::jsonb),
    'permissions', jsonb_build_object(
      'can_view_financial', _can_financial,
      'can_download_documents', public.portal_user_can_download_fiscal_document(_tenant, _fd.id),
      'can_view_driver_contact', _can_driver,
      'can_view_vehicle_live', _can_vehicle
    )
  );
END;
$function$;
