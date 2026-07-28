
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payables_payments TO authenticated;
GRANT ALL ON public.payables_payments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receivables_payments TO authenticated;
GRANT ALL ON public.receivables_payments TO service_role;
