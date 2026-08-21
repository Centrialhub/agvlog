
-- ============================================================
-- Migration 2: Portal + Control Tower + Roteirização
-- ============================================================

-- ---------- Portal: shipment detail uses trip fields that actually exist ----------
DO $do$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE proname='get_client_portal_shipment_detail';
  IF v_src LIKE '%dt.started_at%' THEN
    v_src := replace(v_src,
      $a$jsonb_build_object('id', dt.id, 'status', dt.status,
        'started_at', dt.started_at, 'ended_at', dt.ended_at)$a$,
      $b$jsonb_build_object('id', dt.id, 'status', dt.status,
        'planned_start_at', dt.planned_start_at, 'actual_start_at', dt.actual_start_at,
        'planned_end_at', dt.planned_end_at, 'actual_end_at', dt.actual_end_at)$b$
    );
    EXECUTE v_src;
  END IF;
END $do$;

-- ---------- get_user_portal_tenants ----------
CREATE OR REPLACE FUNCTION public.get_user_portal_tenants()
RETURNS TABLE (id uuid, name text, plan_key text, timezone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT DISTINCT t.id, t.name, t.plan_key, t.timezone
  FROM public.tenants t
  WHERE t.id IN (
      SELECT tenant_id FROM public.tenant_memberships
      WHERE user_id = auth.uid() AND active = true
      UNION
      SELECT tenant_id FROM public.client_portal_access
      WHERE user_id = auth.uid() AND active = true
  );
$$;
GRANT EXECUTE ON FUNCTION public.get_user_portal_tenants() TO authenticated;

-- ---------- Portal summary: include 'arrived' as in-transit signal ----------
DO $do$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE proname='get_client_portal_summary';
  IF v_src LIKE $$%('pending','arriving','in_progress')%$$ THEN
    v_src := replace(v_src, $a$('pending','arriving','in_progress')$a$,
                            $b$('pending','arriving','arrived','in_progress')$b$);
    EXECUTE v_src;
  END IF;
END $do$;

-- ---------- Control Tower: fix ORDER BY + include 'arrived' ----------
DO $do$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src
  FROM pg_proc WHERE proname='get_active_trips_live';
  -- Fix ORDER BY on jsonb subqueries (ps/pe are row aliases with a 'sequence' column)
  v_src := replace(v_src, $a$ORDER BY (ps->>'sequence')::int$a$, $b$ORDER BY ps.sequence$b$);
  v_src := replace(v_src, $a$ORDER BY (pe->>'sequence')::int$a$, $b$ORDER BY pe.sequence$b$);
  -- Include 'arrived' in next-stop and pending-stop scans
  v_src := replace(v_src,
    $a$AND s.status IN ('pending','arriving','in_progress')$a$,
    $b$AND s.status IN ('pending','arriving','arrived','in_progress')$b$);
  EXECUTE v_src;
END $do$;

-- ============================================================
-- dispatch_planned_route: harden FD ownership + persist lat/lng
-- ============================================================
CREATE OR REPLACE FUNCTION public.dispatch_planned_route(_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _tenant_id uuid := (_payload->>'tenant_id')::uuid;
  _vehicle_id uuid := NULLIF(_payload->>'vehicle_id','')::uuid;
  _driver_id uuid := NULLIF(_payload->>'driver_id','')::uuid;
  _planned_start_at timestamptz := NULLIF(_payload->>'planned_start_at','')::timestamptz;
  _route_name text := _payload->>'route_name';
  _planning_draft_id uuid := NULLIF(_payload->>'planning_draft_id','')::uuid;
  _load_ids uuid[]; _distinct_load_ids uuid[];
  _stops jsonb := COALESCE(_payload->'stops','[]'::jsonb);
  _trip_id uuid; _primary_load uuid;
  _stop jsonb; _stop_id uuid; _stop_order int;
  _valid_count int; _fd_id uuid; _fd_ids uuid[] := ARRAY[]::uuid[];
  _orphan_count int; _fd_load uuid;
  _lat numeric; _lng numeric;
BEGIN
  IF _tenant_id IS NULL
     OR (NOT public.is_tenant_admin(_tenant_id)
         AND NOT public.has_tenant_role(_tenant_id, 'operator'::app_role)) THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;
  IF _vehicle_id IS NULL THEN RAISE EXCEPTION 'Veículo obrigatório'; END IF;
  IF _driver_id IS NULL THEN RAISE EXCEPTION 'Motorista obrigatório'; END IF;
  IF _planned_start_at IS NULL THEN RAISE EXCEPTION 'Horário previsto de saída obrigatório'; END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(_payload->'load_ids'))::uuid[] INTO _load_ids;
  IF _load_ids IS NULL OR array_length(_load_ids,1) IS NULL THEN
    RAISE EXCEPTION 'Lista de cargas vazia';
  END IF;
  SELECT ARRAY(SELECT DISTINCT unnest(_load_ids)) INTO _distinct_load_ids;
  IF array_length(_distinct_load_ids,1) <> array_length(_load_ids,1) THEN
    RAISE EXCEPTION 'Cargas duplicadas na lista';
  END IF;
  IF jsonb_array_length(_stops) = 0 THEN RAISE EXCEPTION 'Rota sem paradas'; END IF;

  SELECT count(*) INTO _valid_count
  FROM public.loads
  WHERE id = ANY(_load_ids) AND tenant_id = _tenant_id AND trip_id IS NULL;
  IF _valid_count <> array_length(_load_ids,1) THEN
    RAISE EXCEPTION 'Uma ou mais cargas são inválidas, inexistentes ou já despachadas';
  END IF;

  -- Collect FD ids referenced by stops
  _stop_order := 0;
  FOR _stop IN SELECT * FROM jsonb_array_elements(_stops) LOOP
    _stop_order := _stop_order + 1;
    IF COALESCE(trim(_stop->>'destination'),'') = '' THEN
      RAISE EXCEPTION 'Parada %: destino obrigatório', _stop_order;
    END IF;
    IF jsonb_typeof(_stop->'fiscal_document_ids') = 'array' THEN
      FOR _fd_id IN SELECT (jsonb_array_elements_text(_stop->'fiscal_document_ids'))::uuid LOOP
        _fd_ids := _fd_ids || _fd_id;
      END LOOP;
    END IF;
  END LOOP;

  -- 1) FDs must exist + belong to tenant
  IF array_length(_fd_ids,1) IS NOT NULL THEN
    SELECT count(*) INTO _orphan_count
    FROM unnest(_fd_ids) AS x(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.fiscal_documents fd
      WHERE fd.id = x.id AND fd.tenant_id = _tenant_id
    );
    IF _orphan_count > 0 THEN
      RAISE EXCEPTION 'Documentos fiscais inexistentes ou de outro tenant: %', _orphan_count;
    END IF;

    -- 2) Every FD MUST belong to one of the dispatched loads via load_items
    SELECT count(*) INTO _orphan_count
    FROM unnest(_fd_ids) AS x(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.load_items li
      WHERE li.fiscal_document_id = x.id
        AND li.load_id = ANY(_load_ids)
    );
    IF _orphan_count > 0 THEN
      RAISE EXCEPTION 'Documento fiscal não pertence às cargas despachadas: % doc(s)', _orphan_count;
    END IF;
  END IF;

  _primary_load := _load_ids[1];

  INSERT INTO public.dispatch_trips(
    tenant_id, vehicle_id, driver_id, load_id, status,
    planned_start_at, notes, created_by
  ) VALUES (
    _tenant_id, _vehicle_id, _driver_id, _primary_load, 'planned',
    _planned_start_at, COALESCE(_route_name,'Rota planejada'), auth.uid()
  ) RETURNING id INTO _trip_id;

  INSERT INTO public.dispatch_trip_loads(tenant_id, dispatch_trip_id, load_id)
  SELECT _tenant_id, _trip_id, unnest(_load_ids);

  UPDATE public.loads
    SET trip_id = _trip_id, vehicle_id = _vehicle_id, driver_id = _driver_id,
        status = 'loading', updated_at = now()
    WHERE id = ANY(_load_ids);

  _stop_order := 0;
  FOR _stop IN SELECT * FROM jsonb_array_elements(_stops) LOOP
    _stop_order := _stop_order + 1;
    _lat := NULLIF(_stop->>'latitude','')::numeric;
    _lng := NULLIF(_stop->>'longitude','')::numeric;

    INSERT INTO public.dispatch_stops(
      tenant_id, dispatch_trip_id, stop_order, destination, client_id,
      planned_arrival_at, estimated_departure_at, service_time_minutes,
      delivery_window_start, delivery_window_end,
      risk_level, risk_reason, notes, status,
      latitude, longitude
    ) VALUES (
      _tenant_id, _trip_id, _stop_order,
      _stop->>'destination',
      NULLIF(_stop->>'client_id','')::uuid,
      NULLIF(_stop->>'planned_arrival_at','')::timestamptz,
      NULLIF(_stop->>'estimated_departure_at','')::timestamptz,
      COALESCE((_stop->>'service_time_minutes')::int, 20),
      NULLIF(_stop->>'delivery_window_start','')::time,
      NULLIF(_stop->>'delivery_window_end','')::time,
      COALESCE(_stop->>'risk_level','normal'),
      _stop->>'risk_reason',
      _stop->>'notes',
      'pending',
      _lat, _lng
    ) RETURNING id INTO _stop_id;

    IF jsonb_typeof(_stop->'fiscal_document_ids') = 'array' THEN
      FOR _fd_id IN SELECT (jsonb_array_elements_text(_stop->'fiscal_document_ids'))::uuid LOOP
        SELECT load_id INTO _fd_load
        FROM public.load_items
        WHERE fiscal_document_id = _fd_id AND load_id = ANY(_load_ids)
        LIMIT 1;
        INSERT INTO public.dispatch_stop_documents(
          tenant_id, dispatch_stop_id, fiscal_document_id, load_id
        ) VALUES (_tenant_id, _stop_id, _fd_id, _fd_load)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;
  END LOOP;

  IF _planning_draft_id IS NOT NULL THEN
    UPDATE public.route_planning_drafts
      SET status='dispatched', converted_load_id=_primary_load, updated_at=now()
      WHERE id=_planning_draft_id AND tenant_id=_tenant_id;
  END IF;

  RETURN _trip_id;
END;
$$;
