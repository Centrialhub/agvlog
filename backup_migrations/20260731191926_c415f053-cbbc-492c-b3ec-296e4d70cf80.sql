ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS insurer_name text,
  ADD COLUMN IF NOT EXISTS insurer_cnpj text,
  ADD COLUMN IF NOT EXISTS insurer_policy text,
  ADD COLUMN IF NOT EXISTS insurer_endorsement text,
  ADD COLUMN IF NOT EXISTS insured_amount numeric,
  ADD COLUMN IF NOT EXISTS insurance_premium numeric;

COMMENT ON COLUMN public.fiscal_documents.insurer_name IS 'Seguradora informada na emissão (auditoria do bloco de seguro do CT-e/DACTE)';
COMMENT ON COLUMN public.fiscal_documents.insurer_policy IS 'Nº da apólice informado na emissão';
COMMENT ON COLUMN public.fiscal_documents.insurer_endorsement IS 'Nº da averbação informado na emissão (por documento)';

ALTER TABLE public.hub_fiscal_emissions
  ADD COLUMN IF NOT EXISTS insurer_name text,
  ADD COLUMN IF NOT EXISTS insurer_cnpj text,
  ADD COLUMN IF NOT EXISTS insurer_policy text,
  ADD COLUMN IF NOT EXISTS insurer_endorsement text,
  ADD COLUMN IF NOT EXISTS insured_amount numeric,
  ADD COLUMN IF NOT EXISTS insurance_premium numeric;

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_insurer_policy
  ON public.fiscal_documents (tenant_id, insurer_policy)
  WHERE insurer_policy IS NOT NULL;