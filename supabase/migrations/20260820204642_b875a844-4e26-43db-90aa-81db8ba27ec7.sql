-- 1. Create audit log for state transitions
CREATE TABLE IF NOT EXISTS public.entity_state_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    entity_type text NOT NULL, -- 'load', 'trip', 'stop', 'document'
    entity_id uuid NOT NULL,
    from_status text,
    to_status text NOT NULL,
    actor_id uuid REFERENCES auth.users(id),
    reason text,
    metadata jsonb DEFAULT '{}'::jsonb,
    idempotency_key text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_entity_state_audit_log_entity ON public.entity_state_audit_log(entity_type, entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_state_audit_idempotency ON public.entity_state_audit_log(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

GRANT SELECT, INSERT ON public.entity_state_audit_log TO authenticated;
ALTER TABLE public.entity_state_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation" ON public.entity_state_audit_log FOR ALL TO authenticated USING (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid);

-- 2. Aggregate Derivation Function (Needed by the transition function)
CREATE OR REPLACE FUNCTION public.derive_trip_and_load_status_v1(
    p_tenant_id uuid,
    p_trip_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_all_terminal boolean;
    v_any_started boolean;
    v_load_ids uuid[];
    v_load_id uuid;
BEGIN
    -- Derive Trip Status from Stops
    SELECT 
        bool_and(status IN ('completed', 'delivered', 'cancelled', 'skipped', 'refused', 'returned', 'partial_delivery', 'failed')),
        bool_or(status NOT IN ('planned', 'pending'))
    INTO v_all_terminal, v_any_started
    FROM public.dispatch_stops
    WHERE dispatch_trip_id = p_trip_id AND tenant_id = p_tenant_id;

    IF v_all_terminal THEN
        UPDATE public.dispatch_trips SET status = 'completed', actual_end_at = now() WHERE id = p_trip_id AND status != 'completed';
    ELSIF v_any_started THEN
        UPDATE public.dispatch_trips SET status = 'in_transit', actual_start_at = COALESCE(actual_start_at, now()) WHERE id = p_trip_id AND status = 'planned';
    END IF;

    -- Derive Load Status from Trip and its documents
    SELECT array_agg(load_id) INTO v_load_ids FROM public.dispatch_trip_loads WHERE dispatch_trip_id = p_trip_id;

    IF v_load_ids IS NOT NULL THEN
        FOREACH v_load_id IN ARRAY v_load_ids LOOP
            IF v_all_terminal THEN
                UPDATE public.loads SET status = 'delivered' WHERE id = v_load_id AND status != 'delivered';
            ELSIF v_any_started THEN
                UPDATE public.loads SET status = 'in_transit' WHERE id = v_load_id AND status = 'ready';
            END IF;
        END LOOP;
    END IF;
END;
$$;

-- 3. State Transition Function for Stops
CREATE OR REPLACE FUNCTION public.transition_stop_status_v1(
    p_tenant_id uuid,
    p_stop_id uuid,
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
    v_trip_id uuid;
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
    SELECT status, dispatch_trip_id INTO v_from_status, v_trip_id 
    FROM public.dispatch_stops 
    WHERE id = p_stop_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Parada não encontrada'; END IF;

    -- State Machine Logic
    CASE v_from_status
        WHEN 'planned' THEN v_allowed := p_to_status IN ('arriving', 'cancelled', 'skipped');
        WHEN 'arriving' THEN v_allowed := p_to_status IN ('arrived', 'skipped');
        WHEN 'arrived' THEN v_allowed := p_to_status IN ('servicing', 'skipped');
        WHEN 'servicing' THEN v_allowed := p_to_status IN ('departed', 'completed', 'delivered', 'refused', 'returned', 'partial_delivery', 'failed');
        WHEN 'departed' THEN v_allowed := p_to_status IN ('completed', 'delivered', 'refused', 'returned', 'partial_delivery', 'failed');
        ELSE v_allowed := false;
    END CASE;

    -- Drivers can only move forward, Admins can override
    IF NOT v_allowed AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin')) THEN
        RAISE EXCEPTION 'Transição de status inválida: % -> %', v_from_status, p_to_status;
    END IF;

    -- Update Stop
    UPDATE public.dispatch_stops 
    SET status = p_to_status, 
        updated_at = now(),
        actual_arrival_at = CASE WHEN p_to_status = 'arrived' THEN now() ELSE actual_arrival_at END,
        actual_departure_at = CASE WHEN p_to_status = 'departed' OR p_to_status IN ('completed', 'delivered', 'refused', 'returned', 'partial_delivery', 'failed') THEN now() ELSE actual_departure_at END
    WHERE id = p_stop_id AND tenant_id = p_tenant_id;

    -- Audit Log
    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, from_status, to_status, actor_id, reason, idempotency_key, metadata
    ) VALUES (
        p_tenant_id, 'stop', p_stop_id, v_from_status, p_to_status, p_actor_id, p_reason, p_idempotency_key, p_metadata
    );

    -- Trigger aggregate derivation
    PERFORM public.derive_trip_and_load_status_v1(p_tenant_id, v_trip_id);

    RETURN p_to_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.transition_stop_status_v1 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_stop_status_v1 TO authenticated;

-- 4. Consistency Audit Function v3
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
BEGIN
    -- Find loads with trip_id but no dispatch_trip_loads relation
    SELECT array_agg(id) INTO v_orphans
    FROM public.loads l
    WHERE tenant_id = p_tenant_id 
      AND trip_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM public.dispatch_trip_loads dtl WHERE dtl.load_id = l.id);
    
    v_report := v_report || jsonb_build_object('orphan_load_trips', COALESCE(v_orphans, '{}'::uuid[]));

    IF p_fix AND v_orphans IS NOT NULL THEN
        UPDATE public.loads SET trip_id = NULL WHERE id = ANY(v_orphans) AND tenant_id = p_tenant_id;
    END IF;

    RETURN v_report;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_data_consistency_v3 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_data_consistency_v3 TO authenticated;