CREATE TABLE IF NOT EXISTS public.data_repair_batch_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id),
    batch_id uuid NOT NULL REFERENCES public.data_repair_batches(id) ON DELETE CASCADE,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    action_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb,
    before_state jsonb,
    after_state jsonb,
    status text DEFAULT 'pending',
    error_message text,
    executed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_repair_batch_items TO authenticated;
GRANT ALL ON public.data_repair_batch_items TO service_role;

ALTER TABLE public.data_repair_batch_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for repair items" ON public.data_repair_batch_items
FOR ALL TO authenticated
USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- 1. Hardening execute_data_repair_v1
CREATE OR REPLACE FUNCTION public.execute_data_repair_v1(
    p_tenant_id uuid,
    p_batch_id uuid,
    p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch record;
    v_item record;
    v_results jsonb := '[]'::jsonb;
    v_user_id uuid := auth.uid();
    v_current_item_result jsonb;
BEGIN
    -- Validação de Admin
    IF NOT public.is_tenant_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Apenas administradores do tenant podem executar reparos';
    END IF;

    -- Seleção do lote
    SELECT * INTO v_batch FROM public.data_repair_batches 
    WHERE id = p_batch_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Lote de reparo não encontrado';
    END IF;

    -- Maker-checker (Se não for dry-run)
    IF NOT p_dry_run THEN
        IF v_batch.status != 'approved' THEN
            RAISE EXCEPTION 'Apenas lotes aprovados podem ser executados (status atual: %)', v_batch.status;
        END IF;
        
        IF v_batch.approved_by = v_user_id THEN
            RAISE EXCEPTION 'Maker-checker: O executor deve ser diferente do aprovador';
        END IF;
    END IF;

    -- Loop de itens
    FOR v_item IN SELECT * FROM public.data_repair_batch_items WHERE batch_id = p_batch_id AND tenant_id = p_tenant_id
    LOOP
        -- Aqui implementamos a lógica de reparo baseada no entity_type e action_type
        -- Por agora, simulamos ou executamos dry-run updates.
        -- No futuro, cada action_type terá um handler dinâmico.
        
        v_current_item_result := jsonb_build_object(
            'item_id', v_item.id,
            'status', CASE WHEN p_dry_run THEN 'dry_run_success' ELSE 'executed' END,
            'entity_id', v_item.entity_id
        );

        IF NOT p_dry_run THEN
            UPDATE public.data_repair_batch_items 
            SET status = 'executed', 
                executed_at = now(),
                before_state = v_item.before_state -- Idealmente capturado dinamicamente
            WHERE id = v_item.id;
        END IF;

        v_results := v_results || v_current_item_result;
    END LOOP;

    -- Atualiza lote principal se não for dry-run
    IF NOT p_dry_run THEN
        UPDATE public.data_repair_batches 
        SET status = 'completed', 
            executed_at = now(), 
            execution_results = v_results
        WHERE id = p_batch_id;
    END IF;

    RETURN v_results;
END;
$$;

-- 2. Dedicated list_employees_v1 (separating from drivers)
CREATE OR REPLACE FUNCTION public.list_employees_v1(
    p_tenant_id uuid,
    p_search text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_limit int DEFAULT 50,
    p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_items jsonb;
    v_total int;
BEGIN
    IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Acesso negado';
    END IF;

    SELECT jsonb_agg(t) INTO v_items
    FROM (
        SELECT * FROM public.employees
        WHERE tenant_id = p_tenant_id
          AND (p_search IS NULL OR name ILIKE '%' || p_search || '%' OR doc_cpf ILIKE '%' || p_search || '%')
          AND (p_status IS NULL OR status = p_status)
        ORDER BY name ASC
        LIMIT p_limit OFFSET p_offset
    ) t;

    SELECT count(*) INTO v_total
    FROM public.employees
    WHERE tenant_id = p_tenant_id
      AND (p_search IS NULL OR name ILIKE '%' || p_search || '%' OR doc_cpf ILIKE '%' || p_search || '%')
      AND (p_status IS NULL OR status = p_status);

    RETURN jsonb_build_object(
        'items', COALESCE(v_items, '[]'::jsonb),
        'total_count', v_total
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.list_employees_v1(uuid, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_employees_v1(uuid, text, text, int, int) TO authenticated;
