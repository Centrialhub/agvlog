REVOKE EXECUTE ON FUNCTION public.process_geofence_alerts(uuid, uuid, double precision, double precision, timestamptz) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.process_geofence_alerts(uuid, uuid, double precision, double precision, timestamptz) TO service_role;

REVOKE EXECUTE ON FUNCTION public.process_overspeed_alerts(uuid, uuid, numeric, timestamptz) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.process_overspeed_alerts(uuid, uuid, numeric, timestamptz) TO service_role;

REVOKE EXECUTE ON FUNCTION public.calculate_vehicle_trips_v1(uuid, timestamptz, timestamptz) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.calculate_vehicle_trips_v1(uuid, timestamptz, timestamptz) TO service_role;