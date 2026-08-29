-- Keep the pre-existing composite indexes and remove identical copies that
-- were temporarily introduced while hardening the tenant-aware FK graph.
DROP INDEX IF EXISTS public.idx_driver_route_monitors_tenant_driver;
DROP INDEX IF EXISTS public.idx_driver_route_monitors_tenant_vehicle;
DROP INDEX IF EXISTS public.idx_driver_route_monitors_tenant_load;
DROP INDEX IF EXISTS public.idx_driver_progress_tenant_monitor;
DROP INDEX IF EXISTS public.idx_driver_forecasts_tenant_monitor;
