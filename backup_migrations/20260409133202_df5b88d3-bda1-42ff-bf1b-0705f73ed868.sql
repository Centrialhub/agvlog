
CREATE TABLE public.freight_tables (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  table_code serial,
  table_name text NOT NULL,
  payer_group text,
  payer text,
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_until date,
  origin_state text,
  origin_municipality text,
  origin_region text,
  destination_state text,
  destination_municipality text,
  destination_region text,
  distribution_type text,
  route text,
  blocked boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.freight_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage freight_tables" ON public.freight_tables
  FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id))
  WITH CHECK (is_tenant_admin(tenant_id));

CREATE POLICY "Members can view freight_tables" ON public.freight_tables
  FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE INDEX idx_freight_tables_tenant ON public.freight_tables(tenant_id);
CREATE INDEX idx_freight_tables_payer_group ON public.freight_tables(tenant_id, payer_group);
