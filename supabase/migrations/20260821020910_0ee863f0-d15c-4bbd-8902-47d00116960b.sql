-- Migration: Safe Load Item Composition V2
-- Forward-only stabilization of load items and fiscal document mirroring.

-- 1. Secure recalculate_load_totals (make it internal)
REVOKE EXECUTE ON FUNCTION public.recalculate_load_totals(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recalculate_load_totals(uuid, uuid) FROM authenticated;
ALTER FUNCTION public.recalculate_load_totals(uuid, uuid) SECURITY DEFINER;
ALTER FUNCTION public.recalculate_load_totals(uuid, uuid) SET search_path = public;

-- 2. Secure upsert_load_item_v2
CREATE OR REPLACE FUNCTION public.upsert_load_item_v2(
    p_tenant_id uuid,
    p_load_id uuid,
    p_item_id uuid DEFAULT NULL,
    p_item_description text DEFAULT NULL,
    p_quantity numeric DEFAULT 0,
    p_pallet_count numeric DEFAULT 0,
    p_weight_kg numeric DEFAULT 0,
    p_volume_m3 numeric DEFAULT 0,
    p_fiscal_document_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_operator_id uuid := auth.uid();
    v_actual_item_id uuid := p_item_id;
    v_old_load_id uuid;
BEGIN
    -- 1. Authorization
    IF NOT EXISTS (
        SELECT 1 FROM public.tenant_memberships
        WHERE user_id = v_operator_id 
          AND tenant_id = p_tenant_id
          AND role IN ('owner', 'admin', 'operator')
    ) THEN
        RAISE EXCEPTION 'Unauthorized: User is not an operator for this tenant';
    END IF;

    -- 2. Validate Load Ownership
    IF NOT EXISTS (
        SELECT 1 FROM public.loads 
        WHERE id = p_load_id AND tenant_id = p_tenant_id
    ) THEN
        RAISE EXCEPTION 'Invalid load for tenant';
    END IF;

    -- 3. Validate Fiscal Document (if provided)
    IF p_fiscal_document_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.fiscal_documents
            WHERE id = p_fiscal_document_id AND tenant_id = p_tenant_id
        ) THEN
            RAISE EXCEPTION 'Invalid fiscal document for tenant';
        END IF;
    END IF;

    -- 4. Upsert with atomic ownership validation
    IF v_actual_item_id IS NOT NULL THEN
        -- Update Case: Validate id, tenant, and original load (atomic lock)
        UPDATE public.load_items
        SET 
            item_description = COALESCE(p_item_description, item_description),
            quantity = p_quantity,
            pallet_count = p_pallet_count,
            weight_kg = p_weight_kg,
            volume_m3 = p_volume_m3,
            fiscal_document_id = p_fiscal_document_id,
            updated_at = now()
        WHERE id = v_actual_item_id 
          AND tenant_id = p_tenant_id 
          AND load_id = p_load_id
        RETURNING load_id INTO v_old_load_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Load item not found or does not belong to the specified load/tenant';
        END IF;
    ELSE
        -- Insert Case
        INSERT INTO public.load_items (
            tenant_id,
            load_id,
            item_description,
            quantity,
            pallet_count,
            weight_kg,
            volume_m3,
            fiscal_document_id
        ) VALUES (
            p_tenant_id,
            p_load_id,
            p_item_description,
            p_quantity,
            p_pallet_count,
            p_weight_kg,
            p_volume_m3,
            p_fiscal_document_id
        ) RETURNING id INTO v_actual_item_id;
    END IF;

    -- 5. Atomic Mirroring to fiscal_documents
    -- load_items is SoT, fiscal_documents.load_id is the mirror
    IF p_fiscal_document_id IS NOT NULL THEN
        UPDATE public.fiscal_documents
        SET load_id = p_load_id
        WHERE id = p_fiscal_document_id 
          AND tenant_id = p_tenant_id;
    END IF;

    -- 6. Recalculate Totals (Atomic internally)
    PERFORM public.recalculate_load_totals(p_tenant_id, p_load_id);

    RETURN v_actual_item_id;
END;
$$;

-- 3. Secure delete_load_item_v2
CREATE OR REPLACE FUNCTION public.delete_load_item_v2(
    p_tenant_id uuid,
    p_item_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_operator_id uuid := auth.uid();
    v_load_id uuid;
    v_fiscal_document_id uuid;
BEGIN
    -- 1. Authorization
    IF NOT EXISTS (
        SELECT 1 FROM public.tenant_memberships
        WHERE user_id = v_operator_id 
          AND tenant_id = p_tenant_id
          AND role IN ('owner', 'admin', 'operator')
    ) THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- 2. Find and Lock item (atomic ownership check)
    DELETE FROM public.load_items
    WHERE id = p_item_id AND tenant_id = p_tenant_id
    RETURNING load_id, fiscal_document_id INTO v_load_id, v_fiscal_document_id;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- 3. Update mirror (remove load link from doc)
    IF v_fiscal_document_id IS NOT NULL THEN
        UPDATE public.fiscal_documents
        SET load_id = NULL
        WHERE id = v_fiscal_document_id AND tenant_id = p_tenant_id;
    END IF;

    -- 4. Recalculate Totals
    PERFORM public.recalculate_load_totals(p_tenant_id, v_load_id);

    RETURN TRUE;
END;
$$;

-- 4. Permissions
REVOKE ALL ON public.load_items FROM PUBLIC;
REVOKE ALL ON public.load_items FROM authenticated;
REVOKE ALL ON public.load_items FROM anon;
GRANT SELECT ON public.load_items TO authenticated;
GRANT ALL ON public.load_items TO service_role;

GRANT EXECUTE ON FUNCTION public.upsert_load_item_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_load_item_v2 TO authenticated;
