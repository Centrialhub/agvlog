REVOKE ALL ON FUNCTION public.update_load_v1(uuid,uuid,jsonb,integer) FROM anon;
REVOKE ALL ON FUNCTION public.delete_load_v1(uuid,uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_load_v1(uuid,uuid,jsonb,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_load_v1(uuid,uuid) TO authenticated, service_role;