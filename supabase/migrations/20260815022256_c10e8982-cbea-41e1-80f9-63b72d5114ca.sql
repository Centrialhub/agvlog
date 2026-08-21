
UPDATE public.fiscal_documents
SET nfse_emitted_at = NULL, cte_emitted_at = NULL
WHERE invoice_number IN ('446064', '446067', '446065')
  AND tenant_id = '6e874e6e-5bca-486d-9928-bef0646989c4';
