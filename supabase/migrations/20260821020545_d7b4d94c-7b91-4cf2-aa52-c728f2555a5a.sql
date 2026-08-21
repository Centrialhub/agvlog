-- Final Canonical Baseline for CI compliance
-- Resolves all forward-references detected in the 21/08 stabilization window.

-- 1. Security Helpers
DO $cond$ BEGIN
  IF to_regprocedure('public.is_tenant_member(uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_tenant_member(uuid) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.is_tenant_admin(uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_tenant_admin(uuid) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.is_tenant_operator_or_admin(uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_tenant_operator_or_admin(uuid) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.has_tenant_role(uuid, app_role)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.has_tenant_role(uuid, app_role) TO authenticated';
  END IF;
END $cond$;

-- 2. Data Repair & Quality
DO $cond$ BEGIN
  IF to_regprocedure('public.execute_data_repair_v1(uuid, uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.execute_data_repair_v1(uuid, uuid) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.audit_data_consistency_v4(uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.audit_data_consistency_v4(uuid) TO authenticated';
  END IF;
END $cond$;

-- 3. Logistics Listing & Ops
DO $cond$ BEGIN
  IF to_regprocedure('public.list_loads_v1(uuid, text, text[], timestamptz, int)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.list_loads_v1(uuid, text, text[], timestamptz, int) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.list_employees_v1(uuid, text, text, int, int)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.list_employees_v1(uuid, text, text, int, int) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.normalize_vehicle_plate(text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.normalize_vehicle_plate(text) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.normalize_tax_id(text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.normalize_tax_id(text) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.normalize_fiscal_number(text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.normalize_fiscal_number(text) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.recalculate_load_totals(uuid, uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.recalculate_load_totals(uuid, uuid) TO authenticated';
  END IF;
END $cond$;

-- 4. HR & Logistics Writers (Safety Overlays)
DO $cond$ BEGIN
  IF to_regprocedure('public.create_employee_v1(uuid, jsonb)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_employee_v1(uuid, jsonb) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.update_employee_v1(uuid, uuid, jsonb, integer)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_employee_v1(uuid, uuid, jsonb, integer) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.delete_employee_v1(uuid, uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.delete_employee_v1(uuid, uuid) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.create_load_v1(uuid, uuid, uuid, text, text, text, text, timestamptz, text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_load_v1(uuid, uuid, uuid, text, text, text, text, timestamptz, text) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.update_load_v1(uuid, uuid, jsonb, integer)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_load_v1(uuid, uuid, jsonb, integer) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.upsert_load_item_v1(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.upsert_load_item_v1(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, uuid) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.delete_load_v1(uuid, uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.delete_load_v1(uuid, uuid) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.delete_load_item_v1(uuid, uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.delete_load_item_v1(uuid, uuid) TO authenticated';
  END IF;
END $cond$;

-- 5. Dispatch
DO $cond$ BEGIN
  IF to_regprocedure('public.plan_dispatch_trip_v2(uuid, uuid, uuid, uuid[], timestamptz, text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.plan_dispatch_trip_v2(uuid, uuid, uuid, uuid[], timestamptz, text) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.plan_dispatch_trip_v3(uuid, text, uuid, uuid, text, uuid[], jsonb)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.plan_dispatch_trip_v3(uuid, text, uuid, uuid, text, uuid[], jsonb) TO authenticated';
  END IF;
END $cond$;
