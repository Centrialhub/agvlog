
BEGIN;
ALTER TABLE public.nfse_documents ADD COLUMN IF NOT EXISTS regime_tributario text;
COMMIT;
