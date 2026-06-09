-- Hardening: dispatch_planned_route now validates strictly load_ids, tenant ownership, trip_id null, no duplicates, FDs exist, stops complete

CREATE OR REPLACE FUNCTION public.dispatch_planned_route(_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tenant_id uuid := (_payload->>'tenant_id')::uuid;
  _vehicle_id uuid := NULLIF(_payload->>'vehicle_id','')::uuid;
  _driver_id uuid := NULLIF(_payload->>'driver_id','')::uuid;
  _planned_start_at timestamptz := NULLIF(_payload->>'planned_start_at','')::timestamptz;
  _route_name text := _payload->>'route_name';
  _planning_draft_id uuid := NULLIF(_payload->>'planning_draft_id','')::uuid;
  _load_ids uuid[];
  _distinct_load_ids uuid[];
  _stops jsonb := COALESCE(_payload->'stops','[]'::jsonb);
  _trip_id uuid;
  _primary_load uuid;
  _stop jsonb;
  _stop_id uuid;
  _stop_order int;
  _valid_count int;
  _fd_id uuid;
  _fd_ids uuid[] := ARRAY[]::uuid[];
  _missing_fd_count int;
BEGIN
  IF _tenant_id IS NULL OR NOT public.is_tenant_member(_tenant_id) THEN
    RAISE EXCEPTION 'Não autorizado';
  END IF;
  IF _vehicle_id IS NULL THEN RAISE EXCEPTION 'Veículo obrigatório'; END IF;
  IF _driver_id IS NULL THEN RAISE EXCEPTION 'Motorista obrigatório'; END IF;
  IF _planned_start_at IS NULL THEN RAISE EXCEPTION 'Horário previsto de saída obrigatório'; END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(_payload->'load_ids'))::uuid[] INTO _load_ids;
  IF _load_ids IS NULL OR array_length(_load_ids,1) IS NULL THEN
    RAISE EXCEPTION 'Lista de cargas vazia';
  END IF;

  -- Reject duplicates
  SELECT ARRAY(SELECT DISTINCT unnest(_load_ids)) INTO _distinct_load_ids;
  IF array_length(_distinct_load_ids,1) <> array_length(_load_ids,1) THEN
    RAISE EXCEPTION 'Cargas duplicadas na lista';
  END IF;

  IF jsonb_array_length(_stops) = 0 THEN
    RAISE EXCEPTION 'Rota sem paradas';
  END IF;

  -- All loads must exist, belong to tenant, and have NO trip yet
  SELECT count(*) INTO _valid_count
  FROM public.loads
  WHERE id = ANY(_load_ids)
    AND tenant_id = _tenant_id
    AND trip_id IS NULL;
  IF _valid_count <> array_length(_load_ids,1) THEN
    RAISE EXCEPTION 'Uma ou mais cargas são inválidas, inexistentes ou já despachadas';
  END IF;

  -- Validate each stop and collect FD ids
  _stop_order := 0;
  FOR _stop IN SELECT * FROM jsonb_array_elements(_stops)
  LOOP
    _stop_order := _stop_order + 1;
    IF COALESCE(trim(_stop->>'destination'),'') = '' THEN
      RAISE EXCEPTION 'Parada %: destino obrigatório', _stop_order;
    END IF;
    IF jsonb_typeof(_stop->'fiscal_document_ids') = 'array' THEN
      FOR _fd_id IN SELECT (jsonb_array_elements_text(_stop->'fiscal_document_ids'))::uuid
      LOOP
        _fd_ids := _fd_ids || _fd_id;
      END LOOP;
    END IF;
  END LOOP;

  -- Validate FDs exist and belong to tenant (if any referenced)
  IF array_length(_fd_ids,1) IS NOT NULL THEN
    SELECT count(*) INTO _missing_fd_count
    FROM unnest(_fd_ids) AS x(id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.fiscal_documents fd
      WHERE fd.id = x.id AND fd.tenant_id = _tenant_id
    );
    IF _missing_fd_count > 0 THEN
      RAISE EXCEPTION 'Documentos fiscais inexistentes ou de outro tenant: %', _missing_fd_count;
    END IF;
  END IF;

  _primary_load := _load_ids[1];

  INSERT INTO public.dispatch_trips(
    tenant_id, vehicle_id, driver_id, load_id, status,
    planned_start_at, notes, created_by
  ) VALUES (
    _tenant_id, _vehicle_id, _driver_id, _primary_load, 'planned',
    _planned_start_at, COALESCE(_route_name,'Rota planejada'), auth.uid()
  )
  RETURNING id INTO _trip_id;

  INSERT INTO public.dispatch_trip_loads(tenant_id, dispatch_trip_id, load_id)
  SELECT _tenant_id, _trip_id, unnest(_load_ids);

  UPDATE public.loads
    SET trip_id = _trip_id,
        vehicle_id = _vehicle_id,
        driver_id = _driver_id,
        status = 'loading',
        updated_at = now()
    WHERE id = ANY(_load_ids);

  _stop_order := 0;
  FOR _stop IN SELECT * FROM jsonb_array_elements(_stops)
  LOOP
    _stop_order := _stop_order + 1;

    INSERT INTO public.dispatch_stops(
      tenant_id, dispatch_trip_id, stop_order, destination, client_id,
      planned_arrival_at, estimated_departure_at, service_time_minutes,
      delivery_window_start, delivery_window_end,
      risk_level, risk_reason, notes, status
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
      'pending'
    )
    RETURNING id INTO _stop_id;

    IF jsonb_typeof(_stop->'fiscal_document_ids') = 'array' THEN
      FOR _fd_id IN SELECT (jsonb_array_elements_text(_stop->'fiscal_document_ids'))::uuid
      LOOP
        INSERT INTO public.dispatch_stop_documents(
          tenant_id, dispatch_stop_id, fiscal_document_id, load_id
        )
        SELECT _tenant_id, _stop_id, _fd_id,
               (SELECT load_id FROM public.load_items WHERE fiscal_document_id = _fd_id AND load_id = ANY(_load_ids) LIMIT 1)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;
  END LOOP;

  IF _planning_draft_id IS NOT NULL THEN
    UPDATE public.route_planning_drafts
      SET status = 'dispatched',
          converted_load_id = _primary_load,
          updated_at = now()
      WHERE id = _planning_draft_id AND tenant_id = _tenant_id;
  END IF;

  RETURN _trip_id;
END;
$function$;