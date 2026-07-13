
-- 1. New columns (nullable to preserve legacy data)
ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS invoice_series text,
  ADD COLUMN IF NOT EXISTS fiscal_model text;

-- 2. Normalization helpers (immutable so they can be indexed)
CREATE OR REPLACE FUNCTION public.normalize_tax_id(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(COALESCE(value, ''), '[^0-9]', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public.normalize_fiscal_number(value text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  digits text;
BEGIN
  digits := regexp_replace(COALESCE(value, ''), '[^0-9]', '', 'g');
  IF digits = '' THEN RETURN NULL; END IF;
  digits := regexp_replace(digits, '^0+', '');
  IF digits = '' THEN RETURN '0'; END IF;
  RETURN digits;
END;
$$;

-- 3. Unique indexes (partial, tenant-scoped, inbound only)
CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_documents_access_key
ON public.fiscal_documents (
  tenant_id,
  public.normalize_tax_id(access_key)
)
WHERE document_type = 'inbound'
  AND public.normalize_tax_id(access_key) IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_fiscal_documents_supplier_invoice
ON public.fiscal_documents (
  tenant_id,
  public.normalize_tax_id(remitter_cnpj),
  COALESCE(public.normalize_fiscal_number(fiscal_model), '55'),
  COALESCE(public.normalize_fiscal_number(invoice_series), '0'),
  public.normalize_fiscal_number(invoice_number)
)
WHERE document_type = 'inbound'
  AND public.normalize_tax_id(remitter_cnpj) IS NOT NULL
  AND public.normalize_fiscal_number(invoice_number) IS NOT NULL
  AND public.normalize_tax_id(access_key) IS NULL;
