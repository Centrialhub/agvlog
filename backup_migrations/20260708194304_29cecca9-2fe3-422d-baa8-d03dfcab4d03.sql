
-- =====================================================================
-- Helper: valida acesso do usuário a um client_id do portal
-- =====================================================================
CREATE OR REPLACE FUNCTION public._portal_assert_client_access(_tenant_id uuid, _client_id uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public'
AS $$
BEGIN
  IF _client_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.client_portal_access
    WHERE tenant_id=_tenant_id AND user_id=auth.uid() AND active=true AND client_id=_client_id
  ) THEN
    RAISE EXCEPTION 'not_authorized_for_client';
  END IF;
END; $$;

-- =====================================================================
-- Portal RPCs v2 (com _client_id opcional)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.list_client_documents_v2(
  _tenant_id uuid, _client_id uuid DEFAULT NULL,
  _document_type text DEFAULT NULL, _search text DEFAULT NULL,
  _start_date date DEFAULT NULL, _end_date date DEFAULT NULL,
  _limit integer DEFAULT 100, _offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, document_type text, invoice_number text, access_key text,
  issue_date date, remitter text, recipient text, recipient_city text, recipient_state text,
  value numeric, weight_kg numeric, status text, load_id uuid, client_id uuid, has_pod boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._portal_assert_client_access(_tenant_id, _client_id);
  RETURN QUERY
  SELECT fd.id, fd.document_type, fd.invoice_number, fd.access_key, fd.issue_date,
    fd.remitter, fd.recipient, fd.recipient_city, fd.recipient_state,
    CASE WHEN public.portal_user_can_view_financial(_tenant_id, fd.id) THEN fd.value END,
    fd.weight_kg, fd.status, fd.load_id, fd.client_id,
    EXISTS(SELECT 1 FROM public.proof_of_delivery pod WHERE pod.fiscal_document_id = fd.id)
  FROM public.fiscal_documents fd
  WHERE fd.tenant_id = _tenant_id
    AND public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
    AND (_client_id IS NULL OR fd.client_id = _client_id)
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
END; $$;

CREATE OR REPLACE FUNCTION public.list_client_pods_v2(
  _tenant_id uuid, _client_id uuid DEFAULT NULL,
  _status text DEFAULT NULL,
  _start_date timestamptz DEFAULT NULL, _end_date timestamptz DEFAULT NULL,
  _limit integer DEFAULT 100, _offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, fiscal_document_id uuid, load_id uuid, invoice_number text,
  proof_type text, status text, has_file boolean, receiver_name text,
  receiver_document text, receiver_role text, received_at timestamptz, validated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._portal_assert_client_access(_tenant_id, _client_id);
  RETURN QUERY
  SELECT pod.id, pod.fiscal_document_id, pod.load_id, fd.invoice_number,
    pod.proof_type, pod.status, (pod.storage_path IS NOT NULL),
    pod.receiver_name, pod.receiver_document, pod.receiver_role,
    pod.received_at, pod.validated_at
  FROM public.proof_of_delivery pod
  JOIN public.fiscal_documents fd ON fd.id = pod.fiscal_document_id
  WHERE pod.tenant_id = _tenant_id
    AND public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
    AND (_client_id IS NULL OR fd.client_id = _client_id)
    AND (_status IS NULL OR pod.status = _status)
    AND (_start_date IS NULL OR pod.received_at >= _start_date)
    AND (_end_date   IS NULL OR pod.received_at <= _end_date)
  ORDER BY pod.received_at DESC NULLS LAST, pod.created_at DESC
  LIMIT _limit OFFSET _offset;
END; $$;

CREATE OR REPLACE FUNCTION public.list_client_pickups_v2(
  _tenant_id uuid, _client_id uuid DEFAULT NULL,
  _status text DEFAULT NULL,
  _start_date timestamptz DEFAULT NULL, _end_date timestamptz DEFAULT NULL,
  _limit integer DEFAULT 100, _offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, pickup_number text, remitter_name text, remitter_cnpj text,
  recipient_name text, pickup_at timestamptz, status text, notes text, linked_docs_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._portal_assert_client_access(_tenant_id, _client_id);
  RETURN QUERY
  SELECT p.id, p.pickup_number, p.remitter_name, p.remitter_cnpj, p.recipient_name,
    p.pickup_at, p.status, p.notes,
    (SELECT COUNT(*) FROM public.fiscal_documents fd WHERE fd.pickup_order_id = p.id)
  FROM public.pickup_orders p
  WHERE p.tenant_id = _tenant_id
    AND public.portal_user_can_access_pickup_order(_tenant_id, p.id)
    AND (_client_id IS NULL OR p.remitter_client_id = _client_id)
    AND (_status IS NULL OR p.status = _status)
    AND (_start_date IS NULL OR p.pickup_at >= _start_date)
    AND (_end_date IS NULL OR p.pickup_at <= _end_date)
  ORDER BY p.pickup_at DESC NULLS LAST
  LIMIT _limit OFFSET _offset;
END; $$;

CREATE OR REPLACE FUNCTION public.list_client_occurrences_v2(
  _tenant_id uuid, _client_id uuid DEFAULT NULL,
  _severity text DEFAULT NULL, _resolved boolean DEFAULT NULL,
  _limit integer DEFAULT 100, _offset integer DEFAULT 0
)
RETURNS TABLE(id uuid, load_id uuid, order_id uuid, event_type text, severity text,
  description text, public_status text, client_action_required boolean, client_opened boolean,
  client_resolution_note text, resolution text, resolved_at timestamptz, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._portal_assert_client_access(_tenant_id, _client_id);
  RETURN QUERY
  WITH allowed AS (SELECT unnest(public._portal_user_client_ids(_tenant_id)) AS client_id)
  SELECT oe.id, oe.load_id, oe.order_id, oe.event_type, oe.severity, oe.description,
    oe.public_status, oe.client_action_required, oe.client_opened,
    oe.client_resolution_note, oe.resolution, oe.resolved_at, oe.created_at
  FROM public.operational_events oe
  WHERE oe.tenant_id = _tenant_id
    AND oe.client_id IN (SELECT client_id FROM allowed)
    AND (_client_id IS NULL OR oe.client_id = _client_id)
    AND (oe.visible_to_client = true OR oe.client_opened = true)
    AND (_severity IS NULL OR oe.severity = _severity)
    AND (_resolved IS NULL OR (_resolved AND oe.resolved_at IS NOT NULL) OR (NOT _resolved AND oe.resolved_at IS NULL))
  ORDER BY oe.created_at DESC
  LIMIT _limit OFFSET _offset;
END; $$;

CREATE OR REPLACE FUNCTION public.search_client_portal_shipments_v2(
  _tenant_id uuid, _client_id uuid DEFAULT NULL,
  _search text DEFAULT NULL, _status text[] DEFAULT NULL,
  _start_date date DEFAULT NULL, _end_date date DEFAULT NULL,
  _city text DEFAULT NULL, _state text DEFAULT NULL,
  _has_pod boolean DEFAULT NULL, _has_occurrence boolean DEFAULT NULL,
  _limit integer DEFAULT 50, _offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public'
AS $$
DECLARE _rows jsonb; _total int; _search_norm text;
BEGIN
  PERFORM public._portal_assert_client_access(_tenant_id, _client_id);
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
          AND (oe.fiscal_document_id = fd.id
            OR oe.dispatch_stop_id IN (SELECT dsd.dispatch_stop_id FROM public.dispatch_stop_documents dsd WHERE dsd.fiscal_document_id = fd.id)
            OR (oe.client_id IS NOT NULL AND oe.client_id = fd.client_id
                AND (oe.fiscal_document_id IS NULL OR oe.fiscal_document_id = fd.id)))
      ) AS has_open_occurrence,
      public.get_public_shipment_status(fd.id) AS public_status
    FROM public.fiscal_documents fd
    LEFT JOIN public.loads l ON l.id = fd.load_id
    LEFT JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
    LEFT JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
    WHERE fd.tenant_id = _tenant_id
      AND public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
      AND (_client_id IS NULL OR fd.client_id = _client_id)
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

CREATE OR REPLACE FUNCTION public.get_client_portal_reports_summary_v2(
  _tenant_id uuid, _client_id uuid DEFAULT NULL,
  _start_date date DEFAULT NULL, _end_date date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public'
AS $$
DECLARE v_result jsonb;
  v_start date := COALESCE(_start_date, (now() - interval '90 days')::date);
  v_end   date := COALESCE(_end_date, now()::date);
BEGIN
  PERFORM public._portal_assert_client_access(_tenant_id, _client_id);
  WITH allowed AS (SELECT unnest(public._portal_user_client_ids(_tenant_id)) AS client_id),
  fd AS (
    SELECT f.* FROM public.fiscal_documents f
    WHERE f.tenant_id = _tenant_id
      AND f.client_id IN (SELECT client_id FROM allowed)
      AND (_client_id IS NULL OR f.client_id = _client_id)
      AND COALESCE(f.issue_date, f.created_at::date) BETWEEN v_start AND v_end
  ),
  by_status AS (SELECT COALESCE(status,'sem_status') AS status, count(*)::int AS total FROM fd GROUP BY 1),
  delayed AS (
    SELECT count(*)::int AS total FROM fd f
    WHERE EXISTS (
      SELECT 1 FROM public.dispatch_stop_documents dsd
      JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
      WHERE dsd.fiscal_document_id = f.id AND ds.planned_arrival_at IS NOT NULL
        AND (ds.actual_arrival_at IS NULL AND ds.planned_arrival_at < now()
             OR ds.actual_arrival_at > ds.planned_arrival_at + interval '30 minutes')
    )
  ),
  pending_pods AS (
    SELECT count(*)::int AS total FROM fd f
    WHERE f.status IN ('delivered','completed')
      AND NOT EXISTS (SELECT 1 FROM public.proof_of_delivery pod WHERE pod.fiscal_document_id = f.id)
  ),
  occ_by_type AS (
    SELECT COALESCE(event_type,'outros') AS event_type, count(*)::int AS total
    FROM public.operational_events
    WHERE tenant_id = _tenant_id
      AND client_id IN (SELECT client_id FROM allowed)
      AND (_client_id IS NULL OR client_id = _client_id)
      AND (visible_to_client = true OR client_opened = true)
      AND created_at::date BETWEEN v_start AND v_end
    GROUP BY 1 ORDER BY total DESC LIMIT 20
  ),
  pickups_by AS (
    SELECT COALESCE(status,'sem_status') AS status, count(*)::int AS total
    FROM public.pickup_orders
    WHERE tenant_id = _tenant_id
      AND remitter_client_id IN (SELECT client_id FROM allowed)
      AND (_client_id IS NULL OR remitter_client_id = _client_id)
      AND created_at::date BETWEEN v_start AND v_end
    GROUP BY 1
  ),
  top_cities AS (
    SELECT COALESCE(recipient_city,'—') AS city, COALESCE(recipient_state,'') AS state,
      count(*)::int AS total FROM fd GROUP BY 1,2 ORDER BY total DESC LIMIT 15
  ),
  avg_time AS (
    SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (ds.actual_arrival_at - COALESCE(dt.actual_start_at, ds.planned_arrival_at))) / 86400.0)::numeric, 2), 0) AS avg_days
    FROM fd f
    JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = f.id
    JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
    LEFT JOIN public.dispatch_trips dt ON dt.id = ds.dispatch_trip_id
    WHERE ds.actual_arrival_at IS NOT NULL
  )
  SELECT jsonb_build_object(
    'period_start', v_start, 'period_end', v_end,
    'deliveries_total', (SELECT count(*)::int FROM fd),
    'deliveries_by_status', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'total', total)) FROM by_status), '[]'::jsonb),
    'deliveries_delayed', (SELECT total FROM delayed),
    'pending_pods', (SELECT total FROM pending_pods),
    'occurrences_by_type', COALESCE((SELECT jsonb_agg(jsonb_build_object('event_type', event_type, 'total', total)) FROM occ_by_type), '[]'::jsonb),
    'pickups_by_status', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'total', total)) FROM pickups_by), '[]'::jsonb),
    'top_cities', COALESCE((SELECT jsonb_agg(jsonb_build_object('city', city, 'state', state, 'total', total)) FROM top_cities), '[]'::jsonb),
    'avg_delivery_days', (SELECT avg_days FROM avg_time)
  ) INTO v_result;
  RETURN v_result;
END; $$;

-- =====================================================================
-- Portal tracking enriquecido com documentos
-- =====================================================================
CREATE OR REPLACE FUNCTION public.get_client_portal_tracking(
  _tenant_id uuid, _client_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path TO 'public'
AS $$
DECLARE v_result jsonb;
BEGIN
  PERFORM public._portal_assert_client_access(_tenant_id, _client_id);

  WITH allowed AS (
    SELECT client_id,
           bool_or(can_view_vehicle_live)   AS can_vehicle,
           bool_or(can_view_driver_contact) AS can_driver
    FROM public.client_portal_access
    WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true
      AND (_client_id IS NULL OR client_id = _client_id)
    GROUP BY client_id
  ),
  base AS (
    SELECT DISTINCT
      l.id AS load_id, l.load_number, l.status, l.updated_at,
      fd.client_id, a.can_vehicle, a.can_driver
    FROM public.fiscal_documents fd
    JOIN allowed a ON a.client_id = fd.client_id
    JOIN public.loads l ON l.id = fd.load_id
    WHERE fd.tenant_id = _tenant_id
      AND l.status IN ('planned','in_transit','arrived','loading','out_for_delivery')
  ),
  enriched AS (
    SELECT
      b.*,
      dt.id AS trip_id, dt.vehicle_id, dt.driver_id,
      dt.actual_start_at, dt.planned_end_at,
      v.plate, v.nickname AS vehicle_nickname,
      d.name AS driver_name, d.phone AS driver_phone,
      pl.lat, pl.lng, pl.speed, pl.captured_at,
      (SELECT jsonb_build_object(
          'id', ds.id, 'sequence', ds.stop_order,
          'destination', ds.destination,
          'city', NULL::text, 'state', NULL::text,
          'planned_arrival_at', ds.planned_arrival_at)
        FROM public.dispatch_stops ds
        WHERE ds.dispatch_trip_id = dt.id AND ds.actual_departure_at IS NULL
        ORDER BY ds.stop_order ASC LIMIT 1) AS next_stop,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'fiscal_document_id', fd2.id,
          'invoice_number', fd2.invoice_number,
          'recipient', fd2.recipient,
          'recipient_city', fd2.recipient_city,
          'recipient_state', fd2.recipient_state,
          'public_status', public.get_public_shipment_status(fd2.id),
          'planned_arrival_at', (
             SELECT ds3.planned_arrival_at FROM public.dispatch_stop_documents dsd3
             JOIN public.dispatch_stops ds3 ON ds3.id = dsd3.dispatch_stop_id
             WHERE dsd3.fiscal_document_id = fd2.id LIMIT 1),
          'has_pod', EXISTS(SELECT 1 FROM public.proof_of_delivery p WHERE p.fiscal_document_id=fd2.id AND p.status IN ('uploaded','validated')),
          'has_open_occurrence', EXISTS(SELECT 1 FROM public.operational_events oe
             WHERE oe.tenant_id=_tenant_id AND oe.visible_to_client=true
               AND oe.public_status='open' AND oe.fiscal_document_id=fd2.id)
        ) ORDER BY fd2.invoice_number), '[]'::jsonb)
       FROM public.fiscal_documents fd2
       WHERE fd2.tenant_id=_tenant_id AND fd2.load_id=b.load_id
         AND fd2.client_id=b.client_id) AS documents
    FROM base b
    LEFT JOIN public.dispatch_trip_loads dtl ON dtl.load_id = b.load_id
    LEFT JOIN public.dispatch_trips dt ON dt.id = dtl.dispatch_trip_id
    LEFT JOIN public.vehicles v ON v.id = dt.vehicle_id
    LEFT JOIN public.drivers d ON d.id = dt.driver_id
    LEFT JOIN public.positions_last pl ON pl.tenant_id = _tenant_id AND pl.vehicle_id = dt.vehicle_id
  )
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(
      jsonb_build_object(
        'load_id', load_id, 'load_number', load_number, 'status', status,
        'updated_at', updated_at, 'client_id', client_id, 'trip_id', trip_id,
        'plate', CASE WHEN can_vehicle THEN plate END,
        'vehicle_nickname', CASE WHEN can_vehicle THEN vehicle_nickname END,
        'lat', CASE WHEN can_vehicle THEN lat END,
        'lng', CASE WHEN can_vehicle THEN lng END,
        'speed', CASE WHEN can_vehicle THEN speed END,
        'captured_at', CASE WHEN can_vehicle THEN captured_at END,
        'driver_name',  CASE WHEN can_driver THEN driver_name END,
        'driver_phone', CASE WHEN can_driver THEN driver_phone END,
        'actual_start_at', actual_start_at, 'planned_end_at', planned_end_at,
        'next_stop', next_stop,
        'documents', documents,
        'can_view_vehicle_live', can_vehicle,
        'can_view_driver_contact', can_driver
      ) ORDER BY updated_at DESC
    ), '[]'::jsonb)
  ) INTO v_result FROM enriched;
  RETURN v_result;
END; $$;

-- =====================================================================
-- register_employee_advance com vínculo estrutural em payables
-- =====================================================================
CREATE OR REPLACE FUNCTION public.register_employee_advance(
  _tenant_id uuid, _employee_id uuid, _amount numeric,
  _advance_date date DEFAULT CURRENT_DATE, _reason text DEFAULT NULL,
  _payment_method text DEFAULT NULL, _payment_reference text DEFAULT NULL,
  _create_payable boolean DEFAULT false, _mark_paid boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path TO 'public'
AS $$
DECLARE
  _advance_id uuid; _driver uuid; _employee_name text;
  _payable_id uuid; _user uuid := auth.uid();
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'valor deve ser positivo'; END IF;

  SELECT driver_id, name INTO _driver, _employee_name
    FROM public.employees WHERE id = _employee_id AND tenant_id = _tenant_id;
  IF _employee_name IS NULL THEN RAISE EXCEPTION 'funcionário não encontrado'; END IF;

  INSERT INTO public.employee_advances(tenant_id, employee_id, driver_id, amount,
    advance_date, reason, payment_method, payment_reference,
    status, approved_by, approved_at, paid_by, paid_at, created_by)
  VALUES (_tenant_id, _employee_id, _driver, _amount,
    _advance_date, _reason, _payment_method, _payment_reference,
    CASE WHEN _mark_paid THEN 'paid' WHEN _create_payable THEN 'approved' ELSE 'pending' END,
    CASE WHEN _create_payable OR _mark_paid THEN _user END,
    CASE WHEN _create_payable OR _mark_paid THEN now() END,
    CASE WHEN _mark_paid THEN _user END,
    CASE WHEN _mark_paid THEN now() END,
    _user)
  RETURNING id INTO _advance_id;

  IF _create_payable THEN
    INSERT INTO public.payables(tenant_id, supplier_name, category, description, amount,
      competence_date, due_date, driver_id, status, created_by, notes,
      source_table, source_id, source_metadata)
    VALUES (_tenant_id, _employee_name,
      CASE WHEN _driver IS NOT NULL THEN 'driver_advance' ELSE 'payroll' END,
      'Adiantamento — ' || _employee_name || COALESCE(' — '||_reason,''),
      _amount, _advance_date, _advance_date, _driver,
      CASE WHEN _mark_paid THEN 'paid' ELSE 'pending' END,
      _user,
      'employee_advance_id=' || _advance_id::text,
      'employee_advances', _advance_id,
      jsonb_build_object('employee_id', _employee_id, 'driver_id', _driver, 'advance_date', _advance_date, 'reason', _reason))
    ON CONFLICT (tenant_id, source_table, source_id, category) DO NOTHING
    RETURNING id INTO _payable_id;

    IF _payable_id IS NULL THEN
      SELECT id INTO _payable_id FROM public.payables
      WHERE tenant_id=_tenant_id AND source_table='employee_advances' AND source_id=_advance_id
      LIMIT 1;
    END IF;
    UPDATE public.employee_advances SET payable_id = _payable_id WHERE id = _advance_id;
  END IF;

  RETURN _advance_id;
END; $$;

-- =====================================================================
-- Bloquear pagamento duplicado (settlement já em folha aprovada)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.register_driver_settlement_payment(
  _settlement_id uuid, _amount numeric,
  _payment_method text DEFAULT NULL, _payment_account text DEFAULT NULL,
  _payment_reference text DEFAULT NULL, _receipt_url text DEFAULT NULL,
  _notes text DEFAULT NULL, _allow_overpayment boolean DEFAULT false,
  _overpayment_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path TO 'public'
AS $$
DECLARE
  v_s public.driver_settlements; v_id uuid; v_total numeric;
  v_balance numeric; v_is_admin boolean; v_prev_status text; v_new_status text;
  v_account text; v_in_locked_payroll boolean;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF v_s.status NOT IN ('approved','paid') THEN RAISE EXCEPTION 'must_be_approved'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  IF _payment_account IS NULL OR length(trim(_payment_account)) = 0 THEN
    RAISE EXCEPTION 'payment_account_required';
  END IF;
  v_account := trim(_payment_account);
  IF lower(v_account) IN ('outro', 'other') THEN
    RAISE EXCEPTION 'payment_account_description_required';
  END IF;

  -- Bloquear se settlement já foi lançado como crédito em folha aprovada/fechada,
  -- e existir payable dessa folha (ou já pago). Item natural 'driver_settlement_payment' é reflexo do pagamento, ignorar.
  SELECT EXISTS (
    SELECT 1
    FROM public.payroll_entry_items pei
    JOIN public.payroll_entries pe ON pe.id = pei.payroll_entry_id
    JOIN public.payroll_periods pp ON pp.id = pe.payroll_period_id
    WHERE pei.source_table = 'driver_settlements'
      AND pei.source_id = _settlement_id
      AND pei.item_type <> 'driver_settlement_payment'
      AND pp.status IN ('approved','closed')
      AND EXISTS (
        SELECT 1 FROM public.payables pay
        WHERE pay.tenant_id=v_s.tenant_id
          AND pay.source_table='payroll_entries'
          AND pay.source_id=pe.id
          AND pay.status IN ('pending','paid','partial')
      )
  ) INTO v_in_locked_payroll;

  v_is_admin := EXISTS (
    SELECT 1 FROM public.tenant_memberships
     WHERE tenant_id = v_s.tenant_id AND user_id = auth.uid()
       AND active = true AND role IN ('owner','admin'));

  IF v_in_locked_payroll THEN
    IF NOT (v_is_admin AND length(trim(COALESCE(_overpayment_reason,''))) > 0) THEN
      RAISE EXCEPTION 'settlement_locked_in_payroll';
    END IF;
    INSERT INTO public.payroll_generation_issues(tenant_id, payroll_period_id, driver_id, employee_id,
      issue_type, issue_description, severity, source_metadata)
    SELECT v_s.tenant_id, pp.id, v_s.driver_id, pe.employee_id,
      'duplicate_payment_override',
      'Pagamento direto do acerto autorizado por admin apesar do vínculo em folha',
      'warning',
      jsonb_build_object('settlement_id', _settlement_id, 'amount', _amount, 'reason', _overpayment_reason, 'by', auth.uid())
    FROM public.payroll_entry_items pei
    JOIN public.payroll_entries pe ON pe.id = pei.payroll_entry_id
    JOIN public.payroll_periods pp ON pp.id = pe.payroll_period_id
    WHERE pei.source_table='driver_settlements' AND pei.source_id=_settlement_id
    LIMIT 1;
  END IF;

  v_prev_status := v_s.status;
  v_balance := COALESCE(v_s.driver_payable_amount,0) - COALESCE(v_s.total_paid_amount,0);
  IF _amount > v_balance THEN
    IF NOT (_allow_overpayment AND v_is_admin AND length(trim(COALESCE(_overpayment_reason,''))) > 0) THEN
      RAISE EXCEPTION 'overpayment_blocked';
    END IF;
  END IF;

  INSERT INTO public.driver_settlement_payments(tenant_id, settlement_id, amount, payment_method, payment_account, payment_reference, receipt_url, notes, paid_by)
  VALUES (v_s.tenant_id, _settlement_id, _amount, _payment_method, v_account, _payment_reference, _receipt_url, _notes, auth.uid())
  RETURNING id INTO v_id;

  SELECT COALESCE(sum(amount),0) INTO v_total FROM public.driver_settlement_payments WHERE settlement_id = _settlement_id;

  UPDATE public.driver_settlements SET
    total_paid_amount = v_total,
    payment_balance = COALESCE(driver_payable_amount,0) - v_total,
    status = CASE WHEN v_total >= COALESCE(driver_payable_amount,0) THEN 'paid' ELSE status END,
    paid_by = CASE WHEN v_total >= COALESCE(driver_payable_amount,0) THEN auth.uid() ELSE paid_by END,
    paid_at = CASE WHEN v_total >= COALESCE(driver_payable_amount,0) THEN now() ELSE paid_at END
  WHERE id = _settlement_id;

  SELECT status INTO v_new_status FROM public.driver_settlements WHERE id = _settlement_id;

  PERFORM public._log_settlement_event(_settlement_id, 'payment_registered', v_prev_status, v_new_status, _notes,
    jsonb_build_object(
      'payment_id', v_id, 'amount', _amount, 'payment_method', _payment_method,
      'payment_account', v_account, 'payment_reference', _payment_reference,
      'receipt_url', _receipt_url, 'notes', _notes,
      'total_paid_amount', v_total,
      'payment_balance', COALESCE(v_s.driver_payable_amount,0) - v_total,
      'overpayment', _amount > v_balance,
      'overpayment_reason', CASE WHEN _amount > v_balance OR v_in_locked_payroll THEN _overpayment_reason END,
      'in_locked_payroll', v_in_locked_payroll
    ));
  RETURN v_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.list_client_documents_v2(uuid, uuid, text, text, date, date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_client_pods_v2(uuid, uuid, text, timestamptz, timestamptz, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_client_pickups_v2(uuid, uuid, text, timestamptz, timestamptz, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_client_occurrences_v2(uuid, uuid, text, boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_client_portal_shipments_v2(uuid, uuid, text, text[], date, date, text, text, boolean, boolean, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_portal_reports_summary_v2(uuid, uuid, date, date) TO authenticated;
