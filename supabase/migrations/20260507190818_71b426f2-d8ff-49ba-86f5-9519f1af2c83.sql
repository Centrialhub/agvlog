
-- Allow upsert per entity for freight calculation log (one current row per CT-e)
CREATE UNIQUE INDEX IF NOT EXISTS uq_freight_calculation_log_entity
  ON public.freight_calculation_log(tenant_id, entity_type, entity_id);
