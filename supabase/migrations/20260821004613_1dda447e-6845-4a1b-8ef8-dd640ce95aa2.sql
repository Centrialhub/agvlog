CREATE OR REPLACE FUNCTION public.recalculate_load_totals(p_tenant_id uuid, p_load_id uuid)
RETURNS void AS $$
BEGIN
    UPDATE public.loads
    SET 
        total_weight_kg = COALESCE((SELECT SUM(weight_kg) FROM public.load_items WHERE load_id = p_load_id AND tenant_id = p_tenant_id), 0),
        total_volume_m3 = COALESCE((SELECT SUM(volume_m3) FROM public.load_items WHERE load_id = p_load_id AND tenant_id = p_tenant_id), 0),
        total_pallet_count = COALESCE((SELECT SUM(pallet_count) FROM public.load_items WHERE load_id = p_load_id AND tenant_id = p_tenant_id), 0)
    WHERE id = p_load_id AND tenant_id = p_tenant_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.upsert_load_item_v1(
    p_tenant_id uuid,
    p_load_id uuid,
    p_item_id uuid DEFAULT NULL,
    p_item_description text DEFAULT '',
    p_quantity numeric DEFAULT 0,
    p_pallet_count numeric DEFAULT 0,
    p_weight_kg numeric DEFAULT 0,
    p_volume_m3 numeric DEFAULT 0,
    p_fiscal_document_id uuid DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
    v_item_id uuid;
BEGIN
    -- Ownership check for load
    IF NOT EXISTS (SELECT 1 FROM public.loads WHERE id = p_load_id AND tenant_id = p_tenant_id) THEN
        RAISE EXCEPTION 'Load does not belong to tenant';
    END IF;

    -- Upsert logic
    IF p_item_id IS NULL THEN
        INSERT INTO public.load_items (
            tenant_id, load_id, item_description, quantity, pallet_count, weight_kg, volume_m3, fiscal_document_id
        ) VALUES (
            p_tenant_id, p_load_id, p_item_description, p_quantity, p_pallet_count, p_weight_kg, p_volume_m3, p_fiscal_document_id
        ) RETURNING id INTO v_item_id;
    ELSE
        -- Ownership check for item
        IF NOT EXISTS (SELECT 1 FROM public.load_items WHERE id = p_item_id AND tenant_id = p_tenant_id) THEN
            RAISE EXCEPTION 'Item does not belong to tenant';
        END IF;

        UPDATE public.load_items SET
            item_description = p_item_description,
            quantity = p_quantity,
            pallet_count = p_pallet_count,
            weight_kg = p_weight_kg,
            volume_m3 = p_volume_m3,
            fiscal_document_id = p_fiscal_document_id,
            updated_at = now()
        WHERE id = p_item_id AND tenant_id = p_tenant_id
        RETURNING id INTO v_item_id;
    END IF;

    -- Recalculate totals
    PERFORM public.recalculate_load_totals(p_tenant_id, p_load_id);

    RETURN v_item_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.delete_load_item_v1(
    p_tenant_id uuid,
    p_item_id uuid
)
RETURNS void AS $$
DECLARE
    v_load_id uuid;
BEGIN
    -- Get load_id and check ownership
    SELECT load_id INTO v_load_id FROM public.load_items WHERE id = p_item_id AND tenant_id = p_tenant_id;
    
    IF v_load_id IS NULL THEN
        RAISE EXCEPTION 'Item not found or does not belong to tenant';
    END IF;

    DELETE FROM public.load_items WHERE id = p_item_id AND tenant_id = p_tenant_id;

    -- Recalculate totals
    PERFORM public.recalculate_load_totals(p_tenant_id, v_load_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.upsert_load_item_v1(uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_load_item_v1(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_load_totals(uuid, uuid) TO authenticated;
