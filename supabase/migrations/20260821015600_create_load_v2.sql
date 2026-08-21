-- Migration: Create create_load_v2 with strict safety and idempotency
-- Forward-only: No changes to historical migrations

-- Ensure idempotency table exists (if not created by previous steps)
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    operation text NOT NULL,
    idempotency_key text NOT NULL,
    payload_hash text NOT NULL,
    result_id uuid,
    created_at timestamptz DEFAULT now(),
    UNIQUE (tenant_id, operation, idempotency_key)
);

GRANT SELECT, INSERT ON public.idempotency_keys TO authenticated;
GRANT ALL ON public.idempotency_keys TO service_role;

CREATE OR REPLACE FUNCTION public.create_load_v2(
    p_tenant_id uuid,
    p_idempotency_key text,
    p_vehicle_id uuid DEFAULT NULL,
    p_driver_id uuid DEFAULT NULL,
    p_origin text DEFAULT NULL,
    p_destination text DEFAULT NULL,
    p_notes text DEFAULT NULL,
    p_operation_type text DEFAULT NULL,
    p_scheduled_load_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_operator_id uuid := auth.uid();
    v_payload_hash text;
    v_existing_result_id uuid;
    v_new_load_id uuid;
    v_next_number text;
    v_lock_key bigint;
BEGIN
    -- 1. Authorization: Require operator/admin linked to tenant
    IF NOT EXISTS (
        SELECT 1 FROM public.tenant_memberships
        WHERE user_id = v_operator_id 
          AND tenant_id = p_tenant_id
          AND role IN ('owner', 'admin', 'operator')
    ) THEN
        RAISE EXCEPTION 'Unauthorized: User is not an operator for this tenant';
    END IF;

    -- 2. Validation: Vehicle and Driver must belong to the same tenant (if provided)
    IF p_vehicle_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.vehicles WHERE id = p_vehicle_id AND tenant_id = p_tenant_id
    ) THEN
        RAISE EXCEPTION 'Invalid vehicle for tenant';
    END IF;

    IF p_driver_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.drivers WHERE id = p_driver_id AND tenant_id = p_tenant_id
    ) THEN
        RAISE EXCEPTION 'Invalid driver for tenant';
    END IF;

    -- 3. Idempotency Check
    v_payload_hash := md5(jsonb_build_object(
        'vehicle_id', p_vehicle_id,
        'driver_id', p_driver_id,
        'origin', p_origin,
        'destination', p_destination,
        'notes', p_notes,
        'operation_type', p_operation_type,
        'scheduled_load_at', p_scheduled_load_at
    )::text);

    SELECT result_id INTO v_existing_result_id
    FROM public.idempotency_keys
    WHERE tenant_id = p_tenant_id 
      AND operation = 'create_load'
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        -- Check if payload hash matches
        IF EXISTS (
            SELECT 1 FROM public.idempotency_keys
            WHERE tenant_id = p_tenant_id 
              AND operation = 'create_load'
              AND idempotency_key = p_idempotency_key
              AND payload_hash = v_payload_hash
        ) THEN
            RETURN v_existing_result_id;
        ELSE
            RAISE EXCEPTION 'Idempotency key mismatch: Same key used with different payload';
        END IF;
    END IF;

    -- 4. Advisory Lock by Tenant
    -- Use hash of tenant_id for the lock key
    v_lock_key := ('x' || substr(md5(p_tenant_id::text), 1, 16))::bit(64)::bigint;
    PERFORM pg_advisory_xact_lock(v_lock_key);

    -- 5. Generate load_number (legacy compatible, non-MAX(int))
    -- Pattern: Current max sequence + 1, ensuring non-numeric support
    WITH last_number AS (
        SELECT load_number 
        FROM public.loads 
        WHERE tenant_id = p_tenant_id
        ORDER BY created_at DESC, id DESC
        LIMIT 1
    )
    SELECT 
        COALESCE(
            (regexp_match(load_number, '([0-9]+)$'))[1]::bigint + 1,
            1001
        )::text
    INTO v_next_number
    FROM last_number;
    
    IF v_next_number IS NULL THEN
        v_next_number := '1001';
    END IF;

    -- 6. Insert Load
    INSERT INTO public.loads (
        tenant_id,
        load_number,
        vehicle_id,
        driver_id,
        origin,
        destination,
        notes,
        operation_type,
        scheduled_load_at,
        status
    ) VALUES (
        p_tenant_id,
        v_next_number,
        p_vehicle_id,
        p_driver_id,
        p_origin,
        p_destination,
        p_notes,
        p_operation_type,
        p_scheduled_load_at,
        'planned'
    ) RETURNING id INTO v_new_load_id;

    -- 7. Record Idempotency
    INSERT INTO public.idempotency_keys (
        tenant_id,
        operation,
        idempotency_key,
        payload_hash,
        result_id
    ) VALUES (
        p_tenant_id,
        'create_load',
        p_idempotency_key,
        v_payload_hash,
        v_new_load_id
    );

    RETURN v_new_load_id;
END;
$$;

-- Revoke direct DML from loads
REVOKE INSERT, UPDATE, DELETE ON public.loads FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.loads FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.loads FROM authenticated;

-- Grant execute to authenticated (RLS and membership check inside)
GRANT EXECUTE ON FUNCTION public.create_load_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_load_v2 TO service_role;

