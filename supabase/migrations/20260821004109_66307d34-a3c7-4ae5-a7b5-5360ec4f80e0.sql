-- Neutralizing remaining overloads of execute_data_repair_v1

CREATE OR REPLACE FUNCTION public.execute_data_repair_v1(
    p_tenant_id uuid,
    p_batch_id uuid,
    p_dry_run boolean DEFAULT true
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

-- Revoke execution from all roles for all signatures
REVOKE EXECUTE ON FUNCTION public.execute_data_repair_v1(uuid, uuid, boolean) FROM PUBLIC, authenticated, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.execute_data_repair_v1(uuid, uuid) FROM PUBLIC, authenticated, anon, service_role;
