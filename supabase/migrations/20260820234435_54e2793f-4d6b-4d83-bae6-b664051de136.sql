-- Security Permission Alignment Migration
-- Target: Fix excess permissions from 20260820230138 and 20260820230214

-- 1. Create standardized membership checker if not exists
CREATE OR REPLACE FUNCTION public.check_tenant_membership(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.tenant_memberships
        WHERE user_id = auth.uid()
          AND tenant_id = p_tenant_id
          AND active = true
    ) AND auth.role() != 'service_role' THEN
        RAISE EXCEPTION 'Acesso negado: Usuário não é membro do tenant %', p_tenant_id;
    END IF;
END;
$$;

-- 2. Revoke Broad Execution (Reset) and enforce search_path
DO $$ 
DECLARE 
    func_record RECORD;
BEGIN
    FOR func_record IN 
        SELECT 
            n.nspname as schema,
            p.proname as name,
            pg_get_function_identity_arguments(p.oid) as args,
            p.prosecdef as is_secdef,
            p.oid as func_oid
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.prokind = 'f'
          AND p.proname NOT LIKE 'pg_%'
    LOOP
        -- Revoke from PUBLIC roles
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC', func_record.name, func_record.args);
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM authenticated', func_record.name, func_record.args);
        EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM anon', func_record.name, func_record.args);
        
        -- Grant to service_role
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', func_record.name, func_record.args);
        
        -- Force search_path = public for all SECURITY DEFINER
        IF func_record.is_secdef THEN
            EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public', func_record.name, func_record.args);
        END IF;
    END LOOP;
END $$;

-- 3. Whitelist: Restore access to RPCs used by the frontend
DO $$ 
DECLARE 
    rpc_name text;
    rpc_record RECORD;
    v_rpc_list text[] := ARRAY[
        'accept_financial_match', 'cancel_client_invoice', 'cancel_occurrence_return_sheet',
        'create_client_invoice', 'create_client_occurrence', 'create_manual_expense',
        'create_manual_financial_match', 'create_merchandise_shortage_case',
        'driver_create_event', 'driver_create_expense', 'driver_create_operational_occurrence',
        'driver_report_event_v1', 'driver_save_checklist', 'generate_occurrence_return_sheet',
        'get_client_portal_shipment_detail', 'get_driver_workspace_v1', 'get_next_load_number_v1',
        'get_user_client_access', 'import_bank_statement', 'list_clients_v1',
        'list_drivers_v1', 'list_employees_v1', 'list_fiscal_documents_v1',
        'list_loads_v1', 'list_operational_routes_v1', 'log_operational_event_v2',
        'plan_dispatch_trip_v2', 'register_payable_payment', 'register_receivable_payment',
        'reject_financial_match', 'request_client_pickup', 'reverse_financial_match',
        'reverse_payable_payment', 'reverse_receivable_payment', 'revert_xml_loads_to_available',
        'run_bank_reconciliation', 'soft_delete_fiscal_document', 'sync_financial_obligations',
        'update_merchandise_shortage_status', 'upsert_geofence', 'get_user_tenant_ids',
        'has_tenant_role', 'is_tenant_member', 'is_tenant_admin', 'handle_new_user',
        'get_portal_tracking_v3', 'link_fiscal_documents_to_load_v1', 
        'unlink_fiscal_documents_from_load_v1', 'diagnose_load_composition', 'repair_load_composition',
        'create_tenant_with_owner'
    ];
BEGIN
    FOREACH rpc_name IN ARRAY v_rpc_list
    LOOP
        FOR rpc_record IN 
            SELECT pg_get_function_identity_arguments(p.oid) as args
            FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
            WHERE n.nspname = 'public' AND p.proname = rpc_name
        LOOP
            EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', rpc_name, rpc_record.args);
            -- Special cases for anon access (Onboarding)
            IF rpc_name IN ('create_tenant_with_owner', 'get_user_client_access') THEN
                EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO anon', rpc_name, rpc_record.args);
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- 4. Neutralize Unstable Modules
CREATE OR REPLACE FUNCTION public.execute_data_repair_v1(p_tenant_id uuid, p_batch_id uuid, p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'FEATURE_DISABLED: execute_data_repair_v1 está desativado para homologação.';
END;
$$;

-- Ensure execute_data_repair_v1 has NO EXECUTE for standard roles
DO $$
DECLARE
    rpc_record RECORD;
BEGIN
    FOR rpc_record IN 
        SELECT pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'execute_data_repair_v1'
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.execute_data_repair_v1(%s) FROM PUBLIC, authenticated, anon', rpc_record.args);
    END LOOP;
END $$;

-- Deprecate plan_dispatch_start_trip_v1 (Revoke authenticated access)
DO $$
DECLARE
    rpc_record RECORD;
BEGIN
    FOR rpc_record IN 
        SELECT pg_get_function_identity_arguments(p.oid) as args
        FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'plan_dispatch_start_trip_v1'
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.plan_dispatch_start_trip_v1(%s) FROM authenticated', rpc_record.args);
    END LOOP;
END $$;

-- 5. View Security Alignment
DO $$ 
BEGIN
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'vw_load_composition') THEN
        ALTER VIEW public.vw_load_composition SET (security_invoker = true);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'vw_operational_workspace') THEN
        ALTER VIEW public.vw_operational_workspace SET (security_invoker = true);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'portal_shipment_read_model') THEN
        ALTER VIEW public.portal_shipment_read_model SET (security_invoker = true);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'vw_unified_logistics_timeline') THEN
        ALTER VIEW public.vw_unified_logistics_timeline SET (security_invoker = true);
    END IF;
END $$;