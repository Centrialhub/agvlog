-- NFS-e (Nota Fiscal de Serviço Eletrônica) module - structure ready for fiscal integration

-- Sequencer per tenant + branch + series
CREATE TABLE public.nfse_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_code text NOT NULL DEFAULT 'MATRIZ',
  series text NOT NULL DEFAULT '1',
  next_number bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_code, series)
);

ALTER TABLE public.nfse_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read nfse_sequences"
  ON public.nfse_sequences FOR SELECT
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant admins manage nfse_sequences"
  ON public.nfse_sequences FOR ALL
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

-- Provider configuration per tenant (Focus NFe / NFE.io / eNotas / Prefeitura direta)
CREATE TABLE public.nfse_provider_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_code text NOT NULL DEFAULT 'MATRIZ',
  provider text NOT NULL DEFAULT 'manual', -- 'manual' | 'focus_nfe' | 'nfeio' | 'enotas' | 'prefeitura'
  environment text NOT NULL DEFAULT 'homologacao', -- 'producao' | 'homologacao'
  city_code text,
  cnpj text,
  inscricao_municipal text,
  regime_tributario text,
  rps_serie text DEFAULT '1',
  webhook_url text,
  -- credentials are stored as encrypted blob (never plaintext keys)
  credentials_encrypted text,
  credentials_iv text,
  extra_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, branch_code)
);

ALTER TABLE public.nfse_provider_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant admins read nfse_provider_configs"
  ON public.nfse_provider_configs FOR SELECT
  USING (public.is_tenant_admin(tenant_id));
CREATE POLICY "Tenant admins manage nfse_provider_configs"
  ON public.nfse_provider_configs FOR ALL
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

-- NFS-e documents (mirrors SIAT Nota Fiscal de Serviço screen)
CREATE TABLE public.nfse_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  branch_code text NOT NULL DEFAULT 'MATRIZ',

  -- Identificação fiscal
  doc_type text NOT NULL DEFAULT 'NFS', -- NFS / NFSe / RPS
  series text,
  rps_number text,             -- RPS (sequencial interno antes da emissão)
  nfse_number text,            -- número definitivo retornado pela prefeitura
  internal_number text,        -- nº interno (sequencial calculado)
  invoice_number text,         -- nº da fatura (se aplicável)
  reference_number text,       -- nº de referência (Nº Ref no SIAT)
  pedido text,
  doc_substituido text,
  situacao_doc text DEFAULT '00',
  is_preview boolean NOT NULL DEFAULT false,  -- "Previsão" no SIAT
  cancelled boolean NOT NULL DEFAULT false,

  -- Dados gerais
  issue_date date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')::date,
  cond_pagamento text,
  comissao_para text,
  classe text,
  cod_servico text,
  nat_operacao text,
  cnae text,
  cod_trib_municipal text,
  cod_municipio_prestacao text,
  tipo_ctrc text,
  ctrc_complemento text,

  -- Prestador (preenchido a partir do tenant/filial)
  prestador_cnpj text,
  prestador_inscricao_municipal text,
  prestador_municipio text,

  -- Tomador (Cliente)
  cliente_id uuid,
  cliente_nome text,
  cliente_cnpj text,
  cliente_ie text,
  cliente_endereco text,
  cliente_bairro text,
  cliente_municipio text,
  cliente_uf text,
  cliente_cep text,
  cliente_email text,

  -- Pagador (pode diferir do tomador)
  pagador_nome text,
  pagador_cnpj text,
  pagador_ie text,
  pagador_endereco text,
  pagador_bairro text,
  pagador_municipio text,
  pagador_uf text,

  -- Itens / Composição
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text,
  quantity numeric,

  -- Valores
  valor_servicos numeric(14,2) NOT NULL DEFAULT 0,
  valor_deducoes numeric(14,2) NOT NULL DEFAULT 0,
  base_calculo numeric(14,2) NOT NULL DEFAULT 0,
  aliquota_iss numeric(7,4) NOT NULL DEFAULT 0,
  valor_iss numeric(14,2) NOT NULL DEFAULT 0,
  iss_retido boolean NOT NULL DEFAULT false,
  valor_pis numeric(14,2) NOT NULL DEFAULT 0,
  valor_cofins numeric(14,2) NOT NULL DEFAULT 0,
  valor_inss numeric(14,2) NOT NULL DEFAULT 0,
  valor_ir numeric(14,2) NOT NULL DEFAULT 0,
  valor_csll numeric(14,2) NOT NULL DEFAULT 0,
  outras_retencoes numeric(14,2) NOT NULL DEFAULT 0,
  valor_liquido numeric(14,2) NOT NULL DEFAULT 0,
  valor_total numeric(14,2) NOT NULL DEFAULT 0,

  -- Vínculos operacionais
  load_id uuid,
  trip_id uuid,
  related_cte_ids uuid[] DEFAULT ARRAY[]::uuid[],
  fiscal_document_ids uuid[] DEFAULT ARRAY[]::uuid[],

  -- Integração fiscal (preparado, sem provider ativo)
  status text NOT NULL DEFAULT 'draft', -- draft | queued | processing | issued | rejected | cancelled | error
  provider text, -- preenchido pela edge function ao integrar
  provider_request_id text,
  protocol_number text,
  verification_code text,
  authorization_date timestamptz,
  cancellation_date timestamptz,
  cancellation_reason text,
  rejection_messages jsonb,
  xml_url text,
  pdf_url text,
  raw_response jsonb,

  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_nfse_documents_tenant ON public.nfse_documents (tenant_id, issue_date DESC);
CREATE INDEX idx_nfse_documents_status ON public.nfse_documents (tenant_id, status);
CREATE INDEX idx_nfse_documents_load ON public.nfse_documents (load_id) WHERE load_id IS NOT NULL;
CREATE INDEX idx_nfse_documents_cliente ON public.nfse_documents (cliente_id) WHERE cliente_id IS NOT NULL;

ALTER TABLE public.nfse_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read nfse_documents"
  ON public.nfse_documents FOR SELECT
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members insert nfse_documents"
  ON public.nfse_documents FOR INSERT
  WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members update nfse_documents"
  ON public.nfse_documents FOR UPDATE
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant admins delete nfse_documents"
  ON public.nfse_documents FOR DELETE
  USING (public.is_tenant_admin(tenant_id));

CREATE TRIGGER trg_nfse_documents_updated_at
  BEFORE UPDATE ON public.nfse_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_nfse_sequences_updated_at
  BEFORE UPDATE ON public.nfse_sequences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_nfse_provider_configs_updated_at
  BEFORE UPDATE ON public.nfse_provider_configs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Audit log for NFS-e events (issued/cancelled/rejected)
CREATE TABLE public.nfse_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  nfse_id uuid NOT NULL REFERENCES public.nfse_documents(id) ON DELETE CASCADE,
  event_type text NOT NULL, -- created | submitted | issued | rejected | cancelled | replaced
  payload jsonb,
  message text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_nfse_events_doc ON public.nfse_events (nfse_id, created_at DESC);

ALTER TABLE public.nfse_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members read nfse_events"
  ON public.nfse_events FOR SELECT
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members insert nfse_events"
  ON public.nfse_events FOR INSERT
  WITH CHECK (public.is_tenant_member(tenant_id));

-- Sequence allocator: returns next RPS number atomically per (tenant, branch, series)
CREATE OR REPLACE FUNCTION public.next_nfse_number(_tenant_id uuid, _branch_code text DEFAULT 'MATRIZ', _series text DEFAULT '1')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _next bigint;
BEGIN
  IF NOT public.is_tenant_member(_tenant_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.nfse_sequences (tenant_id, branch_code, series, next_number)
  VALUES (_tenant_id, COALESCE(_branch_code,'MATRIZ'), COALESCE(_series,'1'), 1)
  ON CONFLICT (tenant_id, branch_code, series) DO NOTHING;

  UPDATE public.nfse_sequences
     SET next_number = next_number + 1,
         updated_at = now()
   WHERE tenant_id = _tenant_id
     AND branch_code = COALESCE(_branch_code,'MATRIZ')
     AND series = COALESCE(_series,'1')
  RETURNING next_number - 1 INTO _next;

  RETURN _next;
END;
$$;