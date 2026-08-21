
-- 1) tenant_emitters
CREATE TABLE public.tenant_emitters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_code text NOT NULL DEFAULT 'MATRIZ',
  cnpj text NOT NULL,
  razao_social text NOT NULL,
  nome_fantasia text,
  ie text,
  im text,
  regime_tributario text,
  city_code text,
  endereco jsonb NOT NULL DEFAULT '{}'::jsonb,
  logo_url text,
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_emitters_cnpj_digits CHECK (cnpj ~ '^[0-9]{14}$')
);
CREATE UNIQUE INDEX uq_tenant_emitters_cnpj ON public.tenant_emitters(tenant_id, cnpj);
CREATE UNIQUE INDEX uq_tenant_emitters_default ON public.tenant_emitters(tenant_id) WHERE is_default;
CREATE INDEX ix_tenant_emitters_tenant ON public.tenant_emitters(tenant_id) WHERE active;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_emitters TO authenticated;
GRANT ALL ON public.tenant_emitters TO service_role;
ALTER TABLE public.tenant_emitters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read emitters"
  ON public.tenant_emitters FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_memberships m
    WHERE m.tenant_id = tenant_emitters.tenant_id AND m.user_id = auth.uid() AND m.active
  ));

CREATE POLICY "Admins manage emitters"
  ON public.tenant_emitters FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_memberships m
    WHERE m.tenant_id = tenant_emitters.tenant_id AND m.user_id = auth.uid() AND m.active
      AND m.role IN ('owner','admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tenant_memberships m
    WHERE m.tenant_id = tenant_emitters.tenant_id AND m.user_id = auth.uid() AND m.active
      AND m.role IN ('owner','admin')
  ));

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_tenant_emitters_updated
BEFORE UPDATE ON public.tenant_emitters
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) hub_fiscal_credentials
CREATE TABLE public.hub_fiscal_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  emitter_id uuid NOT NULL REFERENCES public.tenant_emitters(id) ON DELETE CASCADE,
  doc_scope text NOT NULL DEFAULT 'all' CHECK (doc_scope IN ('all','nfse','cte','nfe','nfce','mdfe')),
  environment text NOT NULL DEFAULT 'production' CHECK (environment IN ('sandbox','production')),
  secret_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_hub_fiscal_credentials_scope
  ON public.hub_fiscal_credentials(emitter_id, doc_scope);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hub_fiscal_credentials TO authenticated;
GRANT ALL ON public.hub_fiscal_credentials TO service_role;
ALTER TABLE public.hub_fiscal_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read hub creds"
  ON public.hub_fiscal_credentials FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_memberships m
    WHERE m.tenant_id = hub_fiscal_credentials.tenant_id AND m.user_id = auth.uid() AND m.active
  ));

CREATE POLICY "Admins manage hub creds"
  ON public.hub_fiscal_credentials FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.tenant_memberships m
    WHERE m.tenant_id = hub_fiscal_credentials.tenant_id AND m.user_id = auth.uid() AND m.active
      AND m.role IN ('owner','admin')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.tenant_memberships m
    WHERE m.tenant_id = hub_fiscal_credentials.tenant_id AND m.user_id = auth.uid() AND m.active
      AND m.role IN ('owner','admin')
  ));

CREATE TRIGGER trg_hub_fiscal_credentials_updated
BEFORE UPDATE ON public.hub_fiscal_credentials
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) emitter_id nas tabelas fiscais
ALTER TABLE public.nfse_documents      ADD COLUMN IF NOT EXISTS emitter_id uuid REFERENCES public.tenant_emitters(id);
ALTER TABLE public.cte_documents       ADD COLUMN IF NOT EXISTS emitter_id uuid REFERENCES public.tenant_emitters(id);
ALTER TABLE public.fiscal_documents    ADD COLUMN IF NOT EXISTS emitter_id uuid REFERENCES public.tenant_emitters(id);
ALTER TABLE public.hub_fiscal_emissions ADD COLUMN IF NOT EXISTS emitter_id uuid REFERENCES public.tenant_emitters(id);
ALTER TABLE public.nfse_sequences      ADD COLUMN IF NOT EXISTS emitter_id uuid REFERENCES public.tenant_emitters(id);

CREATE INDEX IF NOT EXISTS ix_nfse_documents_emitter ON public.nfse_documents(emitter_id);
CREATE INDEX IF NOT EXISTS ix_cte_documents_emitter ON public.cte_documents(emitter_id);
CREATE INDEX IF NOT EXISTS ix_fiscal_documents_emitter ON public.fiscal_documents(emitter_id);
CREATE INDEX IF NOT EXISTS ix_hub_fiscal_emissions_emitter ON public.hub_fiscal_emissions(emitter_id);

-- 4) Seed inicial: um emitter default por tenant, a partir de tenants.settings.company
INSERT INTO public.tenant_emitters (
  tenant_id, branch_code, cnpj, razao_social, nome_fantasia, ie, im, city_code, endereco, logo_url, is_default, active
)
SELECT
  t.id,
  COALESCE(NULLIF(t.settings->'company'->>'branch_code',''), 'MATRIZ'),
  COALESCE(NULLIF(regexp_replace(t.settings->'company'->>'cnpj','\D','','g'),''), lpad('0', 14, '0')),
  COALESCE(NULLIF(t.settings->'company'->>'razao_social',''), NULLIF(t.settings->'company'->>'name',''), t.name),
  NULLIF(t.settings->'company'->>'nome_fantasia',''),
  NULLIF(t.settings->'company'->>'ie',''),
  NULLIF(t.settings->'company'->>'im',''),
  NULLIF(t.settings->'company'->>'city_code',''),
  COALESCE(t.settings->'company'->'endereco', '{}'::jsonb),
  NULLIF(t.settings->'company'->>'logo_url',''),
  true,
  true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.tenant_emitters e WHERE e.tenant_id = t.id
)
AND regexp_replace(COALESCE(t.settings->'company'->>'cnpj',''), '\D','','g') ~ '^[0-9]{14}$';

-- Backfill emitter_id em documentos existentes usando o emitter default do tenant
UPDATE public.nfse_documents d SET emitter_id = e.id
FROM public.tenant_emitters e
WHERE d.tenant_id = e.tenant_id AND e.is_default AND d.emitter_id IS NULL;

UPDATE public.cte_documents d SET emitter_id = e.id
FROM public.tenant_emitters e
WHERE d.tenant_id = e.tenant_id AND e.is_default AND d.emitter_id IS NULL;

UPDATE public.hub_fiscal_emissions d SET emitter_id = e.id
FROM public.tenant_emitters e
WHERE d.tenant_id = e.tenant_id AND e.is_default AND d.emitter_id IS NULL;

-- 5) next_nfse_number_by_emitter
CREATE OR REPLACE FUNCTION public.next_nfse_number_by_emitter(
  _tenant_id uuid, _emitter_id uuid, _series text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_branch text;
  v_num bigint;
BEGIN
  SELECT branch_code INTO v_branch FROM public.tenant_emitters
    WHERE id = _emitter_id AND tenant_id = _tenant_id;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Emitente não encontrado para o tenant';
  END IF;

  INSERT INTO public.nfse_sequences (tenant_id, branch_code, series, emitter_id, next_number)
  VALUES (_tenant_id, v_branch, _series, _emitter_id, 2)
  ON CONFLICT (tenant_id, branch_code, series) DO UPDATE
    SET next_number = public.nfse_sequences.next_number + 1,
        emitter_id  = COALESCE(public.nfse_sequences.emitter_id, EXCLUDED.emitter_id),
        updated_at  = now()
  RETURNING next_number - 1 INTO v_num;

  RETURN v_num;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_nfse_number_by_emitter(uuid, uuid, text) TO authenticated;
