-- Canonical Baseline 2026-08-21
-- Purpose: Initialize clean database state with verified function signatures and ownership.

-- 1. Security Hardening Core
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- 2. Logistics Core (Source of Truth)
GRANT EXECUTE ON FUNCTION public.create_load_v1(uuid, uuid, uuid, text, text, text, text, timestamptz, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_load_v1(uuid, uuid, uuid, text, text, text, text, timestamptz, text) FROM anon;

GRANT EXECUTE ON FUNCTION public.upsert_load_item_v1(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.upsert_load_item_v1(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.plan_dispatch_trip_v2(uuid, uuid, uuid, uuid[], timestamptz, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.plan_dispatch_trip_v2(uuid, uuid, uuid, uuid[], timestamptz, text) FROM anon;

-- 3. HR Core (Source of Truth)
GRANT EXECUTE ON FUNCTION public.create_employee_v1(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_employee_v1(uuid, uuid, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_employee_v1(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_employee_v1(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.update_employee_v1(uuid, uuid, jsonb, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_employee_v1(uuid, uuid) FROM anon;

-- 4. Legacy/Compatibility Access
GRANT EXECUTE ON FUNCTION public.get_user_client_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_tenant_with_owner(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_resource_ownership(uuid, uuid, text) TO authenticated;
