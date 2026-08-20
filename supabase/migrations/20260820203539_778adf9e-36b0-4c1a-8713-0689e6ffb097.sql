CREATE OR REPLACE FUNCTION public.move_load_items_v2(
    _tenant_id uuid,
    _source_load_id uuid,
    _target_load_id uuid,
    _document_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_res_unlink jsonb;
    v_res_link jsonb;
BEGIN
    -- Auth Guard
    IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'operator')) AND auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    IF _source_load_id = _target_load_id THEN
        RAISE EXCEPTION 'Source and target loads are the same';
    END IF;

    -- 1. Unlink from source (atomically within this TX)
    -- We bypass the check in link_v1 by doing it manually or modifying unlink
    -- But since they are separate functions, we can just call them if we relax the check or order them.
    
    -- Actually, let's just implement it directly for maximum control
    
    -- Lock Checks
    IF public._load_is_locked(_source_load_id) THEN RAISE EXCEPTION 'Source load is locked'; END IF;
    IF public._load_is_locked(_target_load_id) THEN RAISE EXCEPTION 'Target load is locked'; END IF;

    -- Unlink
    PERFORM public.unlink_fiscal_documents_from_load_v1(_tenant_id, _source_load_id, _document_ids);
    
    -- Link
    PERFORM public.link_fiscal_documents_to_load_v1(_tenant_id, _target_load_id, _document_ids);

    RETURN jsonb_build_object('success', true, 'moved_count', array_length(_document_ids, 1));
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_load_items_v2(uuid, uuid, uuid, uuid[]) TO authenticated;
