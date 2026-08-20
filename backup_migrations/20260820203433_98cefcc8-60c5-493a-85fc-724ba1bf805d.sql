-- [Load Composition Architecture v1]
-- This migration establishes load_items as the single source of truth (SoT)

-- 1. Unified Read Model
CREATE OR REPLACE VIEW public.vw_load_composition AS
SELECT 
    li.id as item_id,
    li.tenant_id,
    li.load_id,
    li.fiscal_document_id,
    li.order_id,
    li.item_description,
    li.quantity,
    li.pallet_count,
    li.weight_kg,
    li.volume_m3,
    li.status as item_status,
    fd.invoice_number,
    fd.access_key,
    fd.value as document_value,
    fd.remitter,
    fd.recipient,
    fd.recipient_city,
    fd.recipient_state,
    o.order_number,
    l.load_number,
    l.status as load_status
FROM public.load_items li
JOIN public.loads l ON l.id = li.load_id
LEFT JOIN public.fiscal_documents fd ON fd.id = li.fiscal_document_id
LEFT JOIN public.orders o ON o.id = li.order_id;

GRANT SELECT ON public.vw_load_composition TO authenticated;
GRANT ALL ON public.vw_load_composition TO service_role;

-- 2. Recalculation Helper
CREATE OR REPLACE FUNCTION public._recalculate_load_totals(_load_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
BEGIN
    UPDATE public.loads l
    SET 
        total_pallet_count = COALESCE((SELECT sum(pallet_count) FROM public.load_items WHERE load_id = _load_id), 0),
        total_weight_kg = COALESCE((SELECT sum(weight_kg) FROM public.load_items WHERE load_id = _load_id), 0),
        total_volume_m3 = COALESCE((SELECT sum(volume_m3) FROM public.load_items WHERE load_id = _load_id), 0),
        updated_at = now()
    WHERE l.id = _load_id;
END;
$$;

-- 3. Link RPC
CREATE OR REPLACE FUNCTION public.link_fiscal_documents_to_load_v1(
    _tenant_id uuid,
    _load_id uuid,
    _document_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
    v_doc_id uuid;
    v_updated_count int := 0;
    v_audit_old jsonb;
    v_audit_new jsonb;
BEGIN
    -- Auth Guard
    IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator')) AND auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- Existence Check
    IF NOT EXISTS (SELECT 1 FROM public.loads WHERE id = _load_id AND tenant_id = _tenant_id) THEN
        RAISE EXCEPTION 'Load not found or unauthorized';
    END IF;

    -- Lock Check
    IF public._load_is_locked(_load_id) THEN
        RAISE EXCEPTION 'Load is locked and cannot be modified';
    END IF;

    -- Transactional Linkage
    FOREACH v_doc_id IN ARRAY _document_ids LOOP
        -- Skip if already linked to this load
        IF EXISTS (SELECT 1 FROM public.load_items WHERE load_id = _load_id AND fiscal_document_id = v_doc_id) THEN
            CONTINUE;
        END IF;

        -- Verify ownership and availability
        IF NOT EXISTS (SELECT 1 FROM public.fiscal_documents WHERE id = v_doc_id AND tenant_id = _tenant_id) THEN
            RAISE EXCEPTION 'Document % not found or unauthorized', v_doc_id;
        END IF;

        -- Check if linked elsewhere
        IF EXISTS (SELECT 1 FROM public.fiscal_documents WHERE id = v_doc_id AND load_id IS NOT NULL AND load_id <> _load_id) THEN
             RAISE EXCEPTION 'Document % is already linked to another load', v_doc_id;
        END IF;

        -- Capture audit state
        SELECT jsonb_build_object('load_id', load_id) INTO v_audit_old FROM public.fiscal_documents WHERE id = v_doc_id;

        -- Link Projection 1: fiscal_documents
        UPDATE public.fiscal_documents 
        SET load_id = _load_id, updated_at = now() 
        WHERE id = v_doc_id;

        -- Link SoT: load_items
        INSERT INTO public.load_items (
            tenant_id, load_id, fiscal_document_id, item_description, 
            pallet_count, weight_kg, volume_m3, status
        )
        SELECT 
            _tenant_id, _load_id, id, 
            COALESCE(product_summary, 'Doc ' || invoice_number),
            COALESCE(pallet_count, 0), COALESCE(weight_kg, 0), 0, 'pending'
        FROM public.fiscal_documents
        WHERE id = v_doc_id
        ON CONFLICT (load_id, fiscal_document_id) DO NOTHING;

        -- Link Projection 2: load_documents (join table mirror)
        INSERT INTO public.load_documents (tenant_id, load_id, fiscal_document_id)
        VALUES (_tenant_id, _load_id, v_doc_id)
        ON CONFLICT (load_id, fiscal_document_id) DO NOTHING;

        v_audit_new := jsonb_build_object('load_id', _load_id);
        
        PERFORM public._log_entity_audit(
            _tenant_id, 'fiscal_document', v_doc_id, 'link_to_load', 
            v_audit_old, v_audit_new, 'composition_rpc'
        );

        v_updated_count := v_updated_count + 1;
    END LOOP;

    -- Recalculate
    PERFORM public._recalculate_load_totals(_load_id);

    RETURN jsonb_build_object('success', true, 'linked_count', v_updated_count);
END;
$$;

-- 4. Unlink RPC
CREATE OR REPLACE FUNCTION public.unlink_fiscal_documents_from_load_v1(
    _tenant_id uuid,
    _load_id uuid,
    _document_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
    v_doc_id uuid;
    v_removed_count int := 0;
BEGIN
    -- Auth Guard
    IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator')) AND auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- Lock Check
    IF public._load_is_locked(_load_id) THEN
        RAISE EXCEPTION 'Load is locked and cannot be modified';
    END IF;

    FOREACH v_doc_id IN ARRAY _document_ids LOOP
        -- SoT Update
        DELETE FROM public.load_items 
        WHERE load_id = _load_id AND fiscal_document_id = v_doc_id;
        
        -- Projection 1
        UPDATE public.fiscal_documents 
        SET load_id = NULL, updated_at = now() 
        WHERE id = v_doc_id AND load_id = _load_id;

        -- Projection 2
        DELETE FROM public.load_documents 
        WHERE load_id = _load_id AND fiscal_document_id = v_doc_id;

        PERFORM public._log_entity_audit(
            _tenant_id, 'fiscal_document', v_doc_id, 'unlink_from_load', 
            jsonb_build_object('load_id', _load_id), jsonb_build_object('load_id', null), 
            'composition_rpc'
        );

        v_removed_count := v_removed_count + 1;
    END LOOP;

    -- Recalculate
    PERFORM public._recalculate_load_totals(_load_id);

    RETURN jsonb_build_object('success', true, 'unlinked_count', v_removed_count);
END;
$$;

-- 5. Diagnostic RPC
CREATE OR REPLACE FUNCTION public.diagnose_load_composition(
    _tenant_id uuid,
    _load_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
    load_id uuid,
    load_number text,
    entity_id uuid,
    entity_type text,
    issue text,
    severity text
)
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    RETURN QUERY
    -- Discrepancy: load_items SoT missing in fiscal_documents projection
    SELECT 
        l.id, l.load_number, li.fiscal_document_id, 'fiscal_document'::text,
        'SoT exists in load_items but projection missing in fiscal_documents'::text, 'high'::text
    FROM public.load_items li
    JOIN public.loads l ON l.id = li.load_id
    LEFT JOIN public.fiscal_documents fd ON fd.id = li.fiscal_document_id
    WHERE li.tenant_id = _tenant_id
      AND li.fiscal_document_id IS NOT NULL
      AND (fd.load_id IS NULL OR fd.load_id <> li.load_id)
      AND (_load_ids IS NULL OR li.load_id = ANY(_load_ids))

    UNION ALL

    -- Discrepancy: fiscal_documents has load_id but missing in load_items SoT
    SELECT 
        l.id, l.load_number, fd.id, 'fiscal_document'::text,
        'Projection exists in fiscal_documents but SoT missing in load_items'::text, 'high'::text
    FROM public.fiscal_documents fd
    JOIN public.loads l ON l.id = fd.load_id
    LEFT JOIN public.load_items li ON li.fiscal_document_id = fd.id AND li.load_id = fd.load_id
    WHERE fd.tenant_id = _tenant_id
      AND fd.load_id IS NOT NULL
      AND li.id IS NULL
      AND (_load_ids IS NULL OR fd.load_id = ANY(_load_ids))
    
    UNION ALL
    
    -- Totals discrepancy
    SELECT 
        l.id, l.load_number, l.id, 'load'::text,
        'Totals discrepancy (recalc needed)'::text, 'medium'::text
    FROM public.loads l
    WHERE l.tenant_id = _tenant_id
      AND (_load_ids IS NULL OR l.id = ANY(_load_ids))
      AND (
          l.total_pallet_count <> COALESCE((SELECT sum(pallet_count) FROM public.load_items WHERE load_id = l.id), 0)
          OR l.total_weight_kg <> COALESCE((SELECT sum(weight_kg) FROM public.load_items WHERE load_id = l.id), 0)
      );
END;
$$;

-- 6. Repair RPC
CREATE OR REPLACE FUNCTION public.repair_load_composition(
    _tenant_id uuid,
    _load_ids uuid[],
    _dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
    v_load_id uuid;
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    IF _dry_run THEN
        RETURN jsonb_build_object('dry_run', true, 'issues', (SELECT jsonb_agg(t) FROM public.diagnose_load_composition(_tenant_id, _load_ids) t));
    END IF;

    FOREACH v_load_id IN ARRAY _load_ids LOOP
        -- 1. Sync fiscal_documents to load_items (SoT wins)
        UPDATE public.fiscal_documents fd
        SET load_id = li.load_id
        FROM public.load_items li
        WHERE li.fiscal_document_id = fd.id
          AND li.load_id = v_load_id
          AND fd.tenant_id = _tenant_id
          AND (fd.load_id IS NULL OR fd.load_id <> v_load_id);

        -- 2. Clean up dangling fiscal_documents links
        UPDATE public.fiscal_documents fd
        SET load_id = NULL
        WHERE fd.load_id = v_load_id
          AND fd.tenant_id = _tenant_id
          AND NOT EXISTS (SELECT 1 FROM public.load_items li WHERE li.fiscal_document_id = fd.id AND li.load_id = v_load_id);
          
        -- 3. Sync load_documents join table
        DELETE FROM public.load_documents WHERE load_id = v_load_id;
        INSERT INTO public.load_documents (tenant_id, load_id, fiscal_document_id)
        SELECT li.tenant_id, li.load_id, li.fiscal_document_id
        FROM public.load_items li
        WHERE li.load_id = v_load_id AND li.fiscal_document_id IS NOT NULL;

        -- 4. Recalculate totals
        PERFORM public._recalculate_load_totals(v_load_id);
    END LOOP;

    RETURN jsonb_build_object('success', true, 'repaired_loads', array_length(_load_ids, 1));
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_fiscal_documents_to_load_v1(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_fiscal_documents_from_load_v1(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.diagnose_load_composition(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repair_load_composition(uuid, uuid[], boolean) TO authenticated;
