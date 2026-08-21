
-- 1) get_user_client_access_detailed
CREATE OR REPLACE FUNCTION public.get_user_client_access_detailed(_tenant_id uuid)
RETURNS TABLE (
  client_id uuid,
  client_name text,
  client_tax_id text,
  access_type text,
  can_view_financial boolean,
  can_download_documents boolean,
  can_open_occurrences boolean,
  can_request_pickup boolean,
  can_view_vehicle_live boolean,
  can_view_driver_contact boolean,
  active boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT cpa.client_id,
         COALESCE(c.trade_name, c.company_name, 'Cliente') AS client_name,
         c.tax_id AS client_tax_id,
         cpa.access_type,
         cpa.can_view_financial, cpa.can_download_documents,
         cpa.can_open_occurrences, cpa.can_request_pickup,
         cpa.can_view_vehicle_live, cpa.can_view_driver_contact,
         cpa.active
  FROM public.client_portal_access cpa
  LEFT JOIN public.clients c ON c.id = cpa.client_id
  WHERE cpa.tenant_id = _tenant_id
    AND cpa.user_id = auth.uid()
    AND cpa.active = true
  ORDER BY client_name;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_client_access_detailed(uuid) TO authenticated;

-- 2) get_client_portal_summary_v2
CREATE OR REPLACE FUNCTION public.get_client_portal_summary_v2(
  _tenant_id uuid,
  _client_id uuid DEFAULT NULL,
  _start_date date DEFAULT NULL,
  _end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  _client_ids uuid[];
  _result jsonb;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT client_id), ARRAY[]::uuid[])
  INTO _client_ids
  FROM public.client_portal_access
  WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true
    AND (_client_id IS NULL OR client_id = _client_id);

  IF array_length(_client_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'in_transit',0,'delivered',0,'delayed',0,
      'pending_pickup',0,'scheduled_pickups',0,
      'pending_pod',0,'open_occurrences',0,
      'client_action_required',0,
      'deliveries_today',0,'deliveries_tomorrow',0,
      'documents_last_7_days',0
    );
  END IF;

  WITH fds AS (
    SELECT fd.* FROM public.fiscal_documents fd
    WHERE fd.tenant_id = _tenant_id AND fd.client_id = ANY(_client_ids)
      AND (_start_date IS NULL OR fd.issue_date >= _start_date)
      AND (_end_date   IS NULL OR fd.issue_date <= _end_date)
  )
  SELECT jsonb_build_object(
    'in_transit', (SELECT count(*) FROM fds WHERE status IN ('in_transit','loading','loaded')),
    'delivered',  (SELECT count(*) FROM fds WHERE status = 'delivered'),
    'delayed', (SELECT count(*) FROM fds fd
                JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                WHERE ds.status IN ('pending','arriving','in_progress')
                  AND ds.planned_arrival_at < now()),
    'pending_pickup', (SELECT count(*) FROM public.pickup_orders po
                       WHERE po.tenant_id = _tenant_id
                         AND po.status IN ('pendente','vinculada')
                         AND po.remitter_client_id = ANY(_client_ids)),
    'scheduled_pickups', (SELECT count(*) FROM public.pickup_orders po
                          WHERE po.tenant_id = _tenant_id
                            AND po.status = 'agendada'
                            AND po.remitter_client_id = ANY(_client_ids)),
    'pending_pod', (SELECT count(*) FROM fds fd
                    WHERE fd.status = 'delivered'
                      AND NOT EXISTS (SELECT 1 FROM public.proof_of_delivery p
                                      WHERE p.fiscal_document_id = fd.id
                                        AND p.status IN ('uploaded','validated'))),
    'open_occurrences', (SELECT count(*) FROM public.operational_events oe
                         WHERE oe.tenant_id = _tenant_id
                           AND oe.visible_to_client = true
                           AND oe.public_status = 'open'
                           AND oe.client_id = ANY(_client_ids)),
    'client_action_required', (SELECT count(*) FROM public.operational_events oe
                               WHERE oe.tenant_id = _tenant_id
                                 AND oe.visible_to_client = true
                                 AND oe.client_action_required = true
                                 AND oe.public_status <> 'resolved'
                                 AND oe.client_id = ANY(_client_ids)),
    'deliveries_today', (SELECT count(*) FROM fds fd
                         JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                         JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                         WHERE ds.planned_arrival_at::date = CURRENT_DATE),
    'deliveries_tomorrow', (SELECT count(*) FROM fds fd
                            JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                            JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                            WHERE ds.planned_arrival_at::date = CURRENT_DATE + 1),
    'documents_last_7_days', (SELECT count(*) FROM fds WHERE issue_date >= CURRENT_DATE - 7)
  ) INTO _result;

  RETURN _result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_client_portal_summary_v2(uuid, uuid, date, date) TO authenticated;

-- 3) get_client_portal_upcoming_deliveries
CREATE OR REPLACE FUNCTION public.get_client_portal_upcoming_deliveries(
  _tenant_id uuid,
  _client_id uuid DEFAULT NULL,
  _limit integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  _client_ids uuid[];
  _can_driver boolean := false;
  _can_vehicle boolean := false;
  _rows jsonb;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT client_id), ARRAY[]::uuid[])
  INTO _client_ids
  FROM public.client_portal_access
  WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true
    AND (_client_id IS NULL OR client_id = _client_id);

  IF array_length(_client_ids, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT bool_or(can_view_driver_contact), bool_or(can_view_vehicle_live)
  INTO _can_driver, _can_vehicle
  FROM public.client_portal_access
  WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true
    AND client_id = ANY(_client_ids);

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO _rows
  FROM (
    SELECT
      fd.id AS fiscal_document_id,
      fd.invoice_number,
      fd.recipient,
      fd.recipient_city,
      fd.recipient_state,
      ds.planned_arrival_at,
      CASE WHEN fd.status = 'delivered' THEN 'delivered'
           WHEN fd.status = 'in_transit' THEN 'in_transit'
           WHEN fd.status IN ('loading','loaded') THEN 'loaded'
           ELSE 'received' END AS public_status,
      EXISTS (SELECT 1 FROM public.operational_events oo
              WHERE oo.load_id = fd.load_id AND oo.visible_to_client = true
                AND oo.public_status = 'open') AS has_open_occurrence,
      EXISTS (SELECT 1 FROM public.proof_of_delivery p
              WHERE p.fiscal_document_id = fd.id
                AND p.status IN ('uploaded','validated')) AS has_pod,
      l.load_number,
      CASE WHEN _can_driver THEN drv.name END AS driver_name,
      CASE WHEN _can_vehicle THEN v.plate END AS vehicle_plate
    FROM public.fiscal_documents fd
    LEFT JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
    LEFT JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
    LEFT JOIN public.loads l ON l.id = fd.load_id
    LEFT JOIN public.dispatch_trips dt ON dt.id = ds.dispatch_trip_id
    LEFT JOIN public.drivers drv ON drv.id = dt.driver_id
    LEFT JOIN public.vehicles v ON v.id = dt.vehicle_id
    WHERE fd.tenant_id = _tenant_id
      AND fd.client_id = ANY(_client_ids)
      AND fd.status NOT IN ('delivered','cancelled')
      AND (ds.planned_arrival_at IS NULL OR ds.planned_arrival_at >= now() - interval '1 day')
    ORDER BY ds.planned_arrival_at NULLS LAST, fd.updated_at DESC
    LIMIT _limit
  ) t;

  RETURN _rows;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_client_portal_upcoming_deliveries(uuid, uuid, integer) TO authenticated;

-- 4) get_client_portal_alerts
CREATE OR REPLACE FUNCTION public.get_client_portal_alerts(
  _tenant_id uuid,
  _client_id uuid DEFAULT NULL,
  _limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  _client_ids uuid[];
  _rows jsonb;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT client_id), ARRAY[]::uuid[])
  INTO _client_ids
  FROM public.client_portal_access
  WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true
    AND (_client_id IS NULL OR client_id = _client_id);

  IF array_length(_client_ids, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH
    delays AS (
      SELECT
        fd.id AS related_id,
        'delay'::text AS type,
        'danger'::text AS severity,
        ('Entrega atrasada: NF ' || COALESCE(fd.invoice_number,'—')) AS title,
        ('Prevista para ' || to_char(ds.planned_arrival_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI')) AS description,
        'fiscal_document'::text AS related_type,
        fd.id::text AS fiscal_document,
        NULL::text AS pickup_order,
        NULL::text AS operational_event,
        NULL::text AS proof_of_delivery,
        ds.planned_arrival_at AS created_at,
        'Ver mercadoria'::text AS action_label,
        ('/portal/shipments/' || fd.id::text) AS action_url
      FROM public.fiscal_documents fd
      JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
      JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
      WHERE fd.tenant_id = _tenant_id
        AND fd.client_id = ANY(_client_ids)
        AND ds.status IN ('pending','arriving','in_progress')
        AND ds.planned_arrival_at < now()
    ),
    occs AS (
      SELECT
        oe.id AS related_id,
        CASE WHEN oe.client_action_required THEN 'client_action'::text ELSE 'occurrence'::text END AS type,
        CASE WHEN oe.severity IN ('critical','high') THEN 'danger'::text
             WHEN oe.severity = 'medium' THEN 'warning'::text
             ELSE 'info'::text END AS severity,
        ('Ocorrência: ' || COALESCE(oe.event_type,'—')) AS title,
        COALESCE(oe.description,'') AS description,
        'operational_event'::text AS related_type,
        NULL::text AS fiscal_document,
        NULL::text AS pickup_order,
        oe.id::text AS operational_event,
        NULL::text AS proof_of_delivery,
        oe.created_at,
        'Ver ocorrência'::text AS action_label,
        '/portal/occurrences'::text AS action_url
      FROM public.operational_events oe
      WHERE oe.tenant_id = _tenant_id
        AND oe.client_id = ANY(_client_ids)
        AND oe.visible_to_client = true
        AND oe.public_status IN ('open','in_analysis','client_action_required')
    ),
    pods AS (
      SELECT
        fd.id AS related_id,
        'pod_pending'::text AS type,
        'warning'::text AS severity,
        ('Canhoto pendente: NF ' || COALESCE(fd.invoice_number,'—')) AS title,
        'Entrega concluída, aguardando canhoto.'::text AS description,
        'fiscal_document'::text AS related_type,
        fd.id::text AS fiscal_document,
        NULL::text AS pickup_order,
        NULL::text AS operational_event,
        NULL::text AS proof_of_delivery,
        fd.updated_at AS created_at,
        'Ver mercadoria'::text AS action_label,
        ('/portal/shipments/' || fd.id::text) AS action_url
      FROM public.fiscal_documents fd
      WHERE fd.tenant_id = _tenant_id
        AND fd.client_id = ANY(_client_ids)
        AND fd.status = 'delivered'
        AND NOT EXISTS (SELECT 1 FROM public.proof_of_delivery p
                        WHERE p.fiscal_document_id = fd.id
                          AND p.status IN ('uploaded','validated'))
    ),
    pickups AS (
      SELECT
        po.id AS related_id,
        'pickup_pending'::text AS type,
        'info'::text AS severity,
        ('Coleta pendente: ' || COALESCE(po.pickup_number, po.id::text)) AS title,
        COALESCE(po.recipient_name, po.notes, '')::text AS description,
        'pickup_order'::text AS related_type,
        NULL::text AS fiscal_document,
        po.id::text AS pickup_order,
        NULL::text AS operational_event,
        NULL::text AS proof_of_delivery,
        po.created_at,
        'Ver coletas'::text AS action_label,
        '/portal/pickups'::text AS action_url
      FROM public.pickup_orders po
      WHERE po.tenant_id = _tenant_id
        AND po.remitter_client_id = ANY(_client_ids)
        AND po.status IN ('pendente','vinculada')
    ),
    unioned AS (
      SELECT * FROM delays
      UNION ALL SELECT * FROM occs
      UNION ALL SELECT * FROM pods
      UNION ALL SELECT * FROM pickups
    )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY
      CASE t.severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 WHEN 'info' THEN 2 ELSE 3 END,
      t.created_at DESC
    ), '[]'::jsonb) INTO _rows
  FROM (SELECT * FROM unioned LIMIT _limit) t;

  RETURN _rows;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_client_portal_alerts(uuid, uuid, integer) TO authenticated;
