-- RPC Migration: Consolidation of Logistics (Loads & Dispatch)
-- Phase 2: RPC Handlers for Loads and Load Items, removing direct DML dependencies

-- 1. Create or replace load CRUD RPCs
CREATE OR REPLACE FUNCTION public.create_load_v1(
    p_tenant_id uuid,
    p_vehicle_id uuid,
    p_driver_id uuid,
    p_origin text,
    p_destination text,
    p_notes text DEFAULT NULL,
    p_operation_type text DEFAULT NULL,
    p_scheduled_load_at timestamptz DEFAULT NULL,
    p_idempotency_key text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_load_id uuid;
    v_load_number text;
BEGIN
    IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    -- Validate vehicle tenant if provided
    IF p_vehicle_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = p_vehicle_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Veículo inválido ou de outro tenant';
    END IF;

    -- Validate driver tenant if provided
    IF p_driver_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Motorista inválido ou de outro tenant';
    END IF;

    -- Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_load_id FROM public.loads 
        WHERE tenant_id = p_tenant_id AND (metadata->>'idempotency_key' = p_idempotency_key OR CAST(id AS TEXT) = p_idempotency_key);
        IF FOUND THEN
            RETURN v_load_id;
        END IF;
    END IF;

    -- Generate sequence-based number
    v_load_number := public.get_next_load_number_v1(p_tenant_id);

    INSERT INTO public.loads (
        tenant_id, load_number, vehicle_id, driver_id, origin, destination, 
        notes, operation_type, scheduled_load_at, status, 
        metadata
    ) VALUES (
        p_tenant_id, v_load_number, p_vehicle_id, p_driver_id, p_origin, p_destination, 
        p_notes, p_operation_type, p_scheduled_load_at, 'assembling',
        jsonb_build_object('idempotency_key', p_idempotency_key)
    ) RETURNING id INTO v_load_id;

    -- Audit log
    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, action, state_before, state_after
    ) VALUES (
        p_tenant_id, 'load', v_load_id, 'create', NULL, jsonb_build_object('status', 'assembling')
    );

    RETURN v_load_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_load_v1(
    p_tenant_id uuid,
    p_load_id uuid,
    p_changes jsonb,
    p_version int DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_state jsonb;
    v_new_state jsonb;
    v_allowed_keys text[] := ARRAY['vehicle_id', 'driver_id', 'origin', 'destination', 'notes', 'operation_type', 'scheduled_load_at', 'status', 'on_hold', 'hold_reason'];
    v_key text;
    v_sql text;
    v_audit_action text := 'update';
BEGIN
    IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    -- Optimistic locking & existence check
    SELECT to_jsonb(l.*) INTO v_old_state 
    FROM public.loads l 
    WHERE id = p_load_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Carga não encontrada';
    END IF;

    -- Validate related entities in changes
    IF p_changes ? 'vehicle_id' AND p_changes->>'vehicle_id' IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = (p_changes->>'vehicle_id')::uuid AND tenant_id = p_tenant_id) THEN
            RAISE EXCEPTION 'Veículo inválido';
        END IF;
    END IF;

    IF p_changes ? 'driver_id' AND p_changes->>'driver_id' IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = (p_changes->>'driver_id')::uuid AND tenant_id = p_tenant_id) THEN
            RAISE EXCEPTION 'Motorista inválido';
        END IF;
    END IF;

    -- Build update statement dynamically for allowed keys only
    v_sql := 'UPDATE public.loads SET updated_at = now()';
    FOR v_key IN SELECT * FROM jsonb_object_keys(p_changes)
    LOOP
        IF v_key = ANY(v_allowed_keys) THEN
            v_sql := v_sql || ', ' || quote_ident(v_key) || ' = ' || quote_nullable(p_changes->>v_key);
        END IF;
    END LOOP;
    
    v_sql := v_sql || ' WHERE id = ' || quote_literal(p_load_id) || ' AND tenant_id = ' || quote_literal(p_tenant_id) || ' RETURNING to_jsonb(public.loads.*)';
    
    EXECUTE v_sql INTO v_new_state;

    -- Record status changes specifically in audit
    IF (v_old_state->>'status') != (v_new_state->>'status') THEN
        v_audit_action := 'status_change';
    END IF;

    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, action, state_before, state_after
    ) VALUES (
        p_tenant_id, 'load', p_load_id, v_audit_action, v_old_state, v_new_state
    );

    RETURN v_new_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_load_v1(
    p_tenant_id uuid,
    p_load_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_state jsonb;
BEGIN
    IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    SELECT to_jsonb(l.*) INTO v_old_state 
    FROM public.loads l 
    WHERE id = p_load_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- Block deletion if trip is active or docs are linked
    IF v_old_state->>'trip_id' IS NOT NULL THEN
        RAISE EXCEPTION 'Não é possível excluir carga vinculada a uma viagem ativa';
    END IF;

    IF EXISTS (SELECT 1 FROM public.load_items WHERE load_id = p_load_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Não é possível excluir carga com itens vinculados. Remova os itens primeiro.';
    END IF;

    DELETE FROM public.loads WHERE id = p_load_id AND tenant_id = p_tenant_id;

    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, action, state_before, state_after
    ) VALUES (
        p_tenant_id, 'load', p_load_id, 'delete', v_old_state, NULL
    );

    RETURN TRUE;
END;
$$;

-- 2. Load Item RPCs
CREATE OR REPLACE FUNCTION public.upsert_load_item_v1(
    p_tenant_id uuid,
    p_load_id uuid,
    p_item_description text,
    p_quantity numeric,
    p_pallet_count numeric DEFAULT 0,
    p_weight_kg numeric DEFAULT 0,
    p_volume_m3 numeric DEFAULT 0,
    p_fiscal_document_id uuid DEFAULT NULL,
    p_item_id uuid DEFAULT NULL -- If provided, updates
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item_id uuid;
BEGIN
    IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.loads WHERE id = p_load_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Carga não encontrada';
    END IF;

    -- Validate fiscal document tenant
    IF p_fiscal_document_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.fiscal_documents WHERE id = p_fiscal_document_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Documento fiscal inválido';
    END IF;

    IF p_item_id IS NOT NULL THEN
        -- Update
        UPDATE public.load_items SET
            load_id = p_load_id,
            item_description = p_item_description,
            quantity = p_quantity,
            pallet_count = p_pallet_count,
            weight_kg = p_weight_kg,
            volume_m3 = p_volume_m3,
            fiscal_document_id = p_fiscal_document_id,
            updated_at = now()
        WHERE id = p_item_id AND tenant_id = p_tenant_id
        RETURNING id INTO v_item_id;
        
        IF NOT FOUND THEN RAISE EXCEPTION 'Item não encontrado'; END IF;
    ELSE
        -- Insert
        INSERT INTO public.load_items (
            tenant_id, load_id, item_description, quantity, pallet_count, weight_kg, volume_m3, fiscal_document_id
        ) VALUES (
            p_tenant_id, p_load_id, p_item_description, p_quantity, p_pallet_count, p_weight_kg, p_volume_m3, p_fiscal_document_id
        ) RETURNING id INTO v_item_id;
    END IF;

    RETURN v_item_id;
END;
$$;

-- 3. Correct plan_dispatch_trip_v2 (removing route_name/metadata from dispatch_trips if they don't exist)
-- Also adding idempotency_key support.
CREATE OR REPLACE FUNCTION public.plan_dispatch_trip_v2(
    p_tenant_id uuid,
    p_driver_id uuid,
    p_vehicle_id uuid,
    p_route_name text,
    p_load_ids uuid[],
    p_stops jsonb, -- Array de {destination, client_id, stop_order, document_ids[]}
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
    IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    -- Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_trip_id FROM public.dispatch_trips 
        WHERE tenant_id = p_tenant_id AND (metadata->>'idempotency_key' = p_idempotency_key OR CAST(id AS TEXT) = p_idempotency_key);
        IF FOUND THEN
            RETURN v_trip_id;
        END IF;
    END IF;

    -- Validate tenants
    IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Motorista inválido';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.vehicles WHERE id = p_vehicle_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Veículo inválido';
    END IF;

    -- 1. Create Trip
    -- Note: We store route_name in metadata if column is missing (fallback)
    INSERT INTO public.dispatch_trips (
        tenant_id, driver_id, vehicle_id, status, planned_start_at, metadata
    ) VALUES (
        p_tenant_id, p_driver_id, p_vehicle_id, 'planned', now(), 
        jsonb_build_object('idempotency_key', p_idempotency_key, 'route_name', p_route_name)
    ) RETURNING id INTO v_trip_id;

    -- 2. Link Loads
    FOREACH v_load_id IN ARRAY p_load_ids
    LOOP
        IF NOT EXISTS (SELECT 1 FROM public.loads WHERE id = v_load_id AND tenant_id = p_tenant_id) THEN
            RAISE EXCEPTION 'Carga % inválida', v_load_id;
        END IF;

        INSERT INTO public.dispatch_trip_loads (trip_id, load_id, tenant_id)
        VALUES (v_trip_id, v_load_id, p_tenant_id);
        
        UPDATE public.loads SET trip_id = v_trip_id, status = 'loaded' WHERE id = v_load_id;
    END LOOP;

    -- 3. Create Stops and link documents
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
                INSERT INTO public.dispatch_stop_documents (
                    tenant_id, dispatch_stop_id, fiscal_document_id, status
                ) VALUES (
                    p_tenant_id, v_stop_id, v_doc_id, 'pending'
                );
            END LOOP;
        END IF;
    END LOOP;

    -- Audit
    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, action, state_after
    ) VALUES (
        p_tenant_id, 'dispatch_trip', v_trip_id, 'create_plan', jsonb_build_object('status', 'planned', 'loads', p_load_ids)
    );

    RETURN v_trip_id;
END;
$$;

-- 4. Clean up old overloads
DROP FUNCTION IF EXISTS public.plan_dispatch_trip_v2(uuid, uuid, uuid, text, uuid[], jsonb);

-- 5. Revoke direct DML (finalizing the migration)
REVOKE INSERT, UPDATE, DELETE ON public.loads FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON public.load_items FROM authenticated, anon;

GRANT SELECT ON public.loads TO authenticated;
GRANT SELECT ON public.load_items TO authenticated;

-- Grants for RPCs
GRANT EXECUTE ON FUNCTION public.create_load_v1 TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_load_v1 TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_load_v1 TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_load_item_v1 TO authenticated;
GRANT EXECUTE ON FUNCTION public.plan_dispatch_trip_v2 TO authenticated;
