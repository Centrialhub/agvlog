-- RPC para listagem de Cargas (Loads)
CREATE OR REPLACE FUNCTION public.list_loads_v1(
    p_tenant_id uuid,
    p_search text DEFAULT NULL,
    p_status text[] DEFAULT NULL,
    p_cursor timestamptz DEFAULT NULL,
    p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
    v_total_count bigint;
    v_items jsonb;
    v_next_cursor timestamptz;
BEGIN
    SELECT count(*) INTO v_total_count
    FROM public.loads
    WHERE tenant_id = p_tenant_id
      AND (p_status IS NULL OR status = ANY(p_status))
      AND (p_search IS NULL OR 
           load_number ILIKE '%' || p_search || '%' OR 
           origin ILIKE '%' || p_search || '%' OR 
           destination ILIKE '%' || p_search || '%');

    SELECT jsonb_agg(t) INTO v_items FROM (
        SELECT l.*, 
               (SELECT row_to_json(v) FROM (SELECT plate, nickname FROM vehicles WHERE id = l.vehicle_id) v) as vehicles,
               (SELECT row_to_json(d) FROM (SELECT name FROM drivers WHERE id = l.driver_id) d) as drivers
        FROM public.loads l
        WHERE l.tenant_id = p_tenant_id
          AND (p_status IS NULL OR l.status = ANY(p_status))
          AND (p_search IS NULL OR 
               l.load_number ILIKE '%' || p_search || '%' OR 
               l.origin ILIKE '%' || p_search || '%' OR 
               l.destination ILIKE '%' || p_search || '%')
          AND (p_cursor IS NULL OR l.created_at < p_cursor)
        ORDER BY l.created_at DESC
        LIMIT p_limit
    ) t;

    IF v_items IS NOT NULL AND jsonb_array_length(v_items) = p_limit THEN
        v_next_cursor := (v_items->(p_limit-1)->>'created_at')::timestamptz;
    END IF;

    RETURN jsonb_build_object(
        'items', COALESCE(v_items, '[]'::jsonb),
        'next_cursor', v_next_cursor,
        'total_count', v_total_count
    );
END;
$$;

-- RPC para listagem de Documentos Fiscais
CREATE OR REPLACE FUNCTION public.list_fiscal_documents_v1(
    p_tenant_id uuid,
    p_search text DEFAULT NULL,
    p_type text[] DEFAULT NULL,
    p_cursor timestamptz DEFAULT NULL,
    p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
    v_total_count bigint;
    v_items jsonb;
    v_next_cursor timestamptz;
BEGIN
    SELECT count(*) INTO v_total_count
    FROM public.fiscal_documents
    WHERE tenant_id = p_tenant_id
      AND deleted_at IS NULL
      AND (p_type IS NULL OR document_type = ANY(p_type))
      AND (p_search IS NULL OR 
           invoice_number ILIKE '%' || p_search || '%' OR 
           access_key ILIKE '%' || p_search || '%' OR 
           recipient ILIKE '%' || p_search || '%');

    SELECT jsonb_agg(t) INTO v_items FROM (
        SELECT d.*, 
               c.company_name as client_name,
               l.load_number
        FROM public.fiscal_documents d
        LEFT JOIN public.clients c ON c.id = d.client_id
        LEFT JOIN public.loads l ON l.id = d.load_id
        WHERE d.tenant_id = p_tenant_id
          AND d.deleted_at IS NULL
          AND (p_type IS NULL OR d.document_type = ANY(p_type))
          AND (p_search IS NULL OR 
               d.invoice_number ILIKE '%' || p_search || '%' OR 
               d.access_key ILIKE '%' || p_search || '%' OR 
               d.recipient ILIKE '%' || p_search || '%')
          AND (p_cursor IS NULL OR d.created_at < p_cursor)
        ORDER BY d.created_at DESC
        LIMIT p_limit
    ) t;

    IF v_items IS NOT NULL AND jsonb_array_length(v_items) = p_limit THEN
        v_next_cursor := (v_items->(p_limit-1)->>'created_at')::timestamptz;
    END IF;

    RETURN jsonb_build_object(
        'items', COALESCE(v_items, '[]'::jsonb),
        'next_cursor', v_next_cursor,
        'total_count', v_total_count
    );
END;
$$;

-- RPC para listagem de Clientes
CREATE OR REPLACE FUNCTION public.list_clients_v1(
    p_tenant_id uuid,
    p_search text DEFAULT NULL,
    p_cursor text DEFAULT NULL,
    p_limit integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
    v_total_count bigint;
    v_items jsonb;
    v_next_cursor text;
BEGIN
    SELECT count(*) INTO v_total_count
    FROM public.clients
    WHERE tenant_id = p_tenant_id
      AND active = true
      AND (p_search IS NULL OR company_name ILIKE '%' || p_search || '%' OR tax_id ILIKE '%' || p_search || '%');

    SELECT jsonb_agg(t) INTO v_items FROM (
        SELECT *
        FROM public.clients
        WHERE tenant_id = p_tenant_id
          AND active = true
          AND (p_search IS NULL OR company_name ILIKE '%' || p_search || '%' OR tax_id ILIKE '%' || p_search || '%')
          AND (p_cursor IS NULL OR company_name > p_cursor)
        ORDER BY company_name ASC
        LIMIT p_limit
    ) t;

    IF v_items IS NOT NULL AND jsonb_array_length(v_items) = p_limit THEN
        v_next_cursor := v_items->(p_limit-1)->>'company_name';
    END IF;

    RETURN jsonb_build_object(
        'items', COALESCE(v_items, '[]'::jsonb),
        'next_cursor', v_next_cursor,
        'total_count', v_total_count
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_loads_v1(uuid, text, text[], timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_fiscal_documents_v1(uuid, text, text[], timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_clients_v1(uuid, text, text, integer) TO authenticated;
