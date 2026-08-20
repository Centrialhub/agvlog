-- Comprehensive RPC Security & Access Alignment
-- Revokes mass access from PUBLIC and restores specific access to authenticated/service_role

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
        -- 1. Revoke from PUBLIC (Always safe, default in Postgres is usually too broad)
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', func_record.name, func_record.args);
        
        -- 2. If it's a SECURITY DEFINER function, ensure search_path is set (Violations 3 & 4)
        IF func_record.is_sec_def THEN
            EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public', func_record.name, func_record.args);
        END IF;

        -- 3. Grant to service_role (Admin/Edge Functions always need this)
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', func_record.name, func_record.args);

        -- 4. Grant to authenticated (Standard user access)
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', func_record.name, func_record.args);
        
        -- 5. Conditional grant to anon (Onboarding/Portal Login)
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
