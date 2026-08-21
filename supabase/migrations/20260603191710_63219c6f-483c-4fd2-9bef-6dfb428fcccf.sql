DO $$
DECLARE
  _tenant uuid := '6e874e6e-5bca-486d-9928-bef0646989c4';
  _doc_ids uuid[];
  _empty_load_ids uuid[];
  _trip_ids uuid[];
BEGIN
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO _doc_ids
    FROM public.fiscal_documents
    WHERE tenant_id = _tenant;

  SELECT COALESCE(array_agg(DISTINCT li.load_id), ARRAY[]::uuid[])
    INTO _empty_load_ids
    FROM public.load_items li
    WHERE li.tenant_id = _tenant
      AND li.load_id IS NOT NULL
      AND li.fiscal_document_id = ANY(_doc_ids);

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
    INTO _trip_ids
    FROM public.dispatch_trips
    WHERE tenant_id = _tenant AND load_id = ANY(_empty_load_ids);

  DELETE FROM public.dispatch_stop_documents
   WHERE tenant_id = _tenant AND dispatch_stop_id IN (
     SELECT id FROM public.dispatch_stops WHERE tenant_id = _tenant AND dispatch_trip_id = ANY(_trip_ids)
   );
  DELETE FROM public.dispatch_events     WHERE tenant_id = _tenant AND dispatch_trip_id = ANY(_trip_ids);
  DELETE FROM public.dispatch_stops      WHERE tenant_id = _tenant AND dispatch_trip_id = ANY(_trip_ids);
  DELETE FROM public.dispatch_trip_loads WHERE tenant_id = _tenant AND dispatch_trip_id = ANY(_trip_ids);
  DELETE FROM public.dispatch_trips      WHERE tenant_id = _tenant AND id = ANY(_trip_ids);

  DELETE FROM public.load_items              WHERE tenant_id = _tenant AND fiscal_document_id = ANY(_doc_ids);
  DELETE FROM public.freight_calculation_log WHERE tenant_id = _tenant AND entity_id = ANY(_doc_ids);
  DELETE FROM public.route_planning_drafts   WHERE tenant_id = _tenant AND converted_load_id = ANY(_empty_load_ids);
  DELETE FROM public.fiscal_documents        WHERE id = ANY(_doc_ids);
  DELETE FROM public.loads                   WHERE tenant_id = _tenant AND id = ANY(_empty_load_ids);

  UPDATE public.loads l
     SET total_pallet_count = COALESCE((SELECT SUM(pallet_count) FROM public.load_items WHERE load_id = l.id), 0),
         total_weight_kg    = COALESCE((SELECT SUM(weight_kg)    FROM public.load_items WHERE load_id = l.id), 0),
         total_volume_m3    = COALESCE((SELECT SUM(volume_m3)    FROM public.load_items WHERE load_id = l.id), 0),
         updated_at = now()
   WHERE l.tenant_id = _tenant;
END $$;