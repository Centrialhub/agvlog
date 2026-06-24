
-- Storage receipts
DROP POLICY IF EXISTS "Authenticated users can upload receipts" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can view receipts" ON storage.objects;
DROP POLICY IF EXISTS "receipts_tenant_select" ON storage.objects;
DROP POLICY IF EXISTS "receipts_tenant_insert" ON storage.objects;
DROP POLICY IF EXISTS "receipts_tenant_update" ON storage.objects;
DROP POLICY IF EXISTS "receipts_tenant_delete" ON storage.objects;

CREATE POLICY "receipts_tenant_select" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'receipts'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND ((storage.foldername(name))[1])::uuid IN (SELECT public.get_user_tenant_ids())
);

CREATE POLICY "receipts_tenant_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'receipts'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND ((storage.foldername(name))[1])::uuid IN (SELECT public.get_user_tenant_ids())
);

CREATE POLICY "receipts_tenant_update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'receipts'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND ((storage.foldername(name))[1])::uuid IN (SELECT public.get_user_tenant_ids())
);

CREATE POLICY "receipts_tenant_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'receipts'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
  AND ((storage.foldername(name))[1])::uuid IN (SELECT public.get_user_tenant_ids())
);

-- search_client_portal_shipments
CREATE OR REPLACE FUNCTION public.search_client_portal_shipments(
  _tenant_id uuid, _search text DEFAULT NULL, _status text[] DEFAULT NULL,
  _start_date date DEFAULT NULL, _end_date date DEFAULT NULL,
  _city text DEFAULT NULL, _state text DEFAULT NULL,
  _has_pod boolean DEFAULT NULL, _has_occurrence boolean DEFAULT NULL,
  _limit integer DEFAULT 50, _offset integer DEFAULT 0
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE
  _client_ids uuid[]; _financial_client_ids uuid[];
  _tax_ids text[]; _financial_tax_ids text[];
  _access_types text[]; _rows jsonb; _total int; _search_norm text;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT cpa.client_id), ARRAY[]::uuid[]),
         COALESCE(array_agg(DISTINCT cpa.access_type), ARRAY[]::text[])
  INTO _client_ids, _access_types
  FROM public.client_portal_access cpa
  WHERE cpa.tenant_id = _tenant_id AND cpa.user_id = auth.uid() AND cpa.active = true;

  IF array_length(_client_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('rows','[]'::jsonb,'total',0);
  END IF;

  SELECT COALESCE(array_agg(DISTINCT cpa.client_id), ARRAY[]::uuid[])
  INTO _financial_client_ids
  FROM public.client_portal_access cpa
  WHERE cpa.tenant_id = _tenant_id AND cpa.user_id = auth.uid()
    AND cpa.active = true AND cpa.can_view_financial = true;

  SELECT COALESCE(array_agg(DISTINCT tax_id), ARRAY[]::text[]) INTO _tax_ids
  FROM public.clients WHERE id = ANY(_client_ids) AND tax_id IS NOT NULL;

  SELECT COALESCE(array_agg(DISTINCT tax_id), ARRAY[]::text[]) INTO _financial_tax_ids
  FROM public.clients WHERE id = ANY(_financial_client_ids) AND tax_id IS NOT NULL;

  _search_norm := NULLIF(trim(_search), '');

  WITH base AS (
    SELECT fd.id AS fiscal_document_id, fd.tenant_id, fd.client_id,
      fd.invoice_number, fd.access_key, fd.issue_date, fd.document_type,
      fd.status AS document_status, fd.client_load_number, fd.reference_number,
      fd.remitter, fd.remitter_cnpj, fd.recipient, fd.recipient_cnpj,
      fd.recipient_city, fd.recipient_state, fd.recipient_neighborhood,
      fd.product_summary, fd.pallet_count, fd.weight_kg,
      CASE WHEN fd.client_id = ANY(_financial_client_ids)
              OR fd.remitter_cnpj = ANY(_financial_tax_ids)
              OR fd.recipient_cnpj = ANY(_financial_tax_ids)
           THEN fd.value END AS value,
      CASE WHEN fd.client_id = ANY(_financial_client_ids)
              OR fd.remitter_cnpj = ANY(_financial_tax_ids)
              OR fd.recipient_cnpj = ANY(_financial_tax_ids)
           THEN fd.freight_value END AS freight_value,
      fd.load_id, fd.pickup_order_id, fd.updated_at,
      l.load_number, l.status AS load_status, l.trip_id,
      ds.id AS dispatch_stop_id, ds.status AS stop_status,
      ds.planned_arrival_at, ds.actual_arrival_at, ds.actual_departure_at,
      EXISTS (SELECT 1 FROM public.proof_of_delivery p
              WHERE p.fiscal_document_id = fd.id AND p.status IN ('uploaded','validated')) AS has_pod,
      EXISTS (SELECT 1 FROM public.operational_events oe
              WHERE oe.tenant_id = _tenant_id AND oe.load_id = fd.load_id
                AND oe.visible_to_client = true AND oe.public_status = 'open') AS has_open_occurrence
    FROM public.fiscal_documents fd
    LEFT JOIN public.loads l ON l.id = fd.load_id
    LEFT JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
    LEFT JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
    WHERE fd.tenant_id = _tenant_id
      AND ( fd.client_id = ANY(_client_ids)
            OR ('recipient' = ANY(_access_types) AND fd.recipient_cnpj = ANY(_tax_ids))
            OR ('remitter'  = ANY(_access_types) AND fd.remitter_cnpj  = ANY(_tax_ids)) )
      AND (_start_date IS NULL OR fd.issue_date >= _start_date)
      AND (_end_date   IS NULL OR fd.issue_date <= _end_date)
      AND (_city  IS NULL OR fd.recipient_city  ILIKE _city)
      AND (_state IS NULL OR fd.recipient_state ILIKE _state)
      AND (_status IS NULL OR fd.status = ANY(_status))
      AND ( _search_norm IS NULL
            OR fd.invoice_number      ILIKE '%' || _search_norm || '%'
            OR fd.access_key          ILIKE '%' || _search_norm || '%'
            OR fd.client_load_number  ILIKE '%' || _search_norm || '%'
            OR fd.reference_number    ILIKE '%' || _search_norm || '%'
            OR fd.recipient           ILIKE '%' || _search_norm || '%'
            OR fd.recipient_cnpj      ILIKE '%' || _search_norm || '%'
            OR fd.recipient_city      ILIKE '%' || _search_norm || '%'
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
END;
$function$;

-- get_client_portal_shipment_detail (DTOs explícitos)
CREATE OR REPLACE FUNCTION public.get_client_portal_shipment_detail(_fiscal_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE
  _fd public.fiscal_documents;
  _can_financial boolean := false;
  _result jsonb;
BEGIN
  SELECT * INTO _fd FROM public.fiscal_documents WHERE id = _fiscal_document_id;
  IF _fd.id IS NULL THEN
    RAISE EXCEPTION 'Documento não encontrado';
  END IF;

  IF NOT public.user_has_client_access(_fd.client_id) THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.client_portal_access cpa
      JOIN public.clients c ON c.id = cpa.client_id
      WHERE cpa.user_id = auth.uid() AND cpa.active = true
        AND cpa.tenant_id = _fd.tenant_id AND c.tax_id IS NOT NULL
        AND (c.tax_id = _fd.remitter_cnpj OR c.tax_id = _fd.recipient_cnpj)
    ) THEN
      RAISE EXCEPTION 'Acesso negado a este documento';
    END IF;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.client_portal_access cpa
    LEFT JOIN public.clients c ON c.id = cpa.client_id
    WHERE cpa.user_id = auth.uid() AND cpa.tenant_id = _fd.tenant_id
      AND cpa.active = true AND cpa.can_view_financial = true
      AND ( cpa.client_id = _fd.client_id
            OR (c.tax_id IS NOT NULL AND (c.tax_id = _fd.remitter_cnpj OR c.tax_id = _fd.recipient_cnpj)) )
  ) INTO _can_financial;

  SELECT jsonb_build_object(
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
    'load', (
      SELECT jsonb_build_object('id', l.id, 'load_number', l.load_number, 'status', l.status,
        'origin', l.origin, 'destination', l.destination,
        'total_pallet_count', l.total_pallet_count, 'total_weight_kg', l.total_weight_kg)
      FROM public.loads l WHERE l.id = _fd.load_id
    ),
    'trip', (
      SELECT jsonb_build_object('id', dt.id, 'status', dt.status,
        'started_at', dt.started_at, 'ended_at', dt.ended_at)
      FROM public.dispatch_trips dt
      WHERE dt.id = (SELECT trip_id FROM public.loads WHERE id = _fd.load_id)
    ),
    'stop', (
      SELECT jsonb_build_object('id', ds.id, 'stop_order', ds.stop_order,
        'destination', ds.destination, 'status', ds.status,
        'planned_arrival_at', ds.planned_arrival_at,
        'actual_arrival_at', ds.actual_arrival_at,
        'actual_departure_at', ds.actual_departure_at)
      FROM public.dispatch_stops ds
      JOIN public.dispatch_stop_documents dsd ON dsd.dispatch_stop_id = ds.id
      WHERE dsd.fiscal_document_id = _fd.id LIMIT 1
    ),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type,
        'notes', e.notes, 'created_at', e.created_at) ORDER BY e.created_at)
      FROM public.dispatch_events e
      WHERE e.dispatch_trip_id = (SELECT trip_id FROM public.loads WHERE id = _fd.load_id)
    ), '[]'::jsonb),
    'occurrences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', oe.id, 'event_type', oe.event_type,
        'severity', oe.severity, 'description', oe.description,
        'public_status', oe.public_status, 'resolved_at', oe.resolved_at,
        'created_at', oe.created_at) ORDER BY oe.created_at DESC)
      FROM public.operational_events oe
      WHERE oe.tenant_id = _fd.tenant_id AND oe.load_id = _fd.load_id
        AND oe.visible_to_client = true
    ), '[]'::jsonb),
    'proofs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'proof_type', p.proof_type,
        'status', p.status, 'receiver_name', p.receiver_name, 'receiver_role', p.receiver_role,
        'received_at', p.received_at, 'validated_at', p.validated_at,
        'has_file', (p.storage_path IS NOT NULL)) ORDER BY p.created_at DESC)
      FROM public.proof_of_delivery p
      WHERE p.fiscal_document_id = _fd.id
    ), '[]'::jsonb)
  ) INTO _result;
  RETURN _result;
END;
$function$;

-- list_client_documents — DROP + recreate (assinatura inalterada, mas garantindo)
-- (mantém mesma assinatura, apenas máscara value)
CREATE OR REPLACE FUNCTION public.list_client_documents(
  _tenant_id uuid, _document_type text DEFAULT NULL, _search text DEFAULT NULL,
  _start_date date DEFAULT NULL, _end_date date DEFAULT NULL,
  _limit integer DEFAULT 100, _offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, document_type text, invoice_number text, access_key text, issue_date date,
  remitter text, recipient text, recipient_city text, recipient_state text,
  value numeric, weight_kg numeric, status text, load_id uuid, client_id uuid, has_pod boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $function$
  WITH allowed AS (SELECT unnest(public._portal_user_client_ids(_tenant_id)) AS client_id),
  financial AS (
    SELECT cpa.client_id FROM public.client_portal_access cpa
    WHERE cpa.tenant_id = _tenant_id AND cpa.user_id = auth.uid()
      AND cpa.active = true AND cpa.can_view_financial = true
  )
  SELECT fd.id, fd.document_type, fd.invoice_number, fd.access_key, fd.issue_date,
    fd.remitter, fd.recipient, fd.recipient_city, fd.recipient_state,
    CASE WHEN fd.client_id IN (SELECT client_id FROM financial) THEN fd.value ELSE NULL END,
    fd.weight_kg, fd.status, fd.load_id, fd.client_id,
    EXISTS(SELECT 1 FROM public.proof_of_delivery pod WHERE pod.fiscal_document_id = fd.id)
  FROM public.fiscal_documents fd
  WHERE fd.tenant_id = _tenant_id
    AND fd.client_id IN (SELECT client_id FROM allowed)
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
$function$;

-- list_client_pods — DROP necessário (mudou tipos de retorno: storage_bucket/path -> has_file)
DROP FUNCTION IF EXISTS public.list_client_pods(uuid, text, timestamptz, timestamptz, integer, integer);
CREATE FUNCTION public.list_client_pods(
  _tenant_id uuid, _status text DEFAULT NULL,
  _start_date timestamptz DEFAULT NULL, _end_date timestamptz DEFAULT NULL,
  _limit integer DEFAULT 100, _offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, fiscal_document_id uuid, load_id uuid, invoice_number text,
  proof_type text, status text, has_file boolean,
  receiver_name text, receiver_document text, receiver_role text,
  received_at timestamptz, validated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public'
AS $function$
  WITH allowed AS (SELECT unnest(public._portal_user_client_ids(_tenant_id)) AS client_id)
  SELECT pod.id, pod.fiscal_document_id, pod.load_id, fd.invoice_number,
    pod.proof_type, pod.status, (pod.storage_path IS NOT NULL) AS has_file,
    pod.receiver_name, pod.receiver_document, pod.receiver_role,
    pod.received_at, pod.validated_at
  FROM public.proof_of_delivery pod
  JOIN public.fiscal_documents fd ON fd.id = pod.fiscal_document_id
  WHERE pod.tenant_id = _tenant_id
    AND fd.client_id IN (SELECT client_id FROM allowed)
    AND (_status IS NULL OR pod.status = _status)
    AND (_start_date IS NULL OR pod.received_at >= _start_date)
    AND (_end_date   IS NULL OR pod.received_at <= _end_date)
  ORDER BY pod.received_at DESC NULLS LAST, pod.created_at DESC
  LIMIT _limit OFFSET _offset;
$function$;

-- create_client_occurrence (validação tenant+client em load/order)
CREATE OR REPLACE FUNCTION public.create_client_occurrence(
  _tenant_id uuid, _client_id uuid, _event_type text, _description text,
  _severity text DEFAULT 'medium', _load_id uuid DEFAULT NULL, _order_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE v_id uuid; v_ok boolean;
BEGIN
  IF NOT public._portal_user_has_perm(_tenant_id, _client_id, 'can_open_occurrences') THEN
    RAISE EXCEPTION 'Permission denied: cannot open occurrences for this client';
  END IF;

  IF _load_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.loads l
      WHERE l.id = _load_id AND l.tenant_id = _tenant_id
        AND ( EXISTS(SELECT 1 FROM public.fiscal_documents fd WHERE fd.load_id = l.id AND fd.client_id = _client_id)
              OR EXISTS(SELECT 1 FROM public.load_items li WHERE li.load_id = l.id AND li.client_id = _client_id) )
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
  RETURN v_id;
END;
$function$;

-- get_client_portal_summary (status reais pickup)
CREATE OR REPLACE FUNCTION public.get_client_portal_summary(
  _tenant_id uuid, _start_date date DEFAULT NULL, _end_date date DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = 'public'
AS $function$
DECLARE _client_ids uuid[]; _result jsonb;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT client_id), ARRAY[]::uuid[])
  INTO _client_ids
  FROM public.client_portal_access
  WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true;

  IF array_length(_client_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('in_transit',0,'delivered',0,'delayed',0,'pending_pickup',0,
      'pending_pod',0,'open_occurrences',0,'deliveries_today',0,'deliveries_tomorrow',0);
  END IF;

  WITH fds AS (
    SELECT fd.* FROM public.fiscal_documents fd
    WHERE fd.tenant_id = _tenant_id AND fd.client_id = ANY(_client_ids)
      AND (_start_date IS NULL OR fd.issue_date >= _start_date)
      AND (_end_date   IS NULL OR fd.issue_date <= _end_date)
  )
  SELECT jsonb_build_object(
    'in_transit', (SELECT count(*) FROM fds WHERE status IN ('in_transit','loading','loaded')),
    'delivered', (SELECT count(*) FROM fds WHERE status = 'delivered'),
    'delayed', (SELECT count(*) FROM fds fd
                JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                WHERE ds.status IN ('pending','arriving','in_progress')
                  AND ds.planned_arrival_at < now()),
    'pending_pickup', (SELECT count(DISTINCT po.id) FROM public.pickup_orders po
                       WHERE po.tenant_id = _tenant_id
                         AND po.status IN ('pendente','vinculada')
                         AND po.remitter_client_id = ANY(_client_ids)),
    'pending_pod', (SELECT count(*) FROM fds fd
                    WHERE fd.status = 'delivered'
                      AND NOT EXISTS (SELECT 1 FROM public.proof_of_delivery p
                                      WHERE p.fiscal_document_id = fd.id AND p.status IN ('uploaded','validated'))),
    'open_occurrences', (SELECT count(*) FROM public.operational_events oe
                         WHERE oe.tenant_id = _tenant_id AND oe.visible_to_client = true
                           AND oe.public_status = 'open'
                           AND EXISTS (SELECT 1 FROM fds WHERE fds.load_id = oe.load_id)),
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
END;
$function$;
