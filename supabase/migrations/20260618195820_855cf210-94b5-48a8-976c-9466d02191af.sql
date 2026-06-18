
CREATE TABLE public.hub_fiscal_emissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN ('nfe','nfce','nfse','cte','mdfe','cfe','nfcom')),
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','production')),
  emitter_cnpj text,
  external_id text,
  id_integracao text,
  hub_document_id text,
  plugnotas_id text,
  status text NOT NULL DEFAULT 'pending',
  plugnotas_status text,
  access_key text,
  authorization_protocol text,
  number text,
  series text,
  c_stat integer,
  message text,
  pdf_url text,
  xml_url text,
  fiscal_document_id uuid REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  cte_document_id uuid REFERENCES public.cte_documents(id) ON DELETE SET NULL,
  nfse_document_id uuid REFERENCES public.nfse_documents(id) ON DELETE SET NULL,
  request_payload jsonb,
  last_response jsonb,
  last_callback jsonb,
  cancel_reason text,
  cancelled_at timestamptz,
  sync_attempts integer NOT NULL DEFAULT 0,
  last_synced_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_hfe_tenant ON public.hub_fiscal_emissions(tenant_id);
CREATE INDEX idx_hfe_status ON public.hub_fiscal_emissions(tenant_id, status);
CREATE INDEX idx_hfe_hub_id ON public.hub_fiscal_emissions(hub_document_id);
CREATE INDEX idx_hfe_plugnotas_id ON public.hub_fiscal_emissions(plugnotas_id);
CREATE INDEX idx_hfe_id_integracao ON public.hub_fiscal_emissions(id_integracao);
CREATE INDEX idx_hfe_fiscal_doc ON public.hub_fiscal_emissions(fiscal_document_id);
CREATE INDEX idx_hfe_cte ON public.hub_fiscal_emissions(cte_document_id);
CREATE INDEX idx_hfe_nfse ON public.hub_fiscal_emissions(nfse_document_id);
CREATE UNIQUE INDEX uq_hfe_id_integracao ON public.hub_fiscal_emissions(tenant_id, doc_type, environment, id_integracao) WHERE id_integracao IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_fiscal_emissions TO authenticated;
GRANT ALL ON public.hub_fiscal_emissions TO service_role;

ALTER TABLE public.hub_fiscal_emissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read hub_fiscal_emissions"
  ON public.hub_fiscal_emissions FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_memberships tm WHERE tm.user_id = auth.uid()));

CREATE POLICY "Tenant members write hub_fiscal_emissions"
  ON public.hub_fiscal_emissions FOR ALL TO authenticated
  USING (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_memberships tm WHERE tm.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tm.tenant_id FROM public.tenant_memberships tm WHERE tm.user_id = auth.uid()));

CREATE TRIGGER trg_hfe_updated_at
  BEFORE UPDATE ON public.hub_fiscal_emissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
