-- Security Hardening: Rollback logical auth leak and enforce membership validation

-- 1. Helper: Unified operator/admin check using memberships
CREATE OR REPLACE FUNCTION public.is_tenant_operator_or_admin(_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_memberships
    WHERE user_id = auth.uid()
      AND tenant_id = _tenant_id
      AND role IN ('owner', 'admin', 'operator')
      AND active = true
  );
$$;

-- 2. Hardened RLS Policy for data_repair_batches (Fixing leakage)
DROP POLICY IF EXISTS "Tenant isolation for repair batches" ON public.data_repair_batches;
CREATE POLICY "Tenant isolation for repair batches" ON public.data_repair_batches 
FOR ALL TO authenticated 
USING (tenant_id IN (SELECT public.get_user_tenant_ids()));

-- 3. Hardened RPCs: Replacing metadata checks with membership checks and validating parameters

-- Data Quality Center: audit_data_consistency_v4
CREATE OR REPLACE FUNCTION public.audit_data_consistency_v4(p_tenant_id uuid)
RETURNS TABLE (severity text, domain text, entity_type text, entity_id text, message text, suggested_action text, metadata jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

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

-- Repair Logic: execute_data_repair_v1
CREATE OR REPLACE FUNCTION public.execute_data_repair_v1(p_tenant_id uuid, p_batch_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch record;
    v_results jsonb := '[]'::jsonb;
BEGIN
    IF NOT public.is_tenant_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Apenas administradores do tenant podem executar reparos';
    END IF;

    SELECT * INTO v_batch FROM public.data_repair_batches 
    WHERE id = p_batch_id AND tenant_id = p_tenant_id AND status = 'approved';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Lote de reparo não encontrado ou não aprovado para este tenant';
    END IF;

    UPDATE public.data_repair_batches SET status = 'executed', executed_at = now(), execution_results = v_results
    WHERE id = p_batch_id AND tenant_id = p_tenant_id;

    RETURN v_results;
END;
$$;

-- Driver Workspace: Validation of driver ownership
CREATE OR REPLACE FUNCTION public.get_driver_workspace_v1(p_driver_id uuid, p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_trip_record record;
    v_loads jsonb;
    v_stops jsonb;
    v_progress jsonb;
    v_next_action jsonb;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.drivers WHERE id = p_driver_id AND tenant_id = p_tenant_id AND user_id = auth.uid()) THEN
        RAISE EXCEPTION 'Acesso negado ao workspace do motorista';
    END IF;

    -- 1. Identify active trip
    SELECT * INTO v_trip_record
    FROM public.dispatch_trips
    WHERE driver_id = p_driver_id
      AND tenant_id = p_tenant_id
      AND status NOT IN ('completed', 'cancelled')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_trip_record.id IS NULL THEN
        RETURN jsonb_build_object(
            'has_active_trip', false,
            'driver_id', p_driver_id
        );
    END IF;

    -- 2. Fetch loads via canonical mapping
    SELECT jsonb_agg(l.*) INTO v_loads
    FROM (
        SELECT 
            loads.id,
            loads.load_number,
            loads.status,
            loads.origin,
            loads.destination,
            loads.total_value,
            loads.total_weight
        FROM public.dispatch_trip_loads dtl
        JOIN public.loads ON loads.id = dtl.load_id
        WHERE dtl.trip_id = v_trip_record.id
    ) l;

    -- 3. Fetch stops and stop-level documents
    SELECT jsonb_agg(s.*) INTO v_stops
    FROM (
        SELECT 
            ds.id,
            ds.stop_order,
            ds.status,
            ds.stop_type,
            ds.location_name,
            ds.address,
            ds.arrival_time,
            ds.departure_time,
            (
                SELECT jsonb_agg(doc.*)
                FROM (
                    SELECT 
                        fd.id,
                        fd.invoice_number as number,
                        fd.invoice_series as series,
                        fd.total_value,
                        dsd.status as stop_status
                    FROM public.dispatch_stop_documents dsd
                    JOIN public.fiscal_documents fd ON fd.id = dsd.fiscal_document_id
                    WHERE dsd.dispatch_stop_id = ds.id
                ) doc
            ) as documents
        FROM public.dispatch_stops ds
        WHERE ds.dispatch_trip_id = v_trip_record.id
        ORDER BY ds.stop_order ASC
    ) s;

    -- 4. Calculate progress
    SELECT jsonb_build_object(
        'total_stops', count(*),
        'completed_stops', count(*) FILTER (WHERE status = 'completed'),
        'pending_stops', count(*) FILTER (WHERE status IN ('pending', 'arrived', 'in_progress'))
    ) INTO v_progress
    FROM public.dispatch_stops
    WHERE dispatch_trip_id = v_trip_record.id;

    -- 5. Determine next action
    SELECT jsonb_build_object(
        'stop_id', id,
        'stop_type', stop_type,
        'status', status,
        'location_name', location_name
    ) INTO v_next_action
    FROM public.dispatch_stops
    WHERE dispatch_trip_id = v_trip_record.id
      AND status != 'completed'
    ORDER BY stop_order ASC
    LIMIT 1;

    RETURN jsonb_build_object(
        'has_active_trip', true,
        'trip', jsonb_build_object(
            'id', v_trip_record.id,
            'status', v_trip_record.status,
            'start_km', v_trip_record.start_km,
            'created_at', v_trip_record.created_at
        ),
        'loads', COALESCE(v_loads, '[]'::jsonb),
        'stops', COALESCE(v_stops, '[]'::jsonb),
        'progress', v_progress,
        'next_action', v_next_action
    );
END;
$$;

-- Operational Events: log_operational_event_v2
CREATE OR REPLACE FUNCTION public.log_operational_event_v2(p_tenant_id uuid, p_event_type text, p_dispatch_stop_id uuid DEFAULT NULL, p_fiscal_document_id uuid DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb, p_pod_data jsonb DEFAULT NULL, p_idempotency_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_event_id uuid;
    v_pod_id uuid;
    v_content_hash text;
BEGIN
    IF NOT public.is_tenant_member(p_tenant_id) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;
    -- Validate stop ownership if provided
    IF p_dispatch_stop_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.dispatch_stops WHERE id = p_dispatch_stop_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Parada inválida para este tenant';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_event_id FROM public.operational_events 
        WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
        IF v_event_id IS NOT NULL THEN
            RETURN jsonb_build_object('status', 'success', 'event_id', v_event_id, 'idempotent', true);
        END IF;
    END IF;

    IF p_pod_data IS NOT NULL THEN
        v_content_hash := encode(digest(p_pod_data::text, 'sha256'), 'hex');
        UPDATE public.proof_of_delivery SET is_active = false 
        WHERE dispatch_stop_id = p_dispatch_stop_id 
          AND (fiscal_document_id = p_fiscal_document_id OR (fiscal_document_id IS NULL AND p_fiscal_document_id IS NULL))
          AND tenant_id = p_tenant_id;
        INSERT INTO public.proof_of_delivery (
            tenant_id, dispatch_stop_id, fiscal_document_id, receiver_name, receiver_document,
            received_at, photo_url, signature_url, latitude, longitude, accuracy, content_hash, version, created_by
        ) VALUES (
            p_tenant_id, p_dispatch_stop_id, p_fiscal_document_id, p_pod_data->>'receiver_name', p_pod_data->>'receiver_tax_id',
            COALESCE((p_pod_data->>'signed_at')::timestamp with time zone, now()), p_pod_data->>'photo_url', p_pod_data->>'signature_url',
            (p_pod_data->>'latitude')::numeric, (p_pod_data->>'longitude')::numeric, (p_pod_data->>'accuracy')::numeric, v_content_hash,
            COALESCE((SELECT max(version) + 1 FROM public.proof_of_delivery WHERE dispatch_stop_id = p_dispatch_stop_id), 1), v_user_id
        ) RETURNING id INTO v_pod_id;
    END IF;

    INSERT INTO public.operational_events (
        tenant_id, event_type, dispatch_stop_id, proof_of_delivery_id, payload, idempotency_key, created_by
    ) VALUES (
        p_tenant_id, p_event_type, p_dispatch_stop_id, v_pod_id, p_payload, p_idempotency_key, v_user_id
    ) RETURNING id INTO v_event_id;

    IF p_event_type IN ('delivery_success', 'delivery_failure') THEN
        INSERT INTO public.delivery_occurrences (
            tenant_id, fiscal_document_id, dispatch_stop_id, occurrence_type, occurrence_description, status, created_by
        ) VALUES (
            p_tenant_id, p_fiscal_document_id, p_dispatch_stop_id, p_event_type, p_payload->>'description',
            CASE WHEN p_event_type = 'delivery_success' THEN 'completed' ELSE 'pending' END, v_user_id
        );
    END IF;

    RETURN jsonb_build_object('status', 'success', 'event_id', v_event_id, 'pod_id', v_pod_id);
END;
$$;

-- Transition Machine: transition_trip_status_v1
CREATE OR REPLACE FUNCTION public.transition_trip_status_v1(p_tenant_id uuid, p_trip_id uuid, p_to_status text, p_actor_id uuid, p_reason text DEFAULT NULL, p_idempotency_key text DEFAULT NULL, p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_from_status text;
    v_allowed boolean := false;
BEGIN
    IF NOT public.is_tenant_operator_or_admin(p_tenant_id) AND 
       NOT EXISTS (SELECT 1 FROM public.dispatch_trips WHERE id = p_trip_id AND tenant_id = p_tenant_id AND driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())) THEN
        RAISE EXCEPTION 'Não autorizado a transicionar status desta viagem';
    END IF;

    -- Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT to_status INTO v_from_status FROM public.entity_state_audit_log 
        WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
        IF FOUND THEN RETURN v_from_status; END IF;
    END IF;

    -- Get current state
    SELECT status INTO v_from_status
    FROM public.dispatch_trips 
    WHERE id = p_trip_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Viagem não encontrada'; END IF;

    -- State Machine Logic
    CASE v_from_status
        WHEN 'planned' THEN v_allowed := p_to_status IN ('loading', 'in_transit', 'cancelled');
        WHEN 'loading' THEN v_allowed := p_to_status IN ('in_transit', 'cancelled');
        WHEN 'in_transit' THEN v_allowed := p_to_status IN ('completed', 'cancelled');
        ELSE v_allowed := false;
    END CASE;

    -- Override for Admins
    IF NOT v_allowed AND NOT public.is_tenant_admin(p_tenant_id) THEN
        RAISE EXCEPTION 'Transição de status inválida: % -> %', v_from_status, p_to_status;
    END IF;

    -- Update Trip
    UPDATE public.dispatch_trips 
    SET status = p_to_status, 
        updated_at = now(),
        actual_start_at = CASE WHEN p_to_status = 'in_transit' THEN COALESCE(actual_start_at, now()) ELSE actual_start_at END,
        actual_end_at = CASE WHEN p_to_status = 'completed' THEN now() ELSE actual_end_at END
    WHERE id = p_trip_id AND tenant_id = p_tenant_id;

    -- Audit Log
    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, from_status, to_status, actor_id, reason, idempotency_key, metadata
    ) VALUES (
        p_tenant_id, 'trip', p_trip_id, v_from_status, p_to_status, p_actor_id, p_reason, p_idempotency_key, p_metadata
    );

    RETURN p_to_status;
END;
$$;

-- 4. Revoke PUBLIC execute on all sensitive new RPCs and re-grant to authenticated only
REVOKE EXECUTE ON FUNCTION public.audit_data_consistency_v4(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.execute_data_repair_v1(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_ledger_entry_v1(uuid, text, uuid, text, text, numeric, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_operational_financial_summary_v1(uuid, date, date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_financial_obligation_v1(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reverse_financial_obligation_v1(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_operational_event_v2(uuid, text, uuid, uuid, jsonb, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_driver_workspace_v1(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.driver_report_event_v1(uuid, uuid, uuid, uuid, text, jsonb, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_trip_status_v1(uuid, uuid, text, uuid, text, text, jsonb) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.audit_data_consistency_v4(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_data_repair_v1(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_ledger_entry_v1(uuid, text, uuid, text, text, numeric, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_operational_financial_summary_v1(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_financial_obligation_v1(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_financial_obligation_v1(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_operational_event_v2(uuid, text, uuid, uuid, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_driver_workspace_v1(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_report_event_v1(uuid, uuid, uuid, uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_trip_status_v1(uuid, uuid, text, uuid, text, text, jsonb) TO authenticated;
