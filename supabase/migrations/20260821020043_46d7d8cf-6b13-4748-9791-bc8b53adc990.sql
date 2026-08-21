-- Migration: Create plan_dispatch_trip_v3 with strict safety and idempotency
-- Forward-only: No changes to historical migrations

CREATE OR REPLACE FUNCTION public.plan_dispatch_trip_v3(
    p_tenant_id uuid,
    p_idempotency_key text,
    p_driver_id uuid,
    p_vehicle_id uuid,
    p_route_name text,
    p_load_ids uuid[],
    p_stops jsonb -- Array of { destination, client_id, stop_order, fiscal_document_ids: uuid[] }
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
    v_trip_id uuid;
    v_stop record;
    v_stop_id uuid;
    v_doc_id uuid;
    v_load_id uuid;
    v_found_count int;
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

    -- 2. Idempotency Check
    v_payload_hash := md5(jsonb_build_object(
        'driver_id', p_driver_id,
        'vehicle_id', p_vehicle_id,
        'route_name', p_route_name,
        'load_ids', p_load_ids,
        'stops', p_stops
    )::text);

    SELECT result_id INTO v_existing_result_id
    FROM public.idempotency_keys
    WHERE tenant_id = p_tenant_id 
      AND operation = 'plan_dispatch_trip'
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF EXISTS (
            SELECT 1 FROM public.idempotency_keys
            WHERE tenant_id = p_tenant_id 
              AND operation = 'plan_dispatch_trip'
              AND idempotency_key = p_idempotency_key
              AND payload_hash = v_payload_hash
        ) THEN
            RETURN v_existing_result_id;
        ELSE
            RAISE EXCEPTION 'Idempotency key mismatch: Same key used with different payload';
        END IF;
    END IF;

    -- 3. Locking & Validation
    -- Lock loads and check ownership/quantity
    SELECT count(*) INTO v_found_count
    FROM public.loads
    WHERE id = ANY(p_load_ids) 
      AND tenant_id = p_tenant_id
    FOR UPDATE;

    IF v_found_count != array_length(p_load_ids, 1) THEN
        RAISE EXCEPTION 'Ownership mismatch: One or more loads not found or belong to another tenant';
    END IF;

    -- Validate Vehicle & Driver
    IF NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = p_vehicle_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Invalid vehicle for tenant';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Invalid driver for tenant';
    END IF;

    -- 4. Create Trip
    INSERT INTO public.dispatch_trips (
        tenant_id, driver_id, vehicle_id, route_name, status, planned_start_at
    ) VALUES (
        p_tenant_id, p_driver_id, p_vehicle_id, p_route_name, 'planned', now()
    ) RETURNING id INTO v_trip_id;

    -- 5. Link Cargas (dispatch_trip_loads)
    FOREACH v_load_id IN ARRAY p_load_ids
    LOOP
        INSERT INTO public.dispatch_trip_loads (tenant_id, dispatch_trip_id, load_id)
        VALUES (p_tenant_id, v_trip_id, v_load_id);
        
        -- Update load status and link
        UPDATE public.loads 
        SET status = 'ready', 
            trip_id = v_trip_id,
            updated_at = now()
        WHERE id = v_load_id AND tenant_id = p_tenant_id;
    END LOOP;

    -- 6. Create Paradas e Vincular Documentos
    FOR v_stop IN SELECT * FROM jsonb_to_recordset(p_stops) AS x(destination text, client_id uuid, stop_order int, fiscal_document_ids uuid[])
    LOOP
        -- Stop ownership check (client_id)
        IF v_stop.client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.clients WHERE id = v_stop.client_id AND tenant_id = p_tenant_id) THEN
            RAISE EXCEPTION 'Invalid client for tenant at stop %', v_stop.stop_order;
        END IF;

        INSERT INTO public.dispatch_stops (
            tenant_id, dispatch_trip_id, destination, client_id, stop_order, status
        ) VALUES (
            p_tenant_id, v_trip_id, v_stop.destination, v_stop.client_id, v_stop.stop_order, 'pending'
        ) RETURNING id INTO v_stop_id;

        IF v_stop.fiscal_document_ids IS NOT NULL THEN
            FOREACH v_doc_id IN ARRAY v_stop.fiscal_document_ids
            LOOP
                -- Document ownership check
                IF NOT EXISTS (SELECT 1 FROM public.fiscal_documents WHERE id = v_doc_id AND tenant_id = p_tenant_id) THEN
                    RAISE EXCEPTION 'Invalid document for tenant at stop %', v_stop.stop_order;
                END IF;

                INSERT INTO public.dispatch_stop_documents (
                    tenant_id, dispatch_stop_id, fiscal_document_id, status
                ) VALUES (
                    p_tenant_id, v_stop_id, v_doc_id, 'pending'
                );
            END LOOP;
        END IF;
    END LOOP;

    -- 7. Record Idempotency
    INSERT INTO public.idempotency_keys (
        tenant_id, operation, idempotency_key, payload_hash, result_id
    ) VALUES (
        p_tenant_id, 'plan_dispatch_trip', p_idempotency_key, v_payload_hash, v_trip_id
    );

    -- 8. Audit Log
    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, to_status, idempotency_key
    ) VALUES (
        p_tenant_id, 'trip', v_trip_id, 'planned', p_idempotency_key
    );

    RETURN v_trip_id;
END;
$$;

-- Revoke all execute on v2 overloads from PUBLIC and anon (explicit signatures)
-- Signature 1: p_tenant_id uuid, p_vehicle_id uuid, p_driver_id uuid, p_load_ids uuid[], p_scheduled_start timestamp with time zone, p_idempotency_key text
DO $cond$ BEGIN
  IF to_regprocedure('public.plan_dispatch_trip_v2(uuid, uuid, uuid, uuid[], timestamptz, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.plan_dispatch_trip_v2(uuid, uuid, uuid, uuid[], timestamptz, text) FROM PUBLIC';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.plan_dispatch_trip_v2(uuid, uuid, uuid, uuid[], timestamptz, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.plan_dispatch_trip_v2(uuid, uuid, uuid, uuid[], timestamptz, text) FROM anon';
  END IF;
END $cond$;

-- Signature 2: p_tenant_id uuid, p_driver_id uuid, p_vehicle_id uuid, p_route_name text, p_load_ids uuid[], p_stops jsonb, p_idempotency_key text
DO $cond$ BEGIN
  IF to_regprocedure('public.plan_dispatch_trip_v2(uuid, uuid, uuid, text, uuid[], jsonb, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.plan_dispatch_trip_v2(uuid, uuid, uuid, text, uuid[], jsonb, text) FROM PUBLIC';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.plan_dispatch_trip_v2(uuid, uuid, uuid, text, uuid[], jsonb, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.plan_dispatch_trip_v2(uuid, uuid, uuid, text, uuid[], jsonb, text) FROM anon';
  END IF;
END $cond$;

-- Grant execute on v3
DO $cond$ BEGIN
  IF to_regprocedure('public.plan_dispatch_trip_v3') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.plan_dispatch_trip_v3 TO authenticated';
  END IF;
END $cond$;
DO $cond$ BEGIN
  IF to_regprocedure('public.plan_dispatch_trip_v3') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.plan_dispatch_trip_v3 TO service_role';
  END IF;
END $cond$;