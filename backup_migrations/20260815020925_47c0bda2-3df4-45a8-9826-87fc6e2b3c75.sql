
-- 1. Limpeza de flags de emissão órfãs em fiscal_documents
UPDATE public.fiscal_documents fd
SET cte_emitted_at = NULL, 
    cte_emitted_outbound_id = NULL
WHERE fd.document_type = 'inbound'
  AND (fd.cte_emitted_at IS NOT NULL OR fd.cte_emitted_outbound_id IS NOT NULL)
  AND (
    NOT EXISTS (SELECT 1 FROM public.fiscal_documents outbound WHERE outbound.id = fd.cte_emitted_outbound_id)
    OR
    EXISTS (
      SELECT 1 FROM public.fiscal_documents outbound 
      WHERE outbound.id = fd.cte_emitted_outbound_id 
        AND outbound.status IN ('cancelled', 'rejected', 'error', 'failed')
    )
  );

-- 2. Limpeza de flags NFS-e órfãs (ajustado para array de UUID)
UPDATE public.fiscal_documents fd
SET nfse_emitted_at = NULL
WHERE fd.document_type = 'inbound'
  AND fd.nfse_emitted_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.nfse_documents n 
    WHERE n.tenant_id = fd.tenant_id 
      AND fd.id = ANY(n.fiscal_document_ids)
      AND n.status NOT IN ('cancelled', 'rejected', 'error', 'failed')
  );

-- 3. Excluir rascunhos 'fantasmas' de cte_documents
DELETE FROM public.cte_documents 
WHERE status IN ('cancelled', 'rejected', 'error', 'failed')
  AND tenant_id = '6e874e6e-5bca-486d-9928-bef0646989c4';

-- 4. Normalização de fornecedores (JMacêdo S/A na tabela clients)
UPDATE public.fiscal_documents fd
SET supplier_id = c.id
FROM public.clients c
WHERE fd.supplier_id IS NULL 
  AND fd.remitter_cnpj = c.tax_id 
  AND c.tax_id IN ('07450606000100', '07450606000959', '07450606001092');
