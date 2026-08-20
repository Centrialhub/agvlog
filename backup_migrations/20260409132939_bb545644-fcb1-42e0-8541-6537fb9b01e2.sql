
CREATE TABLE public.client_regions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  payer_group text,
  municipality text NOT NULL,
  state_code text NOT NULL,
  region_name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.client_regions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage client_regions" ON public.client_regions
  FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Members can view client_regions" ON public.client_regions
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE INDEX idx_client_regions_tenant ON public.client_regions(tenant_id);
CREATE INDEX idx_client_regions_client ON public.client_regions(client_id);
