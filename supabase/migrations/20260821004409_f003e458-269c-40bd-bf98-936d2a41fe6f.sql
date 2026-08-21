-- Security Hardening with Real Signatures

-- 1. Global revokes
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- 2. Grant real signatures to authenticated role
GRANT EXECUTE ON FUNCTION public.create_employee_v1(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_employee_v1(uuid, uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_employee_v1(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_load_v1(uuid, uuid, uuid, text, text, text, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_load_v1(uuid, uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_load_item_v1(uuid, uuid, text, numeric, numeric, numeric, numeric, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_load_v1(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_client_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_owner(text) TO authenticated;

-- 3. Explicitly ensure anon is revoked from these real signatures
REVOKE EXECUTE ON FUNCTION public.create_employee_v1(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_employee_v1(uuid, uuid, jsonb, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_employee_v1(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_load_v1(uuid, uuid, uuid, text, text, text, text, timestamptz, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_load_v1(uuid, uuid, jsonb, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.upsert_load_item_v1(uuid, uuid, text, numeric, numeric, numeric, numeric, uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_load_v1(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_user_client_access(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_tenant_with_owner(text) FROM anon;
