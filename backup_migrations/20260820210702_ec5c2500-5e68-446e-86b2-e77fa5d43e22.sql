
-- Canonical Driver Workspace Read Model
CREATE OR REPLACE FUNCTION public.get_driver_workspace_v1(
    p_driver_id uuid,
    p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
    v_trip_record record;
    v_loads jsonb;
    v_stops jsonb;
    v_progress jsonb;
    v_next_action jsonb;
BEGIN
    -- 1. Identify active trip
    SELECT * INTO v_trip_record
    FROM public.dispatch_trips
    WHERE driver_id = p_driver_id
      AND tenant_id = p_tenant_id
      AND status NOT IN ('completed', 'cancelled')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_trip_record.id IS NULL THEN
        RETURN jsonb_build_object(
            'has_active_trip', false,
            'driver_id', p_driver_id
        );
    END IF;

    -- 2. Fetch loads via canonical mapping
    SELECT jsonb_agg(l.*) INTO v_loads
    FROM (
        SELECT 
            loads.id,
            loads.load_number,
            loads.status,
            loads.origin,
            loads.destination,
            loads.total_value,
            loads.total_weight
        FROM public.dispatch_trip_loads dtl
        JOIN public.loads ON loads.id = dtl.load_id
        WHERE dtl.trip_id = v_trip_record.id
    ) l;

    -- 3. Fetch stops and stop-level documents
    SELECT jsonb_agg(s.*) INTO v_stops
    FROM (
        SELECT 
            ds.id,
            ds.stop_order,
            ds.status,
            ds.stop_type,
            ds.location_name,
            ds.address,
            ds.arrival_time,
            ds.departure_time,
            (
                SELECT jsonb_agg(doc.*)
                FROM (
                    SELECT 
                        fd.id,
                        fd.number,
                        fd.series,
                        fd.total_value,
                        dsd.status as stop_status
                    FROM public.dispatch_stop_documents dsd
                    JOIN public.fiscal_documents fd ON fd.id = dsd.document_id
                    WHERE dsd.stop_id = ds.id
                ) doc
            ) as documents
        FROM public.dispatch_stops ds
        WHERE ds.trip_id = v_trip_record.id
        ORDER BY ds.stop_order ASC
    ) s;

    -- 4. Calculate progress
    SELECT jsonb_build_object(
        'total_stops', count(*),
        'completed_stops', count(*) FILTER (WHERE status = 'completed'),
        'pending_stops', count(*) FILTER (WHERE status IN ('pending', 'arrived', 'in_progress'))
    ) INTO v_progress
    FROM public.dispatch_stops
    WHERE trip_id = v_trip_record.id;

    -- 5. Determine next action
    SELECT jsonb_build_object(
        'stop_id', id,
        'stop_type', stop_type,
        'status', status,
        'location_name', location_name
    ) INTO v_next_action
    FROM public.dispatch_stops
    WHERE trip_id = v_trip_record.id
      AND status != 'completed'
    ORDER BY stop_order ASC
    LIMIT 1;

    RETURN jsonb_build_object(
        'has_active_trip', true,
        'trip', jsonb_build_object(
            'id', v_trip_record.id,
            'status', v_trip_record.status,
            'start_km', v_trip_record.start_km,
            'created_at', v_trip_record.created_at
        ),
        'loads', COALESCE(v_loads, '[]'::jsonb),
        'stops', COALESCE(v_stops, '[]'::jsonb),
        'progress', v_progress,
        'next_action', v_next_action
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_driver_workspace_v1(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_driver_workspace_v1(uuid, uuid) TO service_role;

-- Transactional Driver Event Reporting
CREATE OR REPLACE FUNCTION public.driver_report_event_v1(
    p_driver_id uuid,
    p_tenant_id uuid,
    p_trip_id uuid,
    p_stop_id uuid,
    p_event_type text, -- 'arrival', 'departure', 'delivery_complete', 'delivery_refusal', 'trip_start', 'trip_end'
    p_payload jsonb DEFAULT '{}'::jsonb,
    p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_event_id uuid;
BEGIN
    -- 1. Validate Ownership and Tenant
    IF NOT EXISTS (
        SELECT 1 FROM public.drivers 
        WHERE id = p_driver_id AND tenant_id = p_tenant_id AND user_id = v_user_id
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Driver mismatch';
    END IF;

    -- 2. Idempotency Check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_event_id 
        FROM public.dispatch_events 
        WHERE payload->>'idempotency_key' = p_idempotency_key
          AND tenant_id = p_tenant_id;
        
        IF v_event_id IS NOT NULL THEN
            RETURN jsonb_build_object('status', 'success', 'event_id', v_event_id, 'idempotent', true);
        END IF;
    END IF;

    -- 3. Log Event
    INSERT INTO public.dispatch_events (
        tenant_id,
        dispatch_trip_id,
        dispatch_stop_id,
        event_type,
        event_at,
        payload,
        created_by
    ) VALUES (
        p_tenant_id,
        p_trip_id,
        p_stop_id,
        p_event_type,
        now(),
        p_payload || jsonb_build_object('idempotency_key', p_idempotency_key),
        v_user_id
    ) RETURNING id INTO v_event_id;

    -- 4. State Transitions (Synchronous)
    IF p_event_type = 'trip_start' THEN
        UPDATE public.dispatch_trips 
        SET status = 'in_transit', 
            start_km = (p_payload->>'odometer')::numeric,
            started_at = now()
        WHERE id = p_trip_id AND tenant_id = p_tenant_id;
        
    ELSIF p_event_type = 'arrival' THEN
        UPDATE public.dispatch_stops 
        SET status = 'arrived', 
            arrival_time = now()
        WHERE id = p_stop_id AND trip_id = p_trip_id AND tenant_id = p_tenant_id;

    ELSIF p_event_type = 'departure' OR p_event_type = 'delivery_complete' THEN
        UPDATE public.dispatch_stops 
        SET status = 'completed', 
            departure_time = now()
        WHERE id = p_stop_id AND trip_id = p_trip_id AND tenant_id = p_tenant_id;

    ELSIF p_event_type = 'trip_end' THEN
        UPDATE public.dispatch_trips 
        SET status = 'completed', 
            end_km = (p_payload->>'odometer')::numeric,
            completed_at = now()
        WHERE id = p_trip_id AND tenant_id = p_tenant_id;
    END IF;

    RETURN jsonb_build_object('status', 'success', 'event_id', v_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.driver_report_event_v1(uuid, uuid, uuid, uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_report_event_v1(uuid, uuid, uuid, uuid, text, jsonb, text) TO service_role;
