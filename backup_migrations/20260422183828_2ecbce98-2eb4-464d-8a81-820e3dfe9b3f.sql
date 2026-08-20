CREATE OR REPLACE FUNCTION public.preview_reimport_cleanup_counts(_tenant_id uuid, _start_date date DEFAULT NULL, _end_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path TO 'public'
AS $$
DECLARE
  _doc_ids uuid[] := ARRAY[]::uuid[];
  _empty_load_ids uuid[] := ARRAY[]::uuid[];
  _dispatch_events integer := 0;
  _dispatch_stops integer := 0;
  _dispatch_trips integer := 0;
  _load_items integer := 0;
  _fiscal_documents integer := 0;
  _loads integer := 0;
  _freight_logs integer := 0;
  _drafts integer := 0;
BEGIN
  IF NOT public.is_tenant_admin(_tenant_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO _doc_ids
  FROM public.fiscal_documents
  WHERE tenant_id = _tenant_id
    AND (_start_date IS NULL OR issue_date >= _start_date)
    AND (_end_date IS NULL OR issue_date <= _end_date);

  SELECT COALESCE(array_agg(DISTINCT li.load_id), ARRAY[]::uuid[])
  INTO _empty_load_ids
  FROM public.load_items li
  WHERE li.tenant_id = _tenant_id
    AND li.load_id IS NOT NULL
    AND li.fiscal_document_id = ANY(_doc_ids)
    AND NOT EXISTS (
      SELECT 1
      FROM public.load_items remaining
      WHERE remaining.load_id = li.load_id
        AND (remaining.fiscal_document_id IS NULL OR remaining.fiscal_document_id <> ALL(_doc_ids))
    );

  SELECT count(*)::integer INTO _fiscal_documents FROM public.fiscal_documents WHERE id = ANY(_doc_ids);
  SELECT count(*)::integer INTO _load_items FROM public.load_items WHERE tenant_id = _tenant_id AND fiscal_document_id = ANY(_doc_ids);
  SELECT count(*)::integer INTO _loads FROM public.loads WHERE tenant_id = _tenant_id AND id = ANY(_empty_load_ids);
  SELECT count(*)::integer INTO _dispatch_trips FROM public.dispatch_trips WHERE tenant_id = _tenant_id AND load_id = ANY(_empty_load_ids);
  SELECT count(*)::integer INTO _dispatch_stops FROM public.dispatch_stops WHERE tenant_id = _tenant_id AND dispatch_trip_id IN (SELECT id FROM public.dispatch_trips WHERE tenant_id = _tenant_id AND load_id = ANY(_empty_load_ids));
  SELECT count(*)::integer INTO _dispatch_events FROM public.dispatch_events WHERE tenant_id = _tenant_id AND dispatch_trip_id IN (SELECT id FROM public.dispatch_trips WHERE tenant_id = _tenant_id AND load_id = ANY(_empty_load_ids));
  SELECT count(*)::integer INTO _freight_logs FROM public.freight_calculation_log WHERE tenant_id = _tenant_id AND entity_id = ANY(_doc_ids);
  SELECT count(*)::integer INTO _drafts FROM public.route_planning_drafts WHERE tenant_id = _tenant_id AND converted_load_id = ANY(_empty_load_ids);

  RETURN jsonb_build_object(
    'dispatch_events', _dispatch_events,
    'dispatch_stops', _dispatch_stops,
    'dispatch_trips', _dispatch_trips,
    'load_items', _load_items,
    'fiscal_documents', _fiscal_documents,
    'loads', _loads,
    'freight_calculation_log', _freight_logs,
    'route_planning_drafts', _drafts
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_reimport_batch_data(_tenant_id uuid, _start_date date DEFAULT NULL, _end_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path TO 'public'
AS $$
DECLARE
  _doc_ids uuid[] := ARRAY[]::uuid[];
  _empty_load_ids uuid[] := ARRAY[]::uuid[];
  _dispatch_events integer := 0;
  _dispatch_stops integer := 0;
  _dispatch_trips integer := 0;
  _load_items integer := 0;
  _fiscal_documents integer := 0;
  _loads integer := 0;
  _freight_logs integer := 0;
  _drafts integer := 0;
BEGIN
  IF NOT public.is_tenant_admin(_tenant_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO _doc_ids
  FROM public.fiscal_documents
  WHERE tenant_id = _tenant_id
    AND (_start_date IS NULL OR issue_date >= _start_date)
    AND (_end_date IS NULL OR issue_date <= _end_date);

  SELECT COALESCE(array_agg(DISTINCT li.load_id), ARRAY[]::uuid[])
  INTO _empty_load_ids
  FROM public.load_items li
  WHERE li.tenant_id = _tenant_id
    AND li.load_id IS NOT NULL
    AND li.fiscal_document_id = ANY(_doc_ids)
    AND NOT EXISTS (
      SELECT 1
      FROM public.load_items remaining
      WHERE remaining.load_id = li.load_id
        AND (remaining.fiscal_document_id IS NULL OR remaining.fiscal_document_id <> ALL(_doc_ids))
    );

  DELETE FROM public.dispatch_events
  WHERE tenant_id = _tenant_id
    AND dispatch_trip_id IN (SELECT id FROM public.dispatch_trips WHERE tenant_id = _tenant_id AND load_id = ANY(_empty_load_ids));
  GET DIAGNOSTICS _dispatch_events = ROW_COUNT;

  DELETE FROM public.dispatch_stops
  WHERE tenant_id = _tenant_id
    AND dispatch_trip_id IN (SELECT id FROM public.dispatch_trips WHERE tenant_id = _tenant_id AND load_id = ANY(_empty_load_ids));
  GET DIAGNOSTICS _dispatch_stops = ROW_COUNT;

  DELETE FROM public.dispatch_trips WHERE tenant_id = _tenant_id AND load_id = ANY(_empty_load_ids);
  GET DIAGNOSTICS _dispatch_trips = ROW_COUNT;

  DELETE FROM public.load_items WHERE tenant_id = _tenant_id AND fiscal_document_id = ANY(_doc_ids);
  GET DIAGNOSTICS _load_items = ROW_COUNT;

  DELETE FROM public.freight_calculation_log WHERE tenant_id = _tenant_id AND entity_id = ANY(_doc_ids);
  GET DIAGNOSTICS _freight_logs = ROW_COUNT;

  DELETE FROM public.route_planning_drafts WHERE tenant_id = _tenant_id AND converted_load_id = ANY(_empty_load_ids);
  GET DIAGNOSTICS _drafts = ROW_COUNT;

  DELETE FROM public.fiscal_documents WHERE id = ANY(_doc_ids);
  GET DIAGNOSTICS _fiscal_documents = ROW_COUNT;

  DELETE FROM public.loads WHERE tenant_id = _tenant_id AND id = ANY(_empty_load_ids);
  GET DIAGNOSTICS _loads = ROW_COUNT;

  UPDATE public.loads l
  SET
    total_pallet_count = COALESCE((SELECT SUM(pallet_count) FROM public.load_items WHERE load_id = l.id), 0),
    total_weight_kg = COALESCE((SELECT SUM(weight_kg) FROM public.load_items WHERE load_id = l.id), 0),
    total_volume_m3 = COALESCE((SELECT SUM(volume_m3) FROM public.load_items WHERE load_id = l.id), 0),
    updated_at = now()
  WHERE l.tenant_id = _tenant_id
    AND EXISTS (SELECT 1 FROM public.load_items li WHERE li.load_id = l.id);

  RETURN jsonb_build_object(
    'dispatch_events', _dispatch_events,
    'dispatch_stops', _dispatch_stops,
    'dispatch_trips', _dispatch_trips,
    'load_items', _load_items,
    'fiscal_documents', _fiscal_documents,
    'loads', _loads,
    'freight_calculation_log', _freight_logs,
    'route_planning_drafts', _drafts
  );
END;
$$;