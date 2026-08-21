-- Granting explicit EXECUTE permissions to RLS helpers and core listing RPCs

-- 1. Ensure RLS helpers are executable by authenticated users
GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_operator_or_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_tenant_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_tenant_role(uuid, public.app_role) TO authenticated;

-- 2. Grant EXECUTE to primary listing functions used in security tests and core UI
GRANT EXECUTE ON FUNCTION public.list_loads_v1(uuid, text, text[], timestamptz, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_employees_v1(uuid, text, text, int, int) TO authenticated;
