ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS schedule_at timestamptz,
  ADD COLUMN IF NOT EXISTS occurrence_at timestamptz,
  ADD COLUMN IF NOT EXISTS occurrence_responsible text,
  ADD COLUMN IF NOT EXISTS occurrence_notes text;

ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS delivery_meta jsonb NOT NULL DEFAULT '{}'::jsonb;