CREATE OR REPLACE FUNCTION public.revert_xml_loads_to_available(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  _load_ids uuid[] := ARRAY[]::uuid[];
  _trip_ids uuid[] := ARRAY[]::uuid[];
  _dispatch_events_count integer := 0;
  _dispatch_stops_count integer := 0;
  _dispatch_stop_docs_count integer := 0;
  _dispatch_trip_loads_count integer := 0;
  _dispatch_trips_count integer := 0;
  _loads_updated_count integer := 0;
  _drafts_updated_count integer := 0;
BEGIN
  IF NOT public.is_tenant_member(_tenant_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- 1. Identificar loads com items de fiscal_documents (XML)
  SELECT COALESCE(array_agg(DISTINCT li.load_id), ARRAY[]::uuid[])
  INTO _load_ids
  FROM public.load_items li
  WHERE li.tenant_id = _tenant_id
    AND li.load_id IS NOT NULL
    AND li.fiscal_document_id IS NOT NULL;

  IF array_length(_load_ids, 1) IS NULL OR array_length(_load_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'message', 'Nenhum load de XML encontrado para reverter',
      'loads_updated', 0,
      'trips_removed', 0,
      'stops_removed', 0,
      'events_removed', 0,
      'trip_loads_removed', 0,
      'stop_docs_removed', 0,
      'drafts_reset', 0
    );
  END IF;

  -- 2. Identificar trips associadas a esses loads
  SELECT COALESCE(array_agg(DISTINCT dt.id), ARRAY[]::uuid[])
  INTO _trip_ids
  FROM public.dispatch_trips dt
  WHERE dt.tenant_id = _tenant_id
    AND dt.load_id = ANY(_load_ids);

  -- 3. Remover dispatch_events das trips
  IF array_length(_trip_ids, 1) > 0 THEN
    DELETE FROM public.dispatch_events
    WHERE tenant_id = _tenant_id
      AND dispatch_trip_id = ANY(_trip_ids);
    GET DIAGNOSTICS _dispatch_events_count = ROW_COUNT;
  END IF;

  -- 4. Remover dispatch_stop_documents das stops das trips
  IF array_length(_trip_ids, 1) > 0 THEN
    DELETE FROM public.dispatch_stop_documents
    WHERE tenant_id = _tenant_id
      AND dispatch_stop_id IN (
        SELECT id FROM public.dispatch_stops
        WHERE tenant_id = _tenant_id AND dispatch_trip_id = ANY(_trip_ids)
      );
    GET DIAGNOSTICS _dispatch_stop_docs_count = ROW_COUNT;
  END IF;

  -- 5. Remover dispatch_stops das trips
  IF array_length(_trip_ids, 1) > 0 THEN
    DELETE FROM public.dispatch_stops
    WHERE tenant_id = _tenant_id
      AND dispatch_trip_id = ANY(_trip_ids);
    GET DIAGNOSTICS _dispatch_stops_count = ROW_COUNT;
  END IF;

  -- 6. Remover dispatch_trip_loads das trips
  IF array_length(_trip_ids, 1) > 0 THEN
    DELETE FROM public.dispatch_trip_loads
    WHERE tenant_id = _tenant_id
      AND dispatch_trip_id = ANY(_trip_ids);
    GET DIAGNOSTICS _dispatch_trip_loads_count = ROW_COUNT;
  END IF;

  -- 7. Remover dispatch_trips
  IF array_length(_trip_ids, 1) > 0 THEN
    DELETE FROM public.dispatch_trips
    WHERE tenant_id = _tenant_id
      AND id = ANY(_trip_ids);
    GET DIAGNOSTICS _dispatch_trips_count = ROW_COUNT;
  END IF;

  -- 8. Resetar loads: status='planned', limpar trip_id, vehicle_id, driver_id
  UPDATE public.loads
  SET status = 'planned',
      trip_id = null,
      vehicle_id = null,
      driver_id = null,
      updated_at = now()
  WHERE tenant_id = _tenant_id
    AND id = ANY(_load_ids)
    AND (status <> 'planned' OR trip_id IS NOT NULL OR vehicle_id IS NOT NULL OR driver_id IS NOT NULL);
  GET DIAGNOSTICS _loads_updated_count = ROW_COUNT;

  -- 9. Resetar route_planning_drafts convertidos de 'dispatched' para 'draft'
  UPDATE public.route_planning_drafts
  SET status = 'draft',
      converted_load_id = null,
      updated_at = now()
  WHERE tenant_id = _tenant_id
    AND status = 'dispatched'
    AND converted_load_id = ANY(_load_ids);
  GET DIAGNOSTICS _drafts_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'message', 'XMLs revertidos para carga disponível com sucesso',
    'loads_updated', _loads_updated_count,
    'trips_removed', _dispatch_trips_count,
    'stops_removed', _dispatch_stops_count,
    'events_removed', _dispatch_events_count,
    'trip_loads_removed', _dispatch_trip_loads_count,
    'stop_docs_removed', _dispatch_stop_docs_count,
    'drafts_reset', _drafts_updated_count,
    'affected_load_ids', _load_ids,
    'removed_trip_ids', _trip_ids
  );
END;
$function$;