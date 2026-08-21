-- Portal read model (corrigido para o schema real de public.fiscal_documents)
-- Colunas reais: issue_date, value, weight_kg, client_id, remitter_cnpj, recipient_cnpj.
-- Nao existem invoice_date, total_value, total_weight_kg, issuer_id nem sender_cnpj.

-- 1. Read Model for Shipments (Portal Perspective)
DROP VIEW IF EXISTS public.portal_shipment_read_model;

CREATE VIEW public.portal_shipment_read_model
WITH (security_invoker = true) AS
SELECT
    fd.id,
    fd.tenant_id,
    fd.invoice_number,
    fd.invoice_series,
    fd.issue_date,
    fd.value,
    fd.weight_kg,
    fd.client_id,
    c.company_name       AS client_name,
    c.tax_id             AS client_document,
    l.load_number,
    l.status             AS load_status,
    dt.status            AS trip_status,
    ds.status            AS stop_status,
    ds.actual_arrival_at,
    ds.actual_departure_at,
    -- Campos de escopo normalizados (filtros/auditoria)
    fd.remitter_cnpj,
    fd.recipient_cnpj
FROM public.fiscal_documents fd
LEFT JOIN public.clients c ON c.id = fd.client_id AND c.tenant_id = fd.tenant_id
LEFT JOIN public.loads l ON l.id = fd.load_id AND l.tenant_id = fd.tenant_id
LEFT JOIN public.dispatch_trip_loads dtl ON dtl.load_id = l.id AND dtl.tenant_id = fd.tenant_id
LEFT JOIN public.dispatch_trips dt ON dt.id = dtl.dispatch_trip_id AND dt.tenant_id = fd.tenant_id
LEFT JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id AND dsd.tenant_id = fd.tenant_id
LEFT JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id AND ds.tenant_id = fd.tenant_id
WHERE fd.deleted_at IS NULL;

GRANT SELECT ON public.portal_shipment_read_model TO authenticated;
GRANT SELECT ON public.portal_shipment_read_model TO service_role;

-- 2. Scoped Tracking RPC (DTO estavel)
DROP FUNCTION IF EXISTS public.get_portal_tracking_v3(uuid, uuid[], text[], text, int, int);

CREATE FUNCTION public.get_portal_tracking_v3(
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
    issue_date date,
    value numeric,
    weight_kg numeric,
    client_id uuid,
    client_name text,
    load_number text,
    current_status text,
    last_event_at timestamptz,
    total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_internal boolean;
    v_allowed uuid[];
BEGIN
    IF p_tenant_id IS NULL THEN
        RAISE EXCEPTION 'TENANT_REQUIRED';
    END IF;

    v_is_internal := public.is_user_internal_role(p_tenant_id);
    v_allowed := public._portal_user_client_ids(p_tenant_id);

    IF NOT v_is_internal AND (v_allowed IS NULL OR array_length(v_allowed, 1) IS NULL) THEN
        RAISE EXCEPTION 'ACCESS_DENIED';
    END IF;

    RETURN QUERY
    WITH filtered AS (
        SELECT
            rm.id,
            rm.invoice_number,
            rm.invoice_series,
            rm.issue_date,
            rm.value,
            rm.weight_kg,
            rm.client_id,
            rm.client_name,
            rm.load_number,
            COALESCE(rm.stop_status, rm.trip_status, rm.load_status, 'pending') AS effective_status,
            COALESCE(rm.actual_departure_at, rm.actual_arrival_at, rm.issue_date::timestamptz) AS last_activity,
            COUNT(*) OVER() AS full_count
        FROM public.portal_shipment_read_model rm
        WHERE rm.tenant_id = p_tenant_id
            -- Autorizacao por linha: papel interno do tenant ou vinculo do portal.
            AND (v_is_internal OR rm.client_id = ANY(v_allowed))
            -- Argumentos sao apenas filtros de refinamento, nunca fonte de autorizacao.
            AND (p_client_ids IS NULL OR rm.client_id = ANY(p_client_ids))
            AND (
                p_cnpjs IS NULL
                OR rm.client_document = ANY(p_cnpjs)
                OR rm.remitter_cnpj = ANY(p_cnpjs)
                OR rm.recipient_cnpj = ANY(p_cnpjs)
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
        f.issue_date,
        f.value,
        f.weight_kg,
        f.client_id,
        f.client_name,
        f.load_number,
        f.effective_status,
        f.last_activity,
        f.full_count
    FROM filtered f
    ORDER BY f.last_activity DESC NULLS LAST
    LIMIT GREATEST(COALESCE(p_limit, 50), 0)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.get_portal_tracking_v3(uuid, uuid[], text[], text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_portal_tracking_v3(uuid, uuid[], text[], text, int, int) TO authenticated;
