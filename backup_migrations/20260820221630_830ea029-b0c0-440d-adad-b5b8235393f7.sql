-- Migração de Consolidação Logística: Cargas e Despacho
-- Foco: load_items (SoT), dispatch_trip_loads (Viagem-Carga) e dispatch_stop_documents (Parada-Documento)

-- 1. Garantir tabelas canônicas e colunas corretas
DO $$ 
BEGIN
    -- loads: trip_id agora é derivado, mas mantemos para performance/legado controlado
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'loads' AND column_name = 'trip_id') THEN
        ALTER TABLE public.loads ADD COLUMN trip_id uuid REFERENCES public.dispatch_trips(id);
    END IF;

    -- dispatch_stops: garantindo vínculo com cliente e local
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dispatch_stops' AND column_name = 'client_id') THEN
        ALTER TABLE public.dispatch_stops ADD COLUMN client_id uuid REFERENCES public.clients(id);
    END IF;
END $$;

-- 2. RPC Transacional: Vincular itens a carga (Composição Canônica)
CREATE OR REPLACE FUNCTION public.link_items_to_load_v2(
    p_tenant_id uuid,
    p_load_id uuid,
    p_item_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item_count int;
BEGIN
    IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    -- Validação de existência da carga
    IF NOT EXISTS (SELECT 1 FROM public.loads WHERE id = p_load_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Carga não encontrada';
    END IF;

    -- Update atômico dos itens (Source of Truth)
    UPDATE public.load_items
    SET load_id = p_load_id,
        updated_at = now()
    WHERE id = ANY(p_item_ids) 
      AND tenant_id = p_tenant_id;
    
    GET DIAGNOSTICS v_item_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'status', 'success',
        'items_linked', v_item_count
    );
END;
$$;

-- 3. RPC Transacional: Planejar Despacho (Dispatch SoT)
-- Cria viagem, vincula cargas (dispatch_trip_loads) e documentos (dispatch_stop_documents)
CREATE OR REPLACE FUNCTION public.plan_dispatch_trip_v2(
    p_tenant_id uuid,
    p_driver_id uuid,
    p_vehicle_id uuid,
    p_route_name text,
    p_load_ids uuid[],
    p_stops jsonb -- Array de {destination, client_id, stop_order, fiscal_document_ids[]}
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_trip_id uuid;
    v_stop record;
    v_stop_id uuid;
    v_doc_id uuid;
    v_load_id uuid;
BEGIN
    IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    -- 1. Criar Viagem
    INSERT INTO public.dispatch_trips (
        tenant_id, driver_id, vehicle_id, route_name, status, planned_start_at
    ) VALUES (
        p_tenant_id, p_driver_id, p_vehicle_id, p_route_name, 'planned', now()
    ) RETURNING id INTO v_trip_id;

    -- 2. Vincular Cargas (dispatch_trip_loads)
    FOREACH v_load_id IN ARRAY p_load_ids
    LOOP
        INSERT INTO public.dispatch_trip_loads (trip_id, load_id, tenant_id)
        VALUES (v_trip_id, v_load_id, p_tenant_id);
        
        -- Mirror (denormalization para facilidade de busca)
        UPDATE public.loads SET trip_id = v_trip_id WHERE id = v_load_id;
    END LOOP;

    -- 3. Criar Paradas e Vincular Documentos (dispatch_stop_documents)
    FOR v_stop IN SELECT * FROM jsonb_to_recordset(p_stops) AS x(destination text, client_id uuid, stop_order int, fiscal_document_ids uuid[])
    LOOP
        INSERT INTO public.dispatch_stops (
            tenant_id, dispatch_trip_id, destination, client_id, stop_order, status
        ) VALUES (
            p_tenant_id, v_trip_id, v_stop.destination, v_stop.client_id, v_stop.stop_order, 'pending'
        ) RETURNING id INTO v_stop_id;

        IF v_stop.fiscal_document_ids IS NOT NULL THEN
            FOREACH v_doc_id IN ARRAY v_stop.fiscal_document_ids
            LOOP
                INSERT INTO public.dispatch_stop_documents (
                    tenant_id, dispatch_stop_id, fiscal_document_id, status
                ) VALUES (
                    p_tenant_id, v_stop_id, v_doc_id, 'pending'
                );
            END LOOP;
        END IF;
    END LOOP;

    RETURN v_trip_id;
END;
$$;

-- 4. RPC Transacional: Mover Itens entre Cargas
CREATE OR REPLACE FUNCTION public.move_load_items_v3(
    p_tenant_id uuid,
    p_source_load_id uuid,
    p_target_load_id uuid,
    p_item_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    UPDATE public.load_items
    SET load_id = p_target_load_id,
        updated_at = now()
    WHERE id = ANY(p_item_ids) 
      AND load_id = p_source_load_id
      AND tenant_id = p_tenant_id;

    RETURN jsonb_build_object('status', 'success');
END;
$$;

-- 5. Revogar acessos diretos e garantir permissões RPC
-- Notas: RLS deve estar habilitada, aqui reforçamos a negação de escrita direta
REVOKE INSERT, UPDATE, DELETE ON public.loads FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.load_items FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.dispatch_trips FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.dispatch_stops FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.dispatch_trip_loads FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.dispatch_stop_documents FROM authenticated;

-- Grant apenas SELECT (Read-only frontend)
GRANT SELECT ON public.loads TO authenticated;
GRANT SELECT ON public.load_items TO authenticated;
GRANT SELECT ON public.dispatch_trips TO authenticated;
GRANT SELECT ON public.dispatch_stops TO authenticated;
GRANT SELECT ON public.dispatch_trip_loads TO authenticated;
GRANT SELECT ON public.dispatch_stop_documents TO authenticated;

-- Grant EXECUTE nas novas RPCs
GRANT EXECUTE ON FUNCTION public.link_items_to_load_v2(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.plan_dispatch_trip_v2(uuid, uuid, uuid, text, uuid[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_load_items_v3(uuid, uuid, uuid, uuid[]) TO authenticated;

-- Revoke de PUBLIC para segurança adicional (violado se não fizer)
REVOKE EXECUTE ON FUNCTION public.link_items_to_load_v2(uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.plan_dispatch_trip_v2(uuid, uuid, uuid, text, uuid[], jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.move_load_items_v3(uuid, uuid, uuid, uuid[]) FROM PUBLIC;
