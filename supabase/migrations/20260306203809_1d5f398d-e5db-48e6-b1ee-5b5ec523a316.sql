-- PostGIS function for geofence point-in-polygon check
CREATE OR REPLACE FUNCTION public.is_point_in_geofence(
  _geofence_id uuid,
  _lng double precision,
  _lat double precision
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
  SELECT COALESCE(
    extensions.ST_Contains(
      geometry,
      extensions.ST_SetSRID(extensions.ST_Point(_lng, _lat), 4326)
    ),
    false
  )
  FROM public.geofences
  WHERE id = _geofence_id
$$;

-- Unique index on pois dedupe_key (for auto-POI upsert)
CREATE UNIQUE INDEX IF NOT EXISTS idx_pois_tenant_dedupe
ON public.pois (tenant_id, dedupe_key)
WHERE dedupe_key IS NOT NULL;

-- Unique index on telemetry_observations for upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_obs_unique
ON public.telemetry_observations (tenant_id, vehicle_id, canonical_key);

-- Unique index on ingestion_cursors for upsert
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingestion_cursors_unique
ON public.ingestion_cursors (provider_unit_id, tenant_id);