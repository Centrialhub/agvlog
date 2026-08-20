-- Forward-only security tightening for data_repair
REVOKE INSERT, UPDATE, DELETE ON public.data_repair_batches FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.data_repair_batch_items FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_data_repair_v1(uuid, uuid, boolean) FROM authenticated;
GRANT ALL ON public.data_repair_batches TO service_role;
GRANT ALL ON public.data_repair_batch_items TO service_role;
ALTER TABLE public.data_repair_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_repair_batch_items ENABLE ROW LEVEL SECURITY;
REVOKE INSERT, UPDATE, DELETE ON public.employees FROM authenticated;
GRANT ALL ON public.employees TO service_role;