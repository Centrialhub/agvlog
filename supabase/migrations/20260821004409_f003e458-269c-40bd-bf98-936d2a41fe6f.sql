-- Security Hardening with Real Signatures

-- 1. Global revokes
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- 2. Grant real signatures to authenticated role
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
  IF to_regprocedure('public.upsert_load_item_v1(uuid, uuid, text, numeric, numeric, numeric, numeric, uuid, uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.upsert_load_item_v1(uuid, uuid, text, numeric, numeric, numeric, numeric, uuid, uuid) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.delete_load_v1(uuid, uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.delete_load_v1(uuid, uuid) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.get_user_client_access(uuid)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_user_client_access(uuid) TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.create_tenant_with_owner(text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_tenant_with_owner(text) TO authenticated';
  END IF;
END $cond$;

-- 3. Explicitly ensure anon is revoked from these real signatures
DO $cond$ BEGIN
  IF to_regprocedure('public.create_employee_v1(uuid, jsonb)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.create_employee_v1(uuid, jsonb) FROM anon';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.update_employee_v1(uuid, uuid, jsonb, integer)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.update_employee_v1(uuid, uuid, jsonb, integer) FROM anon';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.delete_employee_v1(uuid, uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.delete_employee_v1(uuid, uuid) FROM anon';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.create_load_v1(uuid, uuid, uuid, text, text, text, text, timestamptz, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.create_load_v1(uuid, uuid, uuid, text, text, text, text, timestamptz, text) FROM anon';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.update_load_v1(uuid, uuid, jsonb, integer)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.update_load_v1(uuid, uuid, jsonb, integer) FROM anon';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.upsert_load_item_v1(uuid, uuid, text, numeric, numeric, numeric, numeric, uuid, uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.upsert_load_item_v1(uuid, uuid, text, numeric, numeric, numeric, numeric, uuid, uuid) FROM anon';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.delete_load_v1(uuid, uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.delete_load_v1(uuid, uuid) FROM anon';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.get_user_client_access(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_user_client_access(uuid) FROM anon';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.create_tenant_with_owner(text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.create_tenant_with_owner(text) FROM anon';
  END IF;
END $cond$;
