
-- Phase 1: Clean contaminated data and reset pipeline for fresh collection
-- Delete all processed data (trips, stops, events, metrics) since positions are contaminated
DELETE FROM public.metrics_daily;
DELETE FROM public.route_runs;
DELETE FROM public.trip_stops;
DELETE FROM public.trips;
DELETE FROM public.events WHERE source = 'engine';
DELETE FROM public.fuel_events;

-- Reset processing queue
UPDATE public.vehicle_processing_queue SET processed_at = NULL, attempts = 0, last_error = NULL;

-- Reset ingestion cursors to force re-collection with clean filters
UPDATE public.ingestion_cursors SET 
  last_success_at = NULL, 
  last_polled_at = NULL, 
  last_error = NULL, 
  last_error_at = NULL, 
  backoff_until = NULL,
  poll_memo = '{}'::jsonb;

-- Delete ALL contaminated positions (they have cross-unit data)
DELETE FROM public.positions_raw;
DELETE FROM public.positions_last;
