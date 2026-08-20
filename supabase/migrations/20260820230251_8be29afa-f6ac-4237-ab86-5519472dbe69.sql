-- Targeted RPC Security Correction
-- Revokes execute from 'anon' for all functions EXCEPT explicit public entry points
-- Restores secure search_path for all security definer functions

DO $$ 
DECLARE 
    func_record RECORD;
BEGIN
    FOR func_record IN 
        SELECT 
            n.nspname as schema,
            p.proname as name,
            pg_get_function_identity_arguments(p.oid) as args,
            p.prosecdef as is_sec_def
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.prokind = 'f'
          AND p.proname NOT LIKE 'pg_%'
    LOOP
        -- 1. Ensure security definer functions have search_path set to public
        IF func_record.is_sec_def THEN
            EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public', func_record.name, func_record.args);
        END IF;

        -- 2. Revoke from anon unless explicitly whitelisted for portal/onboarding
        IF func_record.name NOT IN (
            'create_tenant_with_owner',
            'get_user_portal_tenants',
            'get_user_client_access',
            'get_user_client_access_detailed',
            'handle_new_user'
        ) THEN
            EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', func_record.name, func_record.args);
        END IF;
    END LOOP;
END $$;

-- linter:allow-no-tenant
