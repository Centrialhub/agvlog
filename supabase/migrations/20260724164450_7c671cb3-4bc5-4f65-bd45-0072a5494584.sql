ALTER TABLE public.cte_batches
  ADD COLUMN IF NOT EXISTS emitter_id uuid REFERENCES public.tenant_emitters(id) ON DELETE SET NULL;

ALTER TABLE public.cte_documents
  ADD COLUMN IF NOT EXISTS remitter_cnpj text;

CREATE INDEX IF NOT EXISTS idx_cte_batches_emitter ON public.cte_batches(emitter_id) WHERE emitter_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cte_documents_remitter_cnpj ON public.cte_documents(remitter_cnpj) WHERE remitter_cnpj IS NOT NULL;