-- Fix for notes appearing in billing despite being linked to an authorized CT-e.
DO $$ 
DECLARE
    v_count integer;
BEGIN
    -- Update inbound documents that are linked to authorized outbound documents but missing the emitted flags
    WITH linked_docs AS (
        SELECT 
            inbound.id as inbound_id,
            outbound.id as outbound_id,
            outbound.created_at as emitted_at
        FROM public.fiscal_documents inbound
        JOIN public.fiscal_documents outbound ON inbound.cte_emitted_outbound_id = outbound.id
        WHERE inbound.document_type = 'inbound'
          AND outbound.document_type = 'outbound'
          AND outbound.status = 'authorized'
          AND (inbound.cte_emitted_at IS NULL OR inbound.cte_emitted_outbound_id IS NULL)
    )
    UPDATE public.fiscal_documents f
    SET 
        cte_emitted_at = ld.emitted_at,
        cte_emitted_outbound_id = ld.outbound_id
    FROM linked_docs ld
    WHERE f.id = ld.inbound_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Updated % inbound documents based on direct links.', v_count;

    -- Update based on active cte_documents
    WITH consumed_docs AS (
        SELECT DISTINCT 
            unnest(fiscal_document_ids) as doc_id,
            created_at
        FROM public.cte_documents
        WHERE status != 'cancelled'
    )
    UPDATE public.fiscal_documents f
    SET cte_emitted_at = cd.created_at
    FROM consumed_docs cd
    WHERE f.id = cd.doc_id
      AND f.document_type = 'inbound'
      AND f.cte_emitted_at IS NULL;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RAISE NOTICE 'Updated % inbound documents based on active cte_documents.', v_count;
END $$;