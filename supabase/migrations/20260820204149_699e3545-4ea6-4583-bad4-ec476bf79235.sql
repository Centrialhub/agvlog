-- Consolidação do Núcleo Operacional (dispatch_trip_loads, dispatch_stop_documents, dispatch_stops)

-- 1. Triggers para manter espelhos loads.trip_id e dispatch_trips.load_id
CREATE OR REPLACE FUNCTION public.sync_trip_load_mirrors()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        -- Atualiza espelho na loads (apenas se for o primeiro link ou principal)
        UPDATE public.loads 
        SET trip_id = NEW.dispatch_trip_id, 
            updated_at = now() 
        WHERE id = NEW.load_id AND (trip_id IS NULL OR trip_id = NEW.dispatch_trip_id);
        
        -- Atualiza espelho na dispatch_trips (apenas se for o primeiro link ou principal)
        UPDATE public.dispatch_trips 
        SET load_id = NEW.load_id, 
            updated_at = now() 
        WHERE id = NEW.dispatch_trip_id AND (load_id IS NULL OR load_id = NEW.load_id);
    ELSIF TG_OP = 'DELETE' THEN
        -- Limpa espelhos se a relação for removida
        UPDATE public.loads 
        SET trip_id = NULL, 
            updated_at = now() 
        WHERE id = OLD.load_id AND trip_id = OLD.dispatch_trip_id;
        
        UPDATE public.dispatch_trips 
        SET load_id = NULL, 
            updated_at = now() 
        WHERE id = OLD.dispatch_trip_id AND load_id = OLD.load_id;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_trip_load_mirrors ON public.dispatch_trip_loads;
CREATE TRIGGER trg_sync_trip_load_mirrors
AFTER INSERT OR DELETE ON public.dispatch_trip_loads
FOR EACH ROW EXECUTE FUNCTION public.sync_trip_load_mirrors();

-- 2. Read Model Workspace (Viagem, Cargas, Paradas, Documentos)
CREATE OR REPLACE VIEW public.vw_operational_workspace AS
WITH stop_docs AS (
    SELECT 
        dsd.dispatch_stop_id,
        jsonb_agg(jsonb_build_object(
            'id', fd.id,
            'number', fd.invoice_number,
            'series', fd.invoice_series,
            'value', fd.value,
            'weight', fd.weight_kg,
            'client', c.trade_name
        )) as documents
    FROM public.dispatch_stop_documents dsd
    JOIN public.fiscal_documents fd ON fd.id = dsd.fiscal_document_id
    LEFT JOIN public.clients c ON c.id = fd.client_id
    GROUP BY dsd.dispatch_stop_id
),
trip_stops AS (
    SELECT 
        ds.dispatch_trip_id,
        jsonb_agg(jsonb_build_object(
            'id', ds.id,
            'order', ds.stop_order,
            'status', ds.status,
            'destination', ds.destination,
            'planned_arrival', ds.planned_arrival_at,
            'documents', COALESCE(sd.documents, '[]'::jsonb)
        ) ORDER BY ds.stop_order) as stops
    FROM public.dispatch_stops ds
    LEFT JOIN stop_docs sd ON sd.dispatch_stop_id = ds.id
    GROUP BY ds.dispatch_trip_id
),
trip_loads AS (
    SELECT 
        dtl.dispatch_trip_id,
        jsonb_agg(jsonb_build_object(
            'id', l.id,
            'number', l.load_number,
            'status', l.status,
            'weight', l.total_weight_kg,
            'volume', l.total_volume_m3
        )) as loads
    FROM public.dispatch_trip_loads dtl
    JOIN public.loads l ON l.id = dtl.load_id
    GROUP BY dtl.dispatch_trip_id
)
SELECT 
    dt.id as trip_id,
    dt.tenant_id,
    dt.status as trip_status,
    dt.planned_start_at,
    dt.actual_start_at,
    v.plate as vehicle_plate,
    d.name as driver_name,
    COALESCE(tl.loads, '[]'::jsonb) as loads,
    COALESCE(ts.stops, '[]'::jsonb) as stops,
    dt.updated_at
FROM public.dispatch_trips dt
LEFT JOIN public.vehicles v ON v.id = dt.vehicle_id
LEFT JOIN public.drivers d ON d.id = dt.driver_id
LEFT JOIN trip_stops ts ON ts.dispatch_trip_id = dt.id
LEFT JOIN trip_loads tl ON tl.dispatch_trip_id = dt.id;

GRANT SELECT ON public.vw_operational_workspace TO authenticated;

-- 3. RPC Transacional: Planejar, Despachar e Iniciar Viagem
CREATE OR REPLACE FUNCTION public.plan_dispatch_start_trip_v1(
    p_tenant_id UUID,
    p_driver_id UUID,
    p_vehicle_id UUID,
    p_load_ids UUID[],
    p_stops JSONB, -- Array de {destination, client_id, stop_order, document_ids[]}
    p_start_now BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
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
        actual_start_at
    ) VALUES (
        p_tenant_id,
        p_driver_id,
        p_vehicle_id,
        CASE WHEN p_start_now THEN 'in_transit' ELSE 'planned' END,
        now(),
        CASE WHEN p_start_now THEN now() ELSE NULL END
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
    FOR v_stop IN SELECT * FROM jsonb_to_recordset(p_stops) AS x(destination TEXT, client_id UUID, stop_order INT, document_ids UUID[]) LOOP
        INSERT INTO public.dispatch_stops (
            tenant_id, 
            dispatch_trip_id, 
            destination, 
            client_id, 
            stop_order, 
            status
        ) VALUES (
            p_tenant_id, 
            v_trip_id, 
            v_stop.destination, 
            v_stop.client_id, 
            v_stop.stop_order,
            'pending'
        ) RETURNING id INTO v_stop_id;

        -- Vincula documentos à parada
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