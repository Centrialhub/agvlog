-- Desvincula fiscal_documents de load_items (se existir a coluna)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='load_items' AND column_name='fiscal_document_id') THEN
    EXECUTE 'UPDATE public.load_items SET fiscal_document_id = NULL WHERE fiscal_document_id IS NOT NULL';
  END IF;
END $$;

-- Remove logs de cálculo de frete vinculados a fiscal_documents
DELETE FROM public.freight_calculation_log WHERE entity_type = 'fiscal_document';

-- Limpa todos os documentos fiscais
DELETE FROM public.fiscal_documents;