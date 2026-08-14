-- 1) Restaura notas de entrada excluídas em massa que nunca foram faturadas
UPDATE public.fiscal_documents f
SET deleted_at = NULL, updated_at = now()
WHERE f.document_type = 'inbound'
  AND f.deleted_at IS NOT NULL
  AND f.cte_emitted_at IS NULL
  AND f.nfse_emitted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.cte_documents c
    WHERE f.id = ANY(c.fiscal_document_ids)
      AND c.status IN ('authorized','issued','processing','transmitted','cancelling')
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.nfse_documents n
    WHERE f.id = ANY(n.fiscal_document_ids)
      AND n.status IN ('authorized','issued','processed','processing','transmitted')
  );

-- 2) Libera notas marcadas como CT-e emitido sem CT-e válido existente
UPDATE public.fiscal_documents f
SET cte_emitted_at = NULL, cte_emitted_outbound_id = NULL, updated_at = now()
WHERE f.document_type = 'inbound'
  AND f.cte_emitted_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.cte_documents c
    WHERE f.id = ANY(c.fiscal_document_ids)
      AND c.status IN ('authorized','issued','processing','transmitted','cancelling')
  );

-- 3) Libera notas marcadas como NFS-e emitida sem NFS-e válida existente
UPDATE public.fiscal_documents f
SET nfse_emitted_at = NULL, nfse_emitted_document_id = NULL, updated_at = now()
WHERE f.document_type = 'inbound'
  AND f.nfse_emitted_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.nfse_documents n
    WHERE f.id = ANY(n.fiscal_document_ids)
      AND n.status IN ('authorized','issued','processed','processing','transmitted')
  );
