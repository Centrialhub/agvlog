CREATE OR REPLACE FUNCTION public.clear_reimport_batch_data(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
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

  DELETE FROM public.dispatch_events WHERE tenant_id = _tenant_id;
  GET DIAGNOSTICS _dispatch_events = ROW_COUNT;

  DELETE FROM public.dispatch_stops WHERE tenant_id = _tenant_id;
  GET DIAGNOSTICS _dispatch_stops = ROW_COUNT;

  DELETE FROM public.dispatch_trips WHERE tenant_id = _tenant_id;
  GET DIAGNOSTICS _dispatch_trips = ROW_COUNT;

  DELETE FROM public.load_items WHERE tenant_id = _tenant_id;
  GET DIAGNOSTICS _load_items = ROW_COUNT;

  DELETE FROM public.fiscal_documents WHERE tenant_id = _tenant_id;
  GET DIAGNOSTICS _fiscal_documents = ROW_COUNT;

  DELETE FROM public.loads WHERE tenant_id = _tenant_id;
  GET DIAGNOSTICS _loads = ROW_COUNT;

  DELETE FROM public.freight_calculation_log WHERE tenant_id = _tenant_id;
  GET DIAGNOSTICS _freight_logs = ROW_COUNT;

  DELETE FROM public.route_planning_drafts WHERE tenant_id = _tenant_id;
  GET DIAGNOSTICS _drafts = ROW_COUNT;

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