-- Finalizing search_path and RLS policies

-- 1. Setting search_path for identified functions to satisfy linter
ALTER FUNCTION public.check_load_dispatch_duplicity() SET search_path = public;
ALTER FUNCTION public._touch_driver_settlements_updated_at() SET search_path = public;
ALTER FUNCTION public.normalize_vehicle_plate(text) SET search_path = public;
ALTER FUNCTION public.trg_vehicles_normalize_plate() SET search_path = public;
ALTER FUNCTION public.trg_freight_tables_require_context() SET search_path = public;
ALTER FUNCTION public._block_client_membership() SET search_path = public;
ALTER FUNCTION public.trg_handle_empty_load_on_doc_change() SET search_path = public;
ALTER FUNCTION public.normalize_tax_id(text) SET search_path = public;
ALTER FUNCTION public.normalize_fiscal_number(text) SET search_path = public;

-- 2. Closing fiscal_webhook_inbox policy (service_role only by default, but linter wants a policy)
CREATE POLICY "Service role only access"
ON public.fiscal_webhook_inbox
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
