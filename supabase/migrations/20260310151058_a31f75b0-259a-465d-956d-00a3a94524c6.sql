
-- Add metadata JSONB column to provider_units for richer SSX identifiers
ALTER TABLE public.provider_units 
ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Add poll_memo JSONB column to ingestion_cursors for per-unit memoization
ALTER TABLE public.ingestion_cursors
ADD COLUMN IF NOT EXISTS poll_memo jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.provider_units.metadata IS 'Rich SSX identifiers: tracked_unit_integration_code, tracked_unit, tracker_integration_code, id_tracker, imei, plate, source_mode';
COMMENT ON COLUMN public.ingestion_cursors.poll_memo IS 'Per-unit memoized polling combo: poll_working_property, poll_working_value_source, poll_working_url, poll_working_format, poll_working_time_prop';
