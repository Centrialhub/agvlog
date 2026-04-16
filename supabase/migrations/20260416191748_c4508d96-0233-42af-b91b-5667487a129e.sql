-- Limpa documentos fiscais e dependências
UPDATE public.load_items SET fiscal_document_id = NULL WHERE fiscal_document_id IS NOT NULL;
DELETE FROM public.freight_calculation_log WHERE entity_type = 'fiscal_document';
DELETE FROM public.fiscal_documents;