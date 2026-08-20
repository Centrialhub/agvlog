-- Loads: campos operacionais
ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS os_number text,
  ADD COLUMN IF NOT EXISTS scheduled_load_at timestamptz,
  ADD COLUMN IF NOT EXISTS actual_load_at timestamptz;

-- Fiscal documents: campos de referência e CNPJs
ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS recipient_cnpj text,
  ADD COLUMN IF NOT EXISTS remitter_cnpj text;

-- Índices em loads
CREATE INDEX IF NOT EXISTS idx_loads_os_number ON public.loads (os_number) WHERE os_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loads_os_number_trgm ON public.loads USING gin (os_number gin_trgm_ops) WHERE os_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loads_scheduled_load_at ON public.loads (scheduled_load_at) WHERE scheduled_load_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loads_actual_load_at ON public.loads (actual_load_at) WHERE actual_load_at IS NOT NULL;

-- Índices em fiscal_documents
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_reference_number_trgm ON public.fiscal_documents USING gin (reference_number gin_trgm_ops) WHERE reference_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_recipient_cnpj ON public.fiscal_documents (recipient_cnpj) WHERE recipient_cnpj IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_remitter_cnpj ON public.fiscal_documents (remitter_cnpj) WHERE remitter_cnpj IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fiscal_documents_issue_date ON public.fiscal_documents (tenant_id, issue_date DESC);
