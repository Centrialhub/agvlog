
-- Migration to automatically delete empty loads when a fiscal document is unlinked or deleted.
-- Includes a trigger to monitor the loads table and a function to clean up orphan loads.

-- 1. Create a function to delete a load if it has no associated fiscal documents.
CREATE OR REPLACE FUNCTION public.delete_load_if_empty(v_load_id UUID)
RETURNS VOID AS $$
DECLARE
    v_doc_count INT;
    v_tenant_id UUID;
BEGIN
    -- Only check if load_id is provided
    IF v_load_id IS NULL THEN
        RETURN;
    END IF;

    -- Count active (not deleted) fiscal documents for this load
    SELECT count(*) INTO v_doc_count
    FROM public.fiscal_documents
    WHERE load_id = v_load_id AND (deleted_at IS NULL OR status <> 'deleted');

    -- If no documents are linked, attempt to delete the load safely
    IF v_doc_count = 0 THEN
        -- Get tenant_id for the log/auth check if needed, though we use SECURITY DEFINER
        SELECT tenant_id INTO v_tenant_id FROM public.loads WHERE id = v_load_id;
        
        IF v_tenant_id IS NOT NULL THEN
            -- We use the existing delete_load_safely which handles safety checks
            -- such as checking for PODs, trips, and critical occurrences.
            PERFORM public.delete_load_safely(v_tenant_id, v_load_id);
        END IF;
    END IF;
EXCEPTION WHEN OTHERS THEN
    -- Silently fail to avoid blocking the main transaction
    NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create a trigger function for fiscal_documents
CREATE OR REPLACE FUNCTION public.trg_handle_empty_load_on_doc_change()
RETURNS TRIGGER AS $$
BEGIN
    -- If it's an UPDATE that changed load_id, check the OLD load_id
    IF TG_OP = 'UPDATE' THEN
        IF OLD.load_id IS NOT NULL AND (NEW.load_id IS NULL OR NEW.load_id <> OLD.load_id OR NEW.status = 'deleted') THEN
            PERFORM public.delete_load_if_empty(OLD.load_id);
        END IF;
    -- If it's a DELETE, check the OLD load_id
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.load_id IS NOT NULL THEN
            PERFORM public.delete_load_if_empty(OLD.load_id);
        END IF;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 3. Attach the trigger to fiscal_documents
DROP TRIGGER IF EXISTS trg_cleanup_empty_loads ON public.fiscal_documents;
CREATE TRIGGER trg_cleanup_empty_loads
AFTER UPDATE OR DELETE ON public.fiscal_documents
FOR EACH ROW
EXECUTE FUNCTION public.trg_handle_empty_load_on_doc_change();

-- 4. Grant permissions
GRANT EXECUTE ON FUNCTION public.delete_load_if_empty(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_load_if_empty(UUID) TO service_role;
