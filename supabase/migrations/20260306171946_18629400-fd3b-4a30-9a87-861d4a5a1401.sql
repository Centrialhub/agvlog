
-- Move PostGIS to extensions schema (security best practice)
DROP EXTENSION IF EXISTS postgis CASCADE;
CREATE EXTENSION IF NOT EXISTS postgis SCHEMA extensions;

-- Recreate the geofences table geometry column referencing extensions schema
-- The cascade above dropped geofences.geometry and dependent objects
-- Recreate them
ALTER TABLE public.geofences ADD COLUMN IF NOT EXISTS geometry extensions.geometry(Polygon, 4326);
CREATE INDEX IF NOT EXISTS idx_geofences_geom ON public.geofences USING GIST (geometry);

-- Recreate the upsert_geofence function with extensions schema reference
CREATE OR REPLACE FUNCTION public.upsert_geofence(
  _id uuid,
  _tenant_id uuid,
  _name text,
  _category text,
  _geojson text,
  _enabled boolean
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _result_id uuid;
BEGIN
  IF NOT is_tenant_admin(_tenant_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  
  IF _id IS NOT NULL THEN
    UPDATE public.geofences
    SET name = _name, category = _category,
        geometry = extensions.ST_GeomFromGeoJSON(_geojson),
        enabled = _enabled
    WHERE id = _id AND tenant_id = _tenant_id
    RETURNING id INTO _result_id;
  END IF;
  
  IF _result_id IS NULL THEN
    INSERT INTO public.geofences (tenant_id, name, category, geometry, enabled)
    VALUES (_tenant_id, _name, _category, extensions.ST_GeomFromGeoJSON(_geojson), _enabled)
    RETURNING id INTO _result_id;
  END IF;
  
  RETURN _result_id;
END;
$$;
