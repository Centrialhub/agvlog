-- Habilitando RLS em tabelas que possam estar sem (conforme detectado pelo linter)
ALTER TABLE IF EXISTS public.tenant_emitters ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.hub_fiscal_configs ENABLE ROW LEVEL SECURITY;

-- Aplicando search_path em funções críticas para conformidade de segurança
ALTER FUNCTION public.audit_data_consistency_v4(uuid) SET search_path = public;
ALTER FUNCTION public.execute_data_repair_v1(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.transition_stop_status_v1(uuid, uuid, text, uuid, text, text, jsonb) SET search_path = public;
ALTER FUNCTION public.transition_trip_status_v1(uuid, uuid, text, uuid, text, text, jsonb) SET search_path = public;
ALTER FUNCTION public.derive_trip_and_load_status_v1(uuid, uuid) SET search_path = public;
