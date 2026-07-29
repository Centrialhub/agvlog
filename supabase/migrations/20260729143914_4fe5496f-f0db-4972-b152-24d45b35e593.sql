ALTER TABLE public.nfse_documents
  ADD COLUMN IF NOT EXISTS fiscal_document_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];

ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS nfse_emitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nfse_emitted_document_id UUID;

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_nfse_emitted
  ON public.fiscal_documents (tenant_id)
  WHERE nfse_emitted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_nfse_documents_fiscal_docs
  ON public.nfse_documents USING GIN (fiscal_document_ids);