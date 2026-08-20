-- Logistics Refactoring: plan_dispatch_trip_v2 and RPC Consolidation

DO $$ 
BEGIN
    -- Ensure mirrors and relations exist
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'loads' AND column_name = 'trip_id') THEN
        ALTER TABLE public.loads ADD COLUMN trip_id uuid REFERENCES public.dispatch_trips(id);
    END IF;

    -- dispatch_trip_loads relation integrity
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'dispatch_trip_loads') THEN
        CREATE TABLE public.dispatch_trip_loads (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES public.tenants(id),
            dispatch_trip_id uuid NOT NULL REFERENCES public.dispatch_trips(id) ON DELETE CASCADE,
            load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
            created_at timestamptz DEFAULT now(),
            UNIQUE(dispatch_trip_id, load_id)
        );
        GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_trip_loads TO authenticated;
        GRANT ALL ON public.dispatch_trip_loads TO service_role;
        ALTER TABLE public.dispatch_trip_loads ENABLE ROW LEVEL SECURITY;
    END IF;
END $$;

-- 1. Refactored plan_dispatch_trip_v2
CREATE OR REPLACE FUNCTION public.plan_dispatch_trip_v2(
    p_tenant_id uuid,
    p_driver_id uuid,
    p_vehicle_id uuid,
    p_route_name text,
    p_load_ids uuid[],
    p_stops jsonb, -- Array of {destination, client_id, stop_order, document_ids[]}
    p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_trip_id uuid;
    v_stop record;
    v_stop_id uuid;
    v_doc_id uuid;
    v_load_id uuid;
BEGIN
    -- 0. Authorization
    IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    -- 1. Idempotency check (simple check for now if provided)
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_trip_id FROM public.dispatch_trips 
        WHERE tenant_id = p_tenant_id AND (metadata->>'idempotency_key') = p_idempotency_key;
        IF v_trip_id IS NOT NULL THEN RETURN v_trip_id; END IF;
    END IF;

    -- 2. Create Trip
    INSERT INTO public.dispatch_trips (
        tenant_id, driver_id, vehicle_id, route_name, status, planned_start_at, metadata
    ) VALUES (
        p_tenant_id, p_driver_id, p_vehicle_id, p_route_name, 'planned', now(), 
        jsonb_build_object('idempotency_key', p_idempotency_key)
    ) RETURNING id INTO v_trip_id;

    -- 3. Link Loads (dispatch_trip_loads SoT)
    FOREACH v_load_id IN ARRAY p_load_ids
    LOOP
        -- Validate ownership
        IF NOT EXISTS (SELECT 1 FROM public.loads WHERE id = v_load_id AND tenant_id = p_tenant_id) THEN
            RAISE EXCEPTION 'Carga % não pertence ao tenant', v_load_id;
        END IF;

        INSERT INTO public.dispatch_trip_loads (tenant_id, dispatch_trip_id, load_id)
        VALUES (p_tenant_id, v_trip_id, v_load_id);
        
        -- Update mirror
        UPDATE public.loads SET trip_id = v_trip_id WHERE id = v_load_id;
    END LOOP;

    -- 4. Create Stops and link Documents
    FOR v_stop IN SELECT * FROM jsonb_to_recordset(p_stops) AS x(destination text, client_id uuid, stop_order int, document_ids uuid[])
    LOOP
        INSERT INTO public.dispatch_stops (
            tenant_id, dispatch_trip_id, destination, client_id, stop_order, status
        ) VALUES (
            p_tenant_id, v_trip_id, v_stop.destination, v_stop.client_id, v_stop.stop_order, 'pending'
        ) RETURNING id INTO v_stop_id;

        IF v_stop.document_ids IS NOT NULL THEN
            FOREACH v_doc_id IN ARRAY v_stop.document_ids
            LOOP
                -- Validate doc ownership
                IF NOT EXISTS (SELECT 1 FROM public.fiscal_documents WHERE id = v_doc_id AND tenant_id = p_tenant_id) THEN
                    RAISE EXCEPTION 'Documento % não pertence ao tenant', v_doc_id;
                END IF;

                INSERT INTO public.dispatch_stop_documents (
                    tenant_id, dispatch_stop_id, fiscal_document_id
                ) VALUES (
                    p_tenant_id, v_stop_id, v_doc_id
                );
            END LOOP;
        END IF;
    END LOOP;

    -- Audit trail
    PERFORM public._log_entity_audit(p_tenant_id, 'trip', v_trip_id, 'plan_v2', NULL, p_stops, 'dispatch_rpc');

    RETURN v_trip_id;
END;
$$;

-- Grant EXECUTE nas novas RPCs
GRANT EXECUTE ON FUNCTION public.plan_dispatch_trip_v2(uuid, uuid, uuid, text, uuid[], jsonb, text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.plan_dispatch_trip_v2(uuid, uuid, uuid, text, uuid[], jsonb, text) FROM PUBLIC;
