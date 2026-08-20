CREATE EXTENSION IF NOT EXISTS unaccent;

-- RPC para listagem de Motoristas
CREATE OR REPLACE FUNCTION public.list_drivers_v1(
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
    FROM public.drivers
    WHERE tenant_id = p_tenant_id
      AND active = true
      AND (p_search IS NULL OR unaccent(name) ILIKE unaccent('%' || p_search || '%') OR license_number ILIKE '%' || p_search || '%');

    SELECT jsonb_agg(t) INTO v_items FROM (
        SELECT *
        FROM public.drivers
        WHERE tenant_id = p_tenant_id
          AND active = true
          AND (p_search IS NULL OR unaccent(name) ILIKE unaccent('%' || p_search || '%') OR license_number ILIKE '%' || p_search || '%')
          AND (p_cursor IS NULL OR name > p_cursor)
        ORDER BY name ASC
        LIMIT p_limit
    ) t;

    IF v_items IS NOT NULL AND jsonb_array_length(v_items) = p_limit THEN
        v_next_cursor := v_items->(p_limit-1)->>'name';
    END IF;

    RETURN jsonb_build_object(
        'items', COALESCE(v_items, '[]'::jsonb),
        'next_cursor', v_next_cursor,
        'total_count', v_total_count
    );
END;
$$;

-- RPC para listagem de Rotas Operacionais
CREATE OR REPLACE FUNCTION public.list_operational_routes_v1(
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
    FROM public.operational_routes
    WHERE tenant_id = p_tenant_id
      AND active = true
      AND (p_search IS NULL OR unaccent(name) ILIKE unaccent('%' || p_search || '%'));

    SELECT jsonb_agg(t) INTO v_items FROM (
        SELECT *
        FROM public.operational_routes
        WHERE tenant_id = p_tenant_id
          AND active = true
          AND (p_search IS NULL OR unaccent(name) ILIKE unaccent('%' || p_search || '%'))
          AND (p_cursor IS NULL OR name > p_cursor)
        ORDER BY name ASC
        LIMIT p_limit
    ) t;

    IF v_items IS NOT NULL AND jsonb_array_length(v_items) = p_limit THEN
        v_next_cursor := v_items->(p_limit-1)->>'name';
    END IF;

    RETURN jsonb_build_object(
        'items', COALESCE(v_items, '[]'::jsonb),
        'next_cursor', v_next_cursor,
        'total_count', v_total_count
    );
END;
$$;

-- RPC para listagem de Viagens (Trips)
CREATE OR REPLACE FUNCTION public.list_dispatch_trips_v1(
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
    FROM public.dispatch_trips
    WHERE tenant_id = p_tenant_id
      AND (p_status IS NULL OR status = ANY(p_status))
      AND (p_search IS NULL OR trip_number ILIKE '%' || p_search || '%');

    SELECT jsonb_agg(t) INTO v_items FROM (
        SELECT tr.*, 
               (SELECT row_to_json(v) FROM (SELECT plate, nickname FROM vehicles WHERE id = tr.vehicle_id) v) as vehicle,
               (SELECT row_to_json(d) FROM (SELECT name FROM drivers WHERE id = tr.driver_id) d) as driver
        FROM public.dispatch_trips tr
        WHERE tr.tenant_id = p_tenant_id
          AND (p_status IS NULL OR tr.status = ANY(p_status))
          AND (p_search IS NULL OR tr.trip_number ILIKE '%' || p_search || '%')
          AND (p_cursor IS NULL OR tr.created_at < p_cursor)
        ORDER BY tr.created_at DESC
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

-- Limpeza de grants para segurança
REVOKE EXECUTE ON FUNCTION public.list_loads_v1(uuid, text, text[], timestamptz, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_fiscal_documents_v1(uuid, text, text[], timestamptz, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_clients_v1(uuid, text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_drivers_v1(uuid, text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_operational_routes_v1(uuid, text, text, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_dispatch_trips_v1(uuid, text, text[], timestamptz, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.list_loads_v1(uuid, text, text[], timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_fiscal_documents_v1(uuid, text, text[], timestamptz, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_clients_v1(uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_drivers_v1(uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_operational_routes_v1(uuid, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_dispatch_trips_v1(uuid, text, text[], timestamptz, integer) TO authenticated;
