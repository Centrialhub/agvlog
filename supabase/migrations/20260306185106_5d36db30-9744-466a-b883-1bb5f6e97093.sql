
-- Add unique constraint on positions_last(tenant_id, vehicle_id) for upsert support
ALTER TABLE public.positions_last ADD CONSTRAINT positions_last_tenant_vehicle_unique UNIQUE (tenant_id, vehicle_id);

-- Add unique constraint on ingestion_cursors(tenant_id, provider_unit_id) for upsert support
ALTER TABLE public.ingestion_cursors ADD CONSTRAINT ingestion_cursors_tenant_unit_unique UNIQUE (tenant_id, provider_unit_id);
