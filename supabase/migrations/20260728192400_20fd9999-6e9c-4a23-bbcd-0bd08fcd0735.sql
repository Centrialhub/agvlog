ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS cte_emitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cte_emitted_outbound_id UUID;

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_cte_emitted_at
  ON public.fiscal_documents (tenant_id, cte_emitted_at)
  WHERE cte_emitted_at IS NOT NULL;