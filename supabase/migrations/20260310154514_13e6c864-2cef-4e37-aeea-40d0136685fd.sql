-- Drop the partial unique index that PostgREST cannot target with ON CONFLICT
DROP INDEX IF EXISTS idx_positions_raw_dedupe;

-- Create a proper (non-partial) unique constraint that matches the application upsert
ALTER TABLE positions_raw
  ADD CONSTRAINT uq_positions_raw_dedupe
  UNIQUE (tenant_id, vehicle_id, provider_payload_hash);