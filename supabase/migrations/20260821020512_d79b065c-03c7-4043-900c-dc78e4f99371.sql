-- Canonical Baseline for Security and Logistics Consolidation
-- Consolidates GRANTS and stability fixes to resolve forward-references in clean resets.

-- 1. Global Revoke
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- 2. Logistics Consolidated Writers (V1)
-- Signature corrected based on migration 20260422203102
GRANT EXECUTE ON FUNCTION public.create_load_with_next_number(uuid, text, text, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_fiscal_documents_to_load(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_fiscal_documents_from_load(uuid, uuid, uuid[]) TO authenticated;

-- 3. Logistics Secured Writers (V3)
-- Signature: p_tenant_id uuid, p_idempotency_key text, p_driver_id uuid, p_vehicle_id uuid, p_route_name text, p_load_ids uuid[], p_stops jsonb
GRANT EXECUTE ON FUNCTION public.plan_dispatch_trip_v3(uuid, text, uuid, uuid, text, uuid[], jsonb) TO authenticated;

-- 4. HR Writers (Source of Truth)
GRANT EXECUTE ON FUNCTION public.create_employee_v1(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_employee_v1(uuid, uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_employee_v1(uuid, uuid) TO authenticated;

-- 5. Security Helpers
GRANT EXECUTE ON FUNCTION public.is_tenant_operator_or_admin(uuid) TO authenticated;

-- Final Cleanup: Ensure no PUBLIC execute remains on secured writers
REVOKE EXECUTE ON FUNCTION public.plan_dispatch_trip_v3(uuid, text, uuid, uuid, text, uuid[], jsonb) FROM PUBLIC;
