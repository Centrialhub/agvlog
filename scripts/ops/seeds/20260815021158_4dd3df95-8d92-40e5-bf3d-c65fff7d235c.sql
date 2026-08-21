-- Dados extraídos da migration 20260815021158_4dd3df95-8d92-40e5-bf3d-c65fff7d235c.sql
-- Motivo: DML com tenant_id fixo não pertence ao histórico reutilizável de schema.
-- Execução manual, opcional, apenas em ambientes que já possuem o tenant referenciado.

UPDATE fiscal_documents 
SET supplier_id = '69575de8-a391-48ce-ae9f-7fd282272413', 
    cte_emitted_at = NULL, 
    nfse_emitted_at = NULL 
WHERE invoice_number IN ('444798', '444797', '444796', '446083', '446072', '446071', '446070', '446069') 
  AND tenant_id = '6e874e6e-5bca-486d-9928-bef0646989c4';