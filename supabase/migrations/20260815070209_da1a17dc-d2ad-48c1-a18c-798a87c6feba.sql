UPDATE public.fiscal_documents
SET deleted_at = NOW()
WHERE document_type = 'inbound'
  AND (supplier_id IS DISTINCT FROM '69575de8-a391-48ce-ae9f-7fd282272413' OR supplier_id IS NULL)
  AND (client_id IS DISTINCT FROM '69575de8-a391-48ce-ae9f-7fd282272413' OR client_id IS NULL)
  AND deleted_at IS NULL;