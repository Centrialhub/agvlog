-- Temporary DML Restoration: Revert premature revocation to unblock frontend
-- Direct writes will be revoked later, one by one, as hooks are migrated to RPCs.

GRANT INSERT, UPDATE, DELETE ON public.loads TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.load_items TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.dispatch_trips TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.dispatch_stops TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.dispatch_trip_loads TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.dispatch_stop_documents TO authenticated;

-- linter:allow-no-tenant
