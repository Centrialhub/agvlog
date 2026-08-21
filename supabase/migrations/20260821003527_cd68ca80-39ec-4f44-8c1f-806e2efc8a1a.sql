-- Security alignment and explicit RPC grant matrix

-- 1. Neutralize execute_data_repair_v1
CREATE OR REPLACE FUNCTION public.execute_data_repair_v1(
    _tenant_id uuid,
    _batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RAISE EXCEPTION 'FEATURE_DISABLED: execute_data_repair_v1 is currently inactive.';
END;
$$;

-- 2. Revoke mass EXECUTE from PUBLIC
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- 3. Inventory and Grant EXECUTE for whitelisted RPCs to authenticated role
-- We grant to specific signatures to avoid overload leakage

DO $$
DECLARE
    rpc_list text[] := ARRAY[
        'accept_financial_match(uuid,uuid)',
        'add_driver_settlement_adjustment(uuid,text,numeric,text,text)',
        'add_driver_settlement_manual_expense(uuid,text,numeric,timestamptz,text,text,boolean,text,text)',
        'attach_loads_to_driver_settlement(uuid,uuid[])',
        'audit_data_consistency_v4(uuid)',
        'cancel_client_invoice(uuid,uuid)',
        'cancel_client_pickup(uuid,uuid)',
        'cancel_doccob_export(uuid,uuid)',
        'cancel_occurrence_return_sheet(uuid,uuid)',
        'create_client_invoice(uuid,uuid,date,text,uuid[],numeric,jsonb)',
        'create_client_occurrence(uuid,uuid,text,text,text[])',
        'create_employee_v1(uuid,text,text,text,text,text,text,text,date,text,text,text,text,text,text,text,text,date,date,numeric,numeric,numeric,numeric,numeric,jsonb)',
        'create_load_v1(uuid,text,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,jsonb)',
        'create_manual_driver_settlement(uuid,uuid,uuid,date,uuid[])',
        'create_manual_expense(uuid,text,numeric,timestamptz,text,text,boolean,text,text)',
        'create_manual_financial_match(uuid,uuid,uuid,numeric,text)',
        'create_merchandise_shortage_case(uuid,uuid,uuid,text,numeric,text,text[])',
        'create_tenant_with_owner(text,text,text)',
        'delete_driver_settlement(uuid)',
        'delete_employee_v1(uuid,uuid)',
        'delete_load_v1(uuid,uuid)',
        'detach_load_from_driver_settlement(uuid,uuid)',
        'driver_create_event(uuid,uuid,text,double precision,double precision,jsonb)',
        'driver_create_expense(uuid,uuid,text,numeric,text,text,text)',
        'driver_create_operational_occurrence(uuid,uuid,uuid,text,text,text[])',
        'driver_report_event_v1(uuid,uuid,text,jsonb)',
        'driver_save_checklist(uuid,uuid,text,jsonb)',
        'generate_driver_settlement(uuid,uuid)',
        'generate_occurrence_return_sheet(uuid,uuid,uuid,uuid[])',
        'generate_pending_driver_settlements(uuid)',
        'get_active_trips_live(uuid)',
        'get_client_portal_shipment_detail_v2(uuid)',
        'get_driver_workspace_v1(uuid)',
        'get_next_load_number_v1(uuid)',
        'get_open_trip_alerts(uuid)',
        'get_operational_financial_summary_v1(uuid,date,date)',
        'get_user_client_access(uuid)',
        'get_user_client_access_detailed(uuid)',
        'import_bank_statement(uuid,uuid,text,text)',
        'list_available_loads_for_settlement(uuid,uuid,text,uuid,int)',
        'list_client_occurrence_messages(uuid,uuid)',
        'list_clients_v1(uuid,text,int,int)',
        'list_driver_settlement_filter_options(uuid)',
        'list_driver_settlements(uuid,text,uuid,uuid,text,date,date,boolean,boolean,boolean,boolean,int,int)',
        'list_drivers_v1(uuid,text,int,int)',
        'list_employees_v1(uuid,text,text,int,int)',
        'list_fiscal_documents_v1(uuid,text,text,text,date,date,int,int)',
        'list_loads_v1(uuid,text,text,text,date,date,int,int)',
        'list_operational_routes_v1(uuid,text,int,int)',
        'log_operational_event_v2(uuid,uuid,text,jsonb)',
        'mark_doccob_downloaded(uuid,uuid)',
        'mark_doccob_sent(uuid,uuid,text,text)',
        'move_load_items_v3(uuid,uuid,uuid,uuid[])',
        'peek_next_pickup_number(uuid)',
        'plan_dispatch_trip_v2(uuid,uuid,uuid,text,uuid[],jsonb)',
        'register_doccob_export(uuid,uuid,uuid,uuid[],text,date,text,text,int,numeric,int,int,text)',
        'register_driver_settlement_payment_v2(uuid,numeric,text,text,text,text,text,boolean,text,uuid,text)',
        'register_payable_payment(uuid,numeric,date,text,text,text,uuid)',
        'register_receivable_payment(uuid,numeric,date,text,text,text,uuid)',
        'reject_financial_match(uuid,uuid)',
        'remove_driver_settlement_adjustment(uuid,uuid,text)',
        'reply_client_occurrence(uuid,uuid,text)',
        'request_client_pickup(uuid,uuid,date,text,text,jsonb)',
        'reverse_financial_match(uuid,uuid)',
        'reverse_payable_payment(uuid)',
        'reverse_receivable_payment(uuid)',
        'revert_xml_loads_to_available(uuid,uuid[])',
        'run_bank_reconciliation(uuid,uuid,date,date)',
        'settle_zero_driver_settlement(uuid,text)',
        'soft_delete_fiscal_document(uuid,uuid)',
        'get_user_portal_tenants()',
        'monitor_simples_nacional_icms_violations(uuid)',
        'sync_financial_obligations(uuid,date,date)',
        'update_driver_settlement_km_review(uuid,numeric,numeric,text)',
        'update_driver_settlement_status(uuid,text,text,boolean)',
        'update_employee_v1(uuid,uuid,text,text,text,text,text,text,text,date,text,text,text,text,text,text,text,text,date,date,numeric,numeric,numeric,numeric,numeric,jsonb)',
        'update_load_v1(uuid,uuid,text,uuid,uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,numeric,jsonb)',
        'update_merchandise_shortage_status(uuid,uuid,text,text)',
        'upsert_geofence(uuid,uuid,text,text,text,boolean)',
        'upsert_load_item_v1(uuid,uuid,text,text,text,text,text,text,text,numeric,numeric,numeric,numeric,jsonb)'
    ];
    rpc text;
BEGIN
    FOREACH rpc IN ARRAY rpc_list
    LOOP
        BEGIN
            EXECUTE 'GRANT EXECUTE ON FUNCTION public.' || rpc || ' TO authenticated';
        EXCEPTION WHEN undefined_function THEN
            RAISE NOTICE 'Skipping undefined function: %', rpc;
        END;
    END LOOP;
END;
$$;

-- 4. Grant EXECUTE to RLS helpers (authenticated and service_role)
GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_tenant_operator_or_admin(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_tenant_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_tenant_role(uuid, app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated, service_role;

-- 5. Explicitly revoke execute_data_repair_v1 from everyone
REVOKE EXECUTE ON FUNCTION public.execute_data_repair_v1(uuid, uuid) FROM PUBLIC, authenticated, anon, service_role;

-- 6. Ensure service_role has access to all functions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
