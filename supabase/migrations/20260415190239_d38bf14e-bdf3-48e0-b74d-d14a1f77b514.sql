ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS recipient_city text,
  ADD COLUMN IF NOT EXISTS recipient_state text;