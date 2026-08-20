
CREATE TABLE public.load_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  load_id uuid NOT NULL,
  manifest_number text NOT NULL,
  responsible_name text,
  responsible_cnpj text,
  responsible_ie text,
  responsible_address text,
  responsible_neighborhood text,
  responsible_city text,
  receipt_number text,
  toll_value numeric(14,2),
  origin text,
  destination text,
  uf_route text[],
  observations text,
  fiscal_document_ids uuid[] NOT NULL DEFAULT '{}',
  cte_document_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.load_manifests TO authenticated;
GRANT ALL ON public.load_manifests TO service_role;

ALTER TABLE public.load_manifests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view manifests"
  ON public.load_manifests FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE user_id = auth.uid()));

CREATE POLICY "tenant members can insert manifests"
  ON public.load_manifests FOR INSERT TO authenticated
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE user_id = auth.uid()));

CREATE POLICY "tenant members can update manifests"
  ON public.load_manifests FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE user_id = auth.uid()));

CREATE POLICY "tenant members can delete manifests"
  ON public.load_manifests FOR DELETE TO authenticated
  USING (tenant_id IN (SELECT tenant_id FROM public.tenant_memberships WHERE user_id = auth.uid()));

CREATE INDEX idx_load_manifests_load ON public.load_manifests(load_id);
CREATE INDEX idx_load_manifests_tenant ON public.load_manifests(tenant_id);

CREATE TRIGGER update_load_manifests_updated_at
  BEFORE UPDATE ON public.load_manifests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
