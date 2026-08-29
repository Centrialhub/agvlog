-- Selective follow-up to production_baseline_hardening.sql.
--
-- The Supabase performance advisor reports every uncovered foreign key. This
-- bridge intentionally covers only the high-volume/core frontend paths found
-- in production; indexing hundreds of empty or tiny-table FKs would add write
-- amplification without a measurable read or referential-integrity benefit.

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '120s';

CREATE INDEX IF NOT EXISTS idx_events_vehicle_id_fk
  ON public.events USING btree (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_load_id_fk
  ON public.fiscal_documents USING btree (load_id);
CREATE INDEX IF NOT EXISTS idx_metrics_daily_vehicle_id_fk
  ON public.metrics_daily USING btree (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_positions_raw_vehicle_id_fk
  ON public.positions_raw USING btree (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_trip_stops_trip_id_fk
  ON public.trip_stops USING btree (trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_stops_vehicle_id_fk
  ON public.trip_stops USING btree (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_trips_vehicle_id_fk
  ON public.trips USING btree (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_events_vehicle_id_fk
  ON public.vehicle_events USING btree (vehicle_id);

DO $frontend_fk_index_postconditions$
DECLARE
  index_name text;
  expected_indexes constant text[] := ARRAY[
    'idx_events_vehicle_id_fk',
    'idx_fiscal_documents_load_id_fk',
    'idx_metrics_daily_vehicle_id_fk',
    'idx_positions_raw_vehicle_id_fk',
    'idx_trip_stops_trip_id_fk',
    'idx_trip_stops_vehicle_id_fk',
    'idx_trips_vehicle_id_fk',
    'idx_vehicle_events_vehicle_id_fk'
  ];
BEGIN
  FOREACH index_name IN ARRAY expected_indexes LOOP
    IF to_regclass(format('public.%I', index_name)) IS NULL THEN
      RAISE EXCEPTION 'Postcondition failed: expected index % is missing', index_name;
    END IF;
  END LOOP;
END;
$frontend_fk_index_postconditions$;
