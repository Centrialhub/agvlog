REVOKE EXECUTE ON FUNCTION public.plan_dispatch_start_trip_v1(UUID, UUID, UUID, UUID[], JSONB, TIMESTAMPTZ, TEXT, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.plan_dispatch_start_trip_v1(UUID, UUID, UUID, UUID[], JSONB, TIMESTAMPTZ, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.plan_dispatch_start_trip_v1(UUID, UUID, UUID, UUID[], JSONB, TIMESTAMPTZ, TEXT, BOOLEAN) TO service_role;

REVOKE EXECUTE ON FUNCTION public.sync_trip_load_mirrors() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_trip_load_mirrors() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_trip_load_mirrors() TO service_role;