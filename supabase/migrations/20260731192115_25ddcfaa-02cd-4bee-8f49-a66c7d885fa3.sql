ALTER TABLE public.nfse_documents
  ADD COLUMN IF NOT EXISTS insurer_name text,
  ADD COLUMN IF NOT EXISTS insurer_cnpj text,
  ADD COLUMN IF NOT EXISTS insurer_policy text,
  ADD COLUMN IF NOT EXISTS insurer_endorsement text,
  ADD COLUMN IF NOT EXISTS insured_amount numeric,
  ADD COLUMN IF NOT EXISTS insurance_premium numeric;

COMMENT ON COLUMN public.nfse_documents.insurer_policy IS 'Nº da apólice replicado da emissão fiscal (auditoria e impressão na discriminação da NFS-e)';
COMMENT ON COLUMN public.nfse_documents.insurer_endorsement IS 'Nº da averbação replicado da emissão fiscal';