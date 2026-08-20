
-- Monitoramento SEFAZ dos CT-e
ALTER TABLE public.cte_documents
  ADD COLUMN IF NOT EXISTS access_key text,
  ADD COLUMN IF NOT EXISTS protocol_number text,
  ADD COLUMN IF NOT EXISTS sefaz_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS sefaz_status_reason text,
  ADD COLUMN IF NOT EXISTS sefaz_status_code text,
  ADD COLUMN IF NOT EXISTS sefaz_status_at timestamptz,
  ADD COLUMN IF NOT EXISTS sefaz_environment text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS processed_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS correction_letter boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS correction_letter_payload jsonb,
  ADD COLUMN IF NOT EXISTS pdf_url text,
  ADD COLUMN IF NOT EXISTS xml_url text,
  ADD COLUMN IF NOT EXISTS xml_content text,
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS internal_number text,
  ADD COLUMN IF NOT EXISTS payer_name text,
  ADD COLUMN IF NOT EXISTS payer_cnpj text,
  ADD COLUMN IF NOT EXISTS company_branch text,
  ADD COLUMN IF NOT EXISTS company_group text,
  ADD COLUMN IF NOT EXISTS payer_group text,
  ADD COLUMN IF NOT EXISTS driver_name text,
  ADD COLUMN IF NOT EXISTS vehicle_plate text,
  ADD COLUMN IF NOT EXISTS sefaz_user text,
  ADD COLUMN IF NOT EXISTS last_sefaz_event jsonb;

-- Histórico de eventos SEFAZ (envio, retorno, cancelamento, carta de correção)
CREATE TABLE IF NOT EXISTS public.cte_sefaz_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  cte_document_id uuid NOT NULL REFERENCES public.cte_documents(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  status text,
  status_code text,
  reason text,
  protocol_number text,
  payload jsonb,
  source text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cte_sefaz_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read sefaz events"
  ON public.cte_sefaz_events FOR SELECT
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "tenant admins write sefaz events"
  ON public.cte_sefaz_events FOR INSERT
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_cte_sefaz_events_doc
  ON public.cte_sefaz_events (cte_document_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_cte_sefaz_events_tenant
  ON public.cte_sefaz_events (tenant_id, occurred_at DESC);

-- Índices para a tela Monitor DOC-e
CREATE INDEX IF NOT EXISTS idx_cte_docs_tenant_status
  ON public.cte_documents (tenant_id, sefaz_status, sefaz_status_at DESC);

CREATE INDEX IF NOT EXISTS idx_cte_docs_tenant_processed
  ON public.cte_documents (tenant_id, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_cte_docs_tenant_issued
  ON public.cte_documents (tenant_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_cte_docs_access_key_trgm
  ON public.cte_documents USING gin (access_key gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cte_docs_protocol_trgm
  ON public.cte_documents USING gin (protocol_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cte_docs_cte_number_trgm
  ON public.cte_documents USING gin (cte_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cte_docs_payer_cnpj_trgm
  ON public.cte_documents USING gin (payer_cnpj gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cte_docs_vehicle_plate_trgm
  ON public.cte_documents USING gin (vehicle_plate gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_cte_docs_reference_trgm
  ON public.cte_documents USING gin (reference_number gin_trgm_ops);

-- updated_at trigger se ainda não existir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'cte_documents_set_updated_at'
  ) THEN
    CREATE TRIGGER cte_documents_set_updated_at
      BEFORE UPDATE ON public.cte_documents
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;
