
ALTER TABLE public.cte_documents
  ADD COLUMN IF NOT EXISTS cte_type text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS is_voided boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_closed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_compensated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS autonomous_freight boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS complementary_doc boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consignee text,
  ADD COLUMN IF NOT EXISTS trailer_plate text,
  ADD COLUMN IF NOT EXISTS insurance_company text,
  ADD COLUMN IF NOT EXISTS contract_number text,
  ADD COLUMN IF NOT EXISTS trip_number text,
  ADD COLUMN IF NOT EXISTS romexp_number text,
  ADD COLUMN IF NOT EXISTS invoice_numbers text;

CREATE INDEX IF NOT EXISTS idx_cte_docs_type
  ON public.cte_documents (tenant_id, cte_type);

CREATE INDEX IF NOT EXISTS idx_cte_docs_consignee_trgm
  ON public.cte_documents USING gin (consignee gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cte_docs_remitter_trgm
  ON public.cte_documents USING gin (remitter gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cte_docs_recipient_trgm
  ON public.cte_documents USING gin (recipient gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cte_docs_trailer_trgm
  ON public.cte_documents USING gin (trailer_plate gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cte_docs_invoice_trgm
  ON public.cte_documents USING gin (invoice_numbers gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cte_docs_trip_trgm
  ON public.cte_documents USING gin (trip_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cte_docs_contract_trgm
  ON public.cte_documents USING gin (contract_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cte_docs_romexp_trgm
  ON public.cte_documents USING gin (romexp_number gin_trgm_ops);
