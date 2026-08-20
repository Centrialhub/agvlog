DROP FUNCTION IF EXISTS public.plan_dispatch_start_trip_v1(UUID, UUID, UUID, UUID[], JSONB, BOOLEAN);

CREATE OR REPLACE FUNCTION public.plan_dispatch_start_trip_v1(
    p_tenant_id UUID,
    p_driver_id UUID,
    p_vehicle_id UUID,
    p_load_ids UUID[],
    p_stops JSONB, -- Array de {destination, client_id, stop_order, document_ids[], latitude, longitude, planned_arrival_at, notes}
    p_planned_start_at TIMESTAMPTZ DEFAULT NOW(),
    p_route_name TEXT DEFAULT NULL,
    p_start_now BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
    v_trip_id UUID;
    v_stop_id UUID;
    v_stop RECORD;
    v_doc_id UUID;
    v_load_id UUID;
BEGIN
    -- Validação de Tenant
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'tenant_id is required';
    END IF;

    -- 1. Cria a Viagem
    INSERT INTO public.dispatch_trips (
        tenant_id,
        driver_id,
        vehicle_id,
        status,
        planned_start_at,
        actual_start_at,
        notes,
        created_by
    ) VALUES (
        p_tenant_id,
        p_driver_id,
        p_vehicle_id,
        CASE WHEN p_start_now THEN 'in_transit' ELSE 'planned' END,
        p_planned_start_at,
        CASE WHEN p_start_now THEN now() ELSE NULL END,
        p_route_name,
        auth.uid()
    ) RETURNING id INTO v_trip_id;

    -- 2. Vincula Cargas (Relação Canônica)
    FOREACH v_load_id IN ARRAY p_load_ids LOOP
        INSERT INTO public.dispatch_trip_loads (tenant_id, dispatch_trip_id, load_id)
        VALUES (p_tenant_id, v_trip_id, v_load_id);
        
        -- Atualiza status da carga
        UPDATE public.loads 
        SET status = CASE WHEN p_start_now THEN 'in_transit' ELSE 'dispatched' END,
            updated_at = now()
        WHERE id = v_load_id;
    END LOOP;

    -- 3. Cria Paradas e Vincula Documentos
    FOR v_stop IN SELECT * FROM jsonb_to_recordset(p_stops) AS x(
        destination TEXT, 
        client_id UUID, 
        stop_order INT, 
        document_ids UUID[],
        latitude NUMERIC,
        longitude NUMERIC,
        planned_arrival_at TIMESTAMPTZ,
        notes TEXT
    ) LOOP
        INSERT INTO public.dispatch_stops (
            tenant_id, 
            dispatch_trip_id, 
            destination, 
            client_id, 
            stop_order, 
            status,
            latitude,
            longitude,
            planned_arrival_at,
            notes
        ) VALUES (
            p_tenant_id, 
            v_trip_id, 
            v_stop.destination, 
            v_stop.client_id, 
            v_stop.stop_order,
            'pending',
            v_stop.latitude,
            v_stop.longitude,
            COALESCE(v_stop.planned_arrival_at, now()),
            v_stop.notes
        ) RETURNING id INTO v_stop_id;

        -- Vincula documentos à parada (relação canônica)
        IF v_stop.document_ids IS NOT NULL THEN
            FOREACH v_doc_id IN ARRAY v_stop.document_ids LOOP
                INSERT INTO public.dispatch_stop_documents (
                    tenant_id, 
                    dispatch_stop_id, 
                    fiscal_document_id,
                    load_id
                )
                SELECT p_tenant_id, v_stop_id, v_doc_id, load_id
                FROM public.fiscal_documents
                WHERE id = v_doc_id;
            END LOOP;
        END IF;
    END LOOP;

    RETURN v_trip_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.plan_dispatch_start_trip_v1 TO authenticated;