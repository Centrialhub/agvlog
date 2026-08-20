DROP VIEW IF EXISTS public.vw_operational_workspace;

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
    dt.driver_id,
    dt.vehicle_id,
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