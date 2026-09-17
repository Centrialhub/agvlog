CREATE OR REPLACE FUNCTION public.validate_trip_stop_poi_tenant_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.poi_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM public.pois poi
     WHERE poi.id = NEW.poi_id
       AND poi.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'trip_stop_poi_tenant_mismatch';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_trip_stop_poi_tenant ON public.trip_stops;
CREATE TRIGGER trg_validate_trip_stop_poi_tenant
BEFORE INSERT OR UPDATE OF tenant_id, poi_id ON public.trip_stops
FOR EACH ROW EXECUTE FUNCTION public.validate_trip_stop_poi_tenant_v1();

COMMENT ON FUNCTION public.validate_trip_stop_poi_tenant_v1() IS
  'Rejects trip-stop POI references that do not exist in the same tenant.';
