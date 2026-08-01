ALTER TABLE public.nfse_documents
  ADD COLUMN IF NOT EXISTS last_status_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status_check_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_status_response JSONB;

CREATE INDEX IF NOT EXISTS idx_nfse_documents_pending_status
  ON public.nfse_documents (status, last_status_check_at)
  WHERE status IN ('processing','queued','submitted','pending');