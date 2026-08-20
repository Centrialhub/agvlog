-- 1. State Transition Function for Trips
CREATE OR REPLACE FUNCTION public.transition_trip_status_v1(
    p_tenant_id uuid,
    p_trip_id uuid,
    p_to_status text,
    p_actor_id uuid,
    p_reason text DEFAULT NULL,
    p_idempotency_key text DEFAULT NULL,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_from_status text;
    v_allowed boolean := false;
BEGIN
    -- Authorization check
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'operator', 'driver')) THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    -- Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT to_status INTO v_from_status FROM public.entity_state_audit_log 
        WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
        IF FOUND THEN RETURN v_from_status; END IF;
    END IF;

    -- Get current state
    SELECT status INTO v_from_status
    FROM public.dispatch_trips 
    WHERE id = p_trip_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Viagem não encontrada'; END IF;

    -- State Machine Logic
    CASE v_from_status
        WHEN 'planned' THEN v_allowed := p_to_status IN ('loading', 'in_transit', 'cancelled');
        WHEN 'loading' THEN v_allowed := p_to_status IN ('in_transit', 'cancelled');
        WHEN 'in_transit' THEN v_allowed := p_to_status IN ('completed', 'cancelled');
        ELSE v_allowed := false;
    END CASE;

    -- Override for Admins
    IF NOT v_allowed AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin')) THEN
        RAISE EXCEPTION 'Transição de status inválida: % -> %', v_from_status, p_to_status;
    END IF;

    -- Update Trip
    UPDATE public.dispatch_trips 
    SET status = p_to_status, 
        updated_at = now(),
        actual_start_at = CASE WHEN p_to_status = 'in_transit' THEN COALESCE(actual_start_at, now()) ELSE actual_start_at END,
        actual_end_at = CASE WHEN p_to_status = 'completed' THEN now() ELSE actual_end_at END
    WHERE id = p_trip_id AND tenant_id = p_tenant_id;

    -- Audit Log
    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, from_status, to_status, actor_id, reason, idempotency_key, metadata
    ) VALUES (
        p_tenant_id, 'trip', p_trip_id, v_from_status, p_to_status, p_actor_id, p_reason, p_idempotency_key, p_metadata
    );

    RETURN p_to_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transition_trip_status_v1 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_trip_status_v1 TO authenticated;

-- 2. Consistency Audit v3 Additions (Impossible transitions and duplicates)
CREATE OR REPLACE FUNCTION public.audit_data_consistency_v3(
    p_tenant_id uuid,
    p_fix boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_report jsonb := '{}'::jsonb;
    v_orphans uuid[];
    v_stuck_trips jsonb[];
BEGIN
    -- orphan_load_trips
    SELECT array_agg(id) INTO v_orphans
    FROM public.loads l
    WHERE tenant_id = p_tenant_id 
      AND trip_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM public.dispatch_trip_loads dtl WHERE dtl.load_id = l.id);
    
    v_report := v_report || jsonb_build_object('orphan_load_trips', COALESCE(v_orphans, '{}'::uuid[]));

    -- Impossible transitions: Trips in 'completed' but with active stops
    SELECT array_agg(jsonb_build_object('trip_id', dt.id, 'active_stops', (SELECT count(*) FROM public.dispatch_stops ds WHERE ds.dispatch_trip_id = dt.id AND ds.status NOT IN ('completed', 'delivered', 'cancelled', 'skipped', 'refused', 'returned', 'partial_delivery', 'failed'))))
    INTO v_stuck_trips
    FROM public.dispatch_trips dt
    WHERE dt.tenant_id = p_tenant_id AND dt.status = 'completed'
      AND EXISTS (SELECT 1 FROM public.dispatch_stops ds WHERE ds.dispatch_trip_id = dt.id AND ds.status NOT IN ('completed', 'delivered', 'cancelled', 'skipped', 'refused', 'returned', 'partial_delivery', 'failed'));

    v_report := v_report || jsonb_build_object('stuck_completed_trips', COALESCE(v_stuck_trips, ARRAY[]::jsonb[]));

    IF p_fix THEN
        IF v_orphans IS NOT NULL THEN
            UPDATE public.loads SET trip_id = NULL WHERE id = ANY(v_orphans) AND tenant_id = p_tenant_id;
        END IF;
        -- Repair stuck trips: complete stops
        UPDATE public.dispatch_stops ds
        SET status = 'completed', updated_at = now()
        FROM public.dispatch_trips dt
        WHERE ds.dispatch_trip_id = dt.id 
          AND dt.status = 'completed'
          AND ds.status NOT IN ('completed', 'delivered', 'cancelled', 'skipped', 'refused', 'returned', 'partial_delivery', 'failed')
          AND dt.tenant_id = p_tenant_id;
    END IF;

    RETURN v_report;
END;
$$;
