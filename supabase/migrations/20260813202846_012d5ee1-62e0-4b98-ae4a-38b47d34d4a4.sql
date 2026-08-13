
CREATE OR REPLACE FUNCTION public.delete_load_if_empty(v_load_id UUID)
RETURNS VOID AS $$
DECLARE
    v_doc_count INT;
    v_tenant_id UUID;
BEGIN
    IF v_load_id IS NULL THEN
        RETURN;
    END IF;

    -- Count active fiscal documents for this load
    SELECT count(*) INTO v_doc_count
    FROM public.fiscal_documents
    WHERE load_id = v_load_id 
      AND deleted_at IS NULL 
      AND status <> 'deleted';

    IF v_doc_count = 0 THEN
        SELECT tenant_id INTO v_tenant_id FROM public.loads WHERE id = v_load_id;
        
        IF v_tenant_id IS NOT NULL THEN
            -- delete_load_safely handles unlinking remaining items and deleting the load
            PERFORM public.delete_load_safely(v_tenant_id, v_load_id);
        END IF;
    END IF;
EXCEPTION WHEN OTHERS THEN
    NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-run cleanup for any currently empty loads in the system
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT l.id, l.tenant_id 
        FROM public.loads l
        LEFT JOIN public.fiscal_documents fd ON fd.load_id = l.id AND fd.deleted_at IS NULL AND fd.status <> 'deleted'
        WHERE fd.id IS NULL
    LOOP
        PERFORM public.delete_load_if_empty(r.id);
    END LOOP;
END;
$$;
