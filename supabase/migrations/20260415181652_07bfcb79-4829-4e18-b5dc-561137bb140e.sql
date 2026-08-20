
-- Clear load items
DELETE FROM public.load_items;

-- Clear dispatch chain
DELETE FROM public.dispatch_events;
DELETE FROM public.dispatch_stops;
DELETE FROM public.dispatch_trips;

-- Clear fiscal documents BEFORE loads (FK dependency)
DELETE FROM public.fiscal_documents;

-- Clear orders
DELETE FROM public.orders;

-- Now clear loads
DELETE FROM public.loads;

-- Clear freight logs
DELETE FROM public.freight_calculation_log;

-- linter:allow-no-tenant legacy-migration 2026-12-31
