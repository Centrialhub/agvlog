-- Dados extraídos da migration 20260814225528_5919c890-36db-41d7-bef5-bb595a68c45e.sql
-- Motivo: DML com tenant_id fixo não pertence ao histórico reutilizável de schema.
-- Execução manual, opcional, apenas em ambientes que já possuem o tenant referenciado.

-- 1. Resetar as flags de faturamento das 13 notas no pool de faturamento
UPDATE public.fiscal_documents
SET cte_emitted_at = NULL,
    nfse_emitted_at = NULL,
    cte_emitted_outbound_id = NULL
WHERE tenant_id = '6e874e6e-5bca-486d-9928-bef0646989c4'
  AND invoice_number IN ('446069', '446072', '444798', '446070', '446071', '446083', '444796', '444797');

-- 2. Remover documentos de saída (CT-e e NFS-e) que contenham estas notas nos seus arrays
-- apenas se o status for de erro ou rascunho (não autorizados)
DELETE FROM public.cte_documents
WHERE tenant_id = '6e874e6e-5bca-486d-9928-bef0646989c4'
  AND status NOT IN ('authorized', 'issued')
  AND fiscal_document_ids && ARRAY[
    '33e4ccc5-9f05-4f75-8e96-b592cae916b0', -- 446069
    'aac1732d-38ef-4dc5-b383-50cbc4765cc7', -- 446072
    '843ee190-8754-45ab-a8eb-c39495b7bd77', -- 444798
    'c92b384f-5133-43dc-9cb3-9e286971c023', -- 446070
    '9c0c3172-90fa-4b7c-b85c-dc10c5f3a7fa', -- 446071
    '2b551faa-fdfa-4b7a-8bf7-049c1091fe57', -- 446083
    '9416904e-930d-4a36-942d-548c20d2479e', -- 444796
    '52e2bfd6-c6d4-4f5c-a183-c23ece5a1a0d'  -- 444797
  ]::uuid[];

DELETE FROM public.nfse_documents
WHERE tenant_id = '6e874e6e-5bca-486d-9928-bef0646989c4'
  AND status NOT IN ('authorized', 'issued')
  AND fiscal_document_ids && ARRAY[
    '33e4ccc5-9f05-4f75-8e96-b592cae916b0',
    'aac1732d-38ef-4dc5-b383-50cbc4765cc7',
    '843ee190-8754-45ab-a8eb-c39495b7bd77',
    'c92b384f-5133-43dc-9cb3-9e286971c023',
    '9c0c3172-90fa-4b7c-b85c-dc10c5f3a7fa',
    '2b551faa-fdfa-4b7a-8bf7-049c1091fe57',
    '9416904e-930d-4a36-942d-548c20d2479e',
    '52e2bfd6-c6d4-4f5c-a183-c23ece5a1a0d'
  ]::uuid[];

-- 3. Limpar hub_fiscal_emissions travados em 'processing' ou erro para este tenant
DELETE FROM public.hub_fiscal_emissions
WHERE tenant_id = '6e874e6e-5bca-486d-9928-bef0646989c4'
  AND status NOT IN ('authorized', 'cancelled', 'rejected')
  AND created_at < NOW() - INTERVAL '1 hour';
