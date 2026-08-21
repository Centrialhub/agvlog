ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS cte_emitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cte_emitted_outbound_id UUID,
  -- drift corrigido: colunas de saída NFS-e existiam no banco sem DDL no histórico
  ADD COLUMN IF NOT EXISTS nfse_emitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nfse_emitted_document_id UUID;

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_cte_emitted_at
  ON public.fiscal_documents (tenant_id, cte_emitted_at)
  WHERE cte_emitted_at IS NOT NULL;