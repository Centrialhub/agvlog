-- Final Security Hardening: Addressing Linter Warnings

-- 1. Fix RLS references user metadata
DROP POLICY IF EXISTS "Tenant isolation" ON public.tenant_emitters;
CREATE POLICY "Tenant isolation" ON public.tenant_emitters
FOR ALL TO authenticated USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- 2. Revoke execute from PUBLIC for ALL security definer functions in public schema (Violations 6 & 7)
-- Using pg_get_function_identity_arguments to avoid DEFAULT values in REVOKE/GRANT statements
DO $$ 
DECLARE 
    func_record record;
BEGIN 
    FOR func_record IN 
        SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid 
        WHERE n.nspname = 'public' 
          AND p.prokind = 'f' 
          AND p.prosecdef = true
    LOOP 
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', func_record.proname, func_record.args);
    END LOOP; 
END $$;

-- 3. Re-grant execute to authenticated for specific API functions
GRANT EXECUTE ON FUNCTION public.get_user_tenant_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_tenant_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_operator_or_admin(uuid) TO authenticated;

-- 4. Address Function Search Path Mutable
ALTER FUNCTION public.get_user_tenant_ids() SET search_path = public;
ALTER FUNCTION public.has_tenant_role(uuid, app_role) SET search_path = public;
ALTER FUNCTION public.is_tenant_member(uuid) SET search_path = public;
ALTER FUNCTION public.is_tenant_admin(uuid) SET search_path = public;
ALTER FUNCTION public.is_tenant_operator_or_admin(uuid) SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;
