CREATE OR REPLACE VIEW public.vw_load_control AS
SELECT 
    l.id,
    l.tenant_id,
    l.load_number,
    l.external_load_number,
    l.load_date,
    l.arrival_date,
    l.status,
    l.operational_status,
    l.billing_status,
    l.payment_status,
    l.freight_amount,
    l.received_amount,
    l.freight_percent,
    l.total_weight_kg,
    l.total_volume_m3,
    l.total_pallet_count,
    l.invoice_count,
    l.cte_count,
    l.expected_payment_date,
    l.payment_date,
    l.gross_cargo_value,
    l.client_invoice_id,
    l.receivable_id,
    l.legacy_status_text,
    d.name as driver_name,
    v.plate as vehicle_plate,
    l.trip_id,
    l.notes,
    l.created_at,
    l.updated_at
FROM public.loads l
LEFT JOIN public.drivers d ON l.driver_id = d.id
LEFT JOIN public.vehicles v ON l.vehicle_id = v.id;

GRANT SELECT ON public.vw_load_control TO authenticated;
GRANT ALL ON public.vw_load_control TO service_role;

CREATE OR REPLACE FUNCTION public.list_load_control_v1(
    p_tenant_id uuid,
    p_filters jsonb DEFAULT '{}',
    p_limit integer DEFAULT 50,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    items jsonb,
    total_count bigint
) AS $$
DECLARE
    v_search text := p_filters->>'search';
    v_payment_status text[] := ARRAY(SELECT jsonb_array_elements_text(p_filters->'paymentStatus'));
    v_load_number text := p_filters->>'loadNumber';
    v_date_from date := (p_filters->>'loadDateFrom')::date;
    v_date_to date := (p_filters->>'loadDateTo')::date;
BEGIN
    RETURN QUERY
    WITH filtered_loads AS (
        SELECT * FROM public.vw_load_control
        WHERE tenant_id = p_tenant_id
        AND (v_search IS NULL OR load_number ILIKE '%' || v_search || '%' OR external_load_number ILIKE '%' || v_search || '%' OR driver_name ILIKE '%' || v_search || '%')
        AND (v_load_number IS NULL OR load_number = v_load_number OR external_load_number = v_load_number)
        AND (cardinality(v_payment_status) = 0 OR payment_status = ANY(v_payment_status))
        AND (v_date_from IS NULL OR load_date >= v_date_from)
        AND (v_date_to IS NULL OR load_date <= v_date_to)
    )
    SELECT 
        (SELECT jsonb_agg(fl) FROM (SELECT * FROM filtered_loads ORDER BY created_at DESC LIMIT p_limit OFFSET p_offset) fl) as items,
        (SELECT count(*) FROM filtered_loads) as total_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.list_load_control_v1(uuid, jsonb, integer, integer) TO authenticated;
