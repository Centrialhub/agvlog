-- Dados extraídos da migration 20260815022256_c10e8982-cbea-41e1-80f9-63b72d5114ca.sql
-- Motivo: DML com tenant_id fixo não pertence ao histórico reutilizável de schema.
-- Execução manual, opcional, apenas em ambientes que já possuem o tenant referenciado.


UPDATE public.fiscal_documents
SET nfse_emitted_at = NULL, cte_emitted_at = NULL
WHERE invoice_number IN ('446064', '446067', '446065')
  AND tenant_id = '6e874e6e-5bca-486d-9928-bef0646989c4';
