-- Final Security Hardening: Revoke direct writes to logistics canonical tables

REVOKE INSERT, UPDATE, DELETE ON public.loads FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.load_items FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.dispatch_trips FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.dispatch_stops FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.dispatch_trip_loads FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.dispatch_stop_documents FROM authenticated;

-- Ensure SELECT is granted
GRANT SELECT ON public.loads TO authenticated;
GRANT SELECT ON public.load_items TO authenticated;
GRANT SELECT ON public.dispatch_trips TO authenticated;
GRANT SELECT ON public.dispatch_stops TO authenticated;
GRANT SELECT ON public.dispatch_trip_loads TO authenticated;
GRANT SELECT ON public.dispatch_stop_documents TO authenticated;
