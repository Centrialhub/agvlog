
DO $$
DECLARE
  _tenant uuid := '6e874e6e-5bca-486d-9928-bef0646989c4';
  _doc_ids uuid[];
  _load_ids uuid[];
  _trip_ids uuid[];
BEGIN
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO _doc_ids
    FROM public.fiscal_documents WHERE tenant_id = _tenant;

  SELECT COALESCE(array_agg(DISTINCT load_id), ARRAY[]::uuid[]) INTO _load_ids
    FROM public.load_items WHERE tenant_id = _tenant AND load_id IS NOT NULL;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO _trip_ids
    FROM public.dispatch_trips WHERE tenant_id = _tenant AND load_id = ANY(_load_ids);

  DELETE FROM public.dispatch_events WHERE tenant_id = _tenant AND dispatch_trip_id = ANY(_trip_ids);
  DELETE FROM public.dispatch_stop_documents WHERE tenant_id = _tenant
    AND dispatch_stop_id IN (SELECT id FROM public.dispatch_stops WHERE dispatch_trip_id = ANY(_trip_ids));
  DELETE FROM public.dispatch_stops WHERE tenant_id = _tenant AND dispatch_trip_id = ANY(_trip_ids);
  DELETE FROM public.dispatch_trip_loads WHERE tenant_id = _tenant AND dispatch_trip_id = ANY(_trip_ids);
  DELETE FROM public.dispatch_trips WHERE tenant_id = _tenant AND id = ANY(_trip_ids);

  DELETE FROM public.load_items WHERE tenant_id = _tenant;
  DELETE FROM public.freight_calculation_log WHERE tenant_id = _tenant AND entity_id = ANY(_doc_ids);
  DELETE FROM public.route_planning_drafts WHERE tenant_id = _tenant AND converted_load_id = ANY(_load_ids);
  DELETE FROM public.fiscal_documents WHERE tenant_id = _tenant;
  DELETE FROM public.loads WHERE tenant_id = _tenant AND id = ANY(_load_ids);
END $$;
