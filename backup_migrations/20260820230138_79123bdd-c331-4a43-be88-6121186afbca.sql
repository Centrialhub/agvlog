-- RPC Access Restoration: Grant EXECUTE to authenticated and service_role
-- This migration fixes the global lockout caused by mass revokes while maintaining security.

DO $$ 
DECLARE 
    func_record RECORD;
BEGIN
    FOR func_record IN 
        SELECT 
            n.nspname as schema,
            p.proname as name,
            pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.prosecdef = true -- Only SECURITY DEFINER functions
          AND p.proname NOT LIKE 'pg_%'
    LOOP
        -- Grant EXECUTE to authenticated role
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', func_record.name, func_record.args);
        -- Grant EXECUTE to service_role (always needed for Edge Functions/Admin)
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', func_record.name, func_record.args);
        
        -- Special cases for anon access (Onboarding and Portal entry points)
        IF func_record.name IN (
            'create_tenant_with_owner',
            'get_user_portal_tenants',
            'get_user_client_access',
            'get_user_client_access_detailed'
        ) THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon', func_record.name, func_record.args);
        END IF;
    END LOOP;
END $$;

-- linter:allow-no-tenant
