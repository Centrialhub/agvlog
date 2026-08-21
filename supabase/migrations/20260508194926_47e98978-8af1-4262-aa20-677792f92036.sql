DO $$
DECLARE
  _doc_ids uuid[];
  _load_ids uuid[];
  _trip_ids uuid[];
BEGIN
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO _doc_ids FROM public.fiscal_documents;
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO _load_ids FROM public.loads;
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO _trip_ids FROM public.dispatch_trips;

  UPDATE public.operational_events  SET load_id = NULL            WHERE load_id = ANY(_load_ids);
  UPDATE public.inventory_movements SET fiscal_document_id = NULL WHERE fiscal_document_id = ANY(_doc_ids);
  UPDATE public.driver_expenses     SET dispatch_trip_id = NULL   WHERE dispatch_trip_id = ANY(_trip_ids);
  UPDATE public.vehicle_fueling     SET dispatch_trip_id = NULL   WHERE dispatch_trip_id = ANY(_trip_ids);

  DELETE FROM public.dispatch_events WHERE dispatch_trip_id = ANY(_trip_ids);
  DELETE FROM public.dispatch_stops  WHERE dispatch_trip_id = ANY(_trip_ids);
  DELETE FROM public.dispatch_trips  WHERE id = ANY(_trip_ids);

  DELETE FROM public.load_items;
  DELETE FROM public.load_documents;
  DELETE FROM public.load_orders;
  DELETE FROM public.load_note_audit_events;
  DELETE FROM public.freight_override_log WHERE fiscal_document_id = ANY(_doc_ids);
  DELETE FROM public.ort_extraction_audits WHERE fiscal_document_id = ANY(_doc_ids);
  DELETE FROM public.freight_calculation_log WHERE entity_id = ANY(_doc_ids);
  DELETE FROM public.route_planning_drafts;
  DELETE FROM public.fiscal_documents;
  DELETE FROM public.loads;
END $$;