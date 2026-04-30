-- Operation type enum used by both loads and fiscal_documents
DO $$ BEGIN
  CREATE TYPE public.operation_type AS ENUM (
    'filial','armazenagem','frota','viagem_direta','retira',
    'transferencia','devolucao','redespacho'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.loads
  ADD COLUMN IF NOT EXISTS operation_type public.operation_type;

ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS operation_type public.operation_type;

CREATE INDEX IF NOT EXISTS idx_loads_operation_type
  ON public.loads(tenant_id, operation_type);

CREATE INDEX IF NOT EXISTS idx_fiscal_documents_operation_type
  ON public.fiscal_documents(tenant_id, operation_type);