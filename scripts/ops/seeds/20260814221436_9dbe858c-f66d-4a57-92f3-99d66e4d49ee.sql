-- Dados extraídos da migration 20260814221436_9dbe858c-f66d-4a57-92f3-99d66e4d49ee.sql
-- Motivo: DML com tenant_id fixo não pertence ao histórico reutilizável de schema.
-- Execução manual, opcional, apenas em ambientes que já possuem o tenant referenciado.


-- Executa a limpeza de flags órfãs e garante integridade
-- 1. Remove flags de CT-e de notas cujos documentos de saída não existem ou foram anulados
UPDATE public.fiscal_documents f
SET cte_emitted_at = NULL, cte_emitted_outbound_id = NULL
WHERE f.tenant_id = '6e874e6e-5bca-486d-9928-bef0646989c4'
  AND f.cte_emitted_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.cte_documents c 
    WHERE c.id = f.cte_emitted_outbound_id 
    AND c.status NOT IN ('cancelled', 'rejected', 'error', 'cancelado', 'rejeitado', 'erro')
    UNION ALL
    SELECT 1 FROM public.fiscal_documents o
    WHERE o.id = f.cte_emitted_outbound_id
    AND o.document_type = 'outbound'
    AND o.status NOT IN ('cancelled', 'rejected', 'error', 'cancelado', 'rejeitado', 'erro')
  );

-- 2. Remove flags de NFS-e de notas cujos documentos de saída não existem ou foram anulados
UPDATE public.fiscal_documents f
SET nfse_emitted_at = NULL, nfse_emitted_document_id = NULL
WHERE f.tenant_id = '6e874e6e-5bca-486d-9928-bef0646989c4'
  AND f.nfse_emitted_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.nfse_documents n 
    WHERE n.id = f.nfse_emitted_document_id 
    AND n.status NOT IN ('cancelled', 'rejected', 'error', 'cancelado', 'rejeitado', 'erro')
  );

-- 3. Caso existam notas vinculadas a documentos autorizados que por algum motivo não têm a flag (prevenção de duplicidade)
UPDATE public.fiscal_documents f
SET cte_emitted_at = NOW(), cte_emitted_outbound_id = c.id
FROM public.cte_documents c
WHERE f.id = ANY(c.fiscal_document_ids)
  AND c.status IN ('issued', 'authorized', 'autorizado', 'processed')
  AND f.cte_emitted_at IS NULL
  AND f.tenant_id = '6e874e6e-5bca-486d-9928-bef0646989c4';

UPDATE public.fiscal_documents f
SET nfse_emitted_at = NOW(), nfse_emitted_document_id = n.id
FROM public.nfse_documents n
WHERE f.id = ANY(n.fiscal_document_ids)
  AND n.status IN ('issued', 'authorized', 'autorizado')
  AND f.nfse_emitted_at IS NULL
  AND f.tenant_id = '6e874e6e-5bca-486d-9928-bef0646989c4';
