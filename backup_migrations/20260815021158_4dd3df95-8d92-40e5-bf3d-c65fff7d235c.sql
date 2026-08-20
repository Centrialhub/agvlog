UPDATE fiscal_documents 
SET supplier_id = '69575de8-a391-48ce-ae9f-7fd282272413', 
    cte_emitted_at = NULL, 
    nfse_emitted_at = NULL 
WHERE invoice_number IN ('444798', '444797', '444796', '446083', '446072', '446071', '446070', '446069') 
  AND tenant_id = '6e874e6e-5bca-486d-9928-bef0646989c4';