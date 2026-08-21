
-- Limpeza global de XMLs e dados operacionais derivados
DELETE FROM public.dispatch_stop_documents;
DELETE FROM public.dispatch_events;
DELETE FROM public.dispatch_stops;
DELETE FROM public.dispatch_trip_loads;
DELETE FROM public.dispatch_trips;
DELETE FROM public.route_planning_stop_drafts;
DELETE FROM public.route_planning_drafts;
DELETE FROM public.cte_sefaz_events;
DELETE FROM public.cte_documents;
DELETE FROM public.load_items;
DELETE FROM public.load_documents;
DELETE FROM public.load_orders;
DELETE FROM public.load_manifests;
DELETE FROM public.load_note_audit_events;
DELETE FROM public.freight_calculation_log;
DELETE FROM public.freight_override_log;
DELETE FROM public.fiscal_documents;
DELETE FROM public.loads;
DELETE FROM public.ort_extraction_audits;
DELETE FROM public.ingestion_reports;
