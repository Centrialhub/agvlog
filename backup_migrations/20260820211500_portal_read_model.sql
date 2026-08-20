-- 1. Read Model for Shipments (Portal Perspective)
CREATE OR REPLACE VIEW public.portal_shipment_read_model AS
SELECT 
    fd.id,
    fd.tenant_id,
    fd.invoice_number,
    fd.invoice_series,
    fd.invoice_date,
    fd.total_value,
    fd.total_weight_kg,
    fd.client_id,
    fd.issuer_id,
    c.company_name as client_name,
    c.document as client_document,
    i.company_name as issuer_name,
    i.document as issuer_document,
    l.load_number,
    l.status as load_status,
    dt.status as trip_status,
    ds.status as stop_status,
    ds.actual_arrival_at,
    ds.actual_departure_at,
    -- Normalized scope fields for RLS and Filtering
    fd.recipient_cnpj,
    fd.sender_cnpj
FROM 
    public.fiscal_documents fd
LEFT JOIN public.clients c ON fd.client_id = c.id
LEFT JOIN public.clients i ON fd.issuer_id = i.id
LEFT JOIN public.loads l ON fd.load_id = l.id
LEFT JOIN public.dispatch_trip_loads dtl ON l.id = dtl.load_id
LEFT JOIN public.dispatch_trips dt ON dtl.dispatch_trip_id = dt.id
LEFT JOIN public.dispatch_stop_documents dsd ON fd.id = dsd.fiscal_document_id
LEFT JOIN public.dispatch_stops ds ON dsd.dispatch_stop_id = ds.id
WHERE 
    fd.deleted_at IS NULL;

GRANT SELECT ON public.portal_shipment_read_model TO authenticated;
GRANT SELECT ON public.portal_shipment_read_model TO service_role;

-- 2. Scoped Tracking RPC
CREATE OR REPLACE FUNCTION public.get_portal_tracking_v3(
    p_tenant_id uuid,
    p_client_ids uuid[] DEFAULT NULL,
    p_cnpjs text[] DEFAULT NULL,
    p_search text DEFAULT NULL,
    p_limit int DEFAULT 50,
    p_offset int DEFAULT 0
)
RETURNS TABLE (
    id uuid,
    invoice_number text,
    invoice_series text,
    invoice_date timestamptz,
    total_value numeric,
    client_name text,
    load_number text,
    current_status text,
    last_event_at timestamptz,
    total_count bigint
) 
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH filtered AS (
        SELECT 
            rm.*,
            COALESCE(rm.stop_status, rm.load_status, 'pending') as effective_status,
            COALESCE(rm.actual_departure_at, rm.actual_arrival_at, rm.invoice_date) as last_activity,
            COUNT(*) OVER() as full_count
        FROM 
            public.portal_shipment_read_model rm
        WHERE 
            rm.tenant_id = p_tenant_id
            AND (
                p_client_ids IS NULL 
                OR rm.client_id = ANY(p_client_ids) 
                OR rm.issuer_id = ANY(p_client_ids)
            )
            AND (
                p_cnpjs IS NULL 
                OR rm.client_document = ANY(p_cnpjs)
                OR rm.issuer_document = ANY(p_cnpjs)
                OR rm.recipient_cnpj = ANY(p_cnpjs)
                OR rm.sender_cnpj = ANY(p_cnpjs)
            )
            AND (
                p_search IS NULL 
                OR rm.invoice_number ILIKE '%' || p_search || '%'
                OR rm.client_name ILIKE '%' || p_search || '%'
                OR rm.load_number ILIKE '%' || p_search || '%'
            )
    )
    SELECT 
        f.id,
        f.invoice_number,
        f.invoice_series,
        f.invoice_date,
        f.total_value,
        f.client_name,
        f.load_number,
        f.effective_status,
        f.last_activity,
        f.full_count
    FROM 
        filtered f
    ORDER BY 
        f.last_activity DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_portal_tracking_v3 TO authenticated;
