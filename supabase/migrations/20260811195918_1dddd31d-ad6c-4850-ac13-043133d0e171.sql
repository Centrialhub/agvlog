UPDATE public.loads SET trip_id = NULL, status = 'ready' WHERE id = '0b988ce7-6be8-485c-bf1a-40cbb927bcea';
DELETE FROM public.dispatch_stops WHERE dispatch_trip_id IN ('69383db8-43a5-46ae-8479-229a70f5a045', '3b0ed364-9ea4-4b16-9e82-8c4a640beda9');
DELETE FROM public.dispatch_trip_loads WHERE dispatch_trip_id IN ('69383db8-43a5-46ae-8479-229a70f5a045', '3b0ed364-9ea4-4b16-9e82-8c4a640beda9');
DELETE FROM public.dispatch_trips WHERE id IN ('69383db8-43a5-46ae-8479-229a70f5a045', '3b0ed364-9ea4-4b16-9e82-8c4a640beda9');
-- linter:allow-no-tenant legacy-migration 2026-12-31
