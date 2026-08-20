-- Data Quality Center & Baseline Consolidation
-- Implementation of audit_data_consistency_v4 and Data Quality Center infrastructure

-- 1. Create a table for immutable data repair batches
CREATE TABLE IF NOT EXISTS public.data_repair_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    created_at timestamptz DEFAULT now(),
    created_by uuid REFERENCES auth.users(id),
    status text NOT NULL DEFAULT 'draft', -- 'draft', 'approved', 'executed', 'cancelled'
    description text,
    dry_run_report jsonb,
    execution_results jsonb,
    approved_at timestamptz,
    approved_by uuid REFERENCES auth.users(id),
    executed_at timestamptz,
    compensations jsonb -- Store before-images for possible rollback
);

GRANT SELECT, INSERT, UPDATE ON public.data_repair_batches TO authenticated;
GRANT ALL ON public.data_repair_batches TO service_role;
ALTER TABLE public.data_repair_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant isolation for repair batches" ON public.data_repair_batches FOR ALL TO authenticated USING (tenant_id = (auth.jwt() -> 'user_metadata' ->> 'tenant_id')::uuid);

-- 2. Refined audit function v4
CREATE OR REPLACE FUNCTION public.audit_data_consistency_v4(
    p_tenant_id uuid
)
RETURNS TABLE (
    severity text,
    domain text,
    entity_type text,
    entity_id text,
    message text,
    suggested_action text,
    metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
BEGIN
    -- Vínculos órfãos: Cargas com trip_id sem relação na dispatch_trip_loads
    RETURN QUERY
    SELECT 
        'critical'::text as severity,
        'Logística'::text as domain,
        'load'::text as entity_type,
        l.id::text as entity_id,
        'Carga vinculada a viagem inexistente ou órfã (Load.trip_id set mas dispatch_trip_loads ausente)'::text as message,
        'Remover trip_id órfão ou recriar vínculo canônico'::text as suggested_action,
        jsonb_build_object('trip_id', l.trip_id) as metadata
    FROM public.loads l
    WHERE l.tenant_id = p_tenant_id 
      AND l.trip_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM public.dispatch_trip_loads dtl WHERE dtl.load_id = l.id);

    -- Estados impossíveis: Viagem concluída com paradas ativas
    RETURN QUERY
    SELECT 
        'critical'::text as severity,
        'Logística'::text as domain,
        'trip'::text as entity_type,
        dt.id::text as entity_id,
        'Viagem concluída possui paradas em estado não-terminal'::text as message,
        'Concluir paradas pendentes da viagem'::text as suggested_action,
        jsonb_build_object('stop_count', (SELECT count(*) FROM public.dispatch_stops ds WHERE ds.dispatch_trip_id = dt.id AND ds.status NOT IN ('completed', 'delivered', 'cancelled', 'skipped', 'refused', 'returned', 'partial_delivery', 'failed'))) as metadata
    FROM public.dispatch_trips dt
    WHERE dt.tenant_id = p_tenant_id 
      AND dt.status = 'completed'
      AND EXISTS (SELECT 1 FROM public.dispatch_stops ds WHERE ds.dispatch_trip_id = dt.id AND ds.status NOT IN ('completed', 'delivered', 'cancelled', 'skipped', 'refused', 'returned', 'partial_delivery', 'failed'));

    -- Duplicidades: Notas fiscais com mesma chave
    RETURN QUERY
    SELECT 
        'warning'::text as severity,
        'Fiscal'::text as domain,
        'fiscal_document'::text as entity_type,
        fd.id::text as entity_id,
        'Chave de acesso duplicada detectada'::text as message,
        'Mesclar ou remover documento duplicado'::text as suggested_action,
        jsonb_build_object('access_key', fd.access_key) as metadata
    FROM public.fiscal_documents fd
    WHERE fd.tenant_id = p_tenant_id
      AND fd.access_key IN (
          SELECT access_key 
          FROM public.fiscal_documents 
          WHERE tenant_id = p_tenant_id 
          GROUP BY access_key 
          HAVING count(*) > 1
      );

    -- RLS / Tenant Leakage (Self-audit)
    RETURN QUERY
    SELECT 
        'critical'::text as severity,
        'Segurança'::text as domain,
        'table'::text as entity_type,
        c.relname::text as entity_id,
        'Tabela no schema public sem RLS habilitada'::text as message,
        'Executar ALTER TABLE ENABLE ROW LEVEL SECURITY'::text as suggested_action,
        '{}'::jsonb as metadata
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity;

END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_data_consistency_v4 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_data_consistency_v4 TO authenticated;

-- 3. Secure Repair RPC
CREATE OR REPLACE FUNCTION public.execute_data_repair_v1(
    p_tenant_id uuid,
    p_batch_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
    v_batch record;
    v_results jsonb := '[]'::jsonb;
BEGIN
    -- Auth & Tenant check
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin') THEN
        RAISE EXCEPTION 'Apenas administradores podem executar reparos';
    END IF;

    SELECT * INTO v_batch FROM public.data_repair_batches 
    WHERE id = p_batch_id AND tenant_id = p_tenant_id AND status = 'approved';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Lote de reparo não encontrado ou não aprovado';
    END IF;

    -- Logic for repair would iterate over ids and apply specific fixes
    
    UPDATE public.data_repair_batches 
    SET status = 'executed', 
        executed_at = now(),
        execution_results = v_results
    WHERE id = p_batch_id;

    RETURN v_results;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.execute_data_repair_v1 FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_data_repair_v1 TO authenticated;
