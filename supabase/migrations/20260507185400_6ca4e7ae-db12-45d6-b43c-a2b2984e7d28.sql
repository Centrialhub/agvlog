-- Freight automatic rules table
CREATE TABLE IF NOT EXISTS public.freight_auto_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  region_id UUID REFERENCES public.client_regions(id) ON DELETE SET NULL,
  region_name TEXT,
  payer_group TEXT,
  vehicle_type TEXT,
  cargo_type TEXT,
  weight_min NUMERIC,
  weight_max NUMERIC,
  pallet_min INTEGER,
  pallet_max INTEGER,
  unit_value NUMERIC,
  min_value NUMERIC,
  fixed_value NUMERIC,
  percent_value NUMERIC,
  calculation_basis TEXT NOT NULL DEFAULT 'weight',
  priority INTEGER NOT NULL DEFAULT 0,
  valid_from DATE,
  valid_until DATE,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_freight_auto_rules_tenant ON public.freight_auto_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_freight_auto_rules_client ON public.freight_auto_rules(client_id);
CREATE INDEX IF NOT EXISTS idx_freight_auto_rules_region ON public.freight_auto_rules(region_id);
CREATE INDEX IF NOT EXISTS idx_freight_auto_rules_payer ON public.freight_auto_rules(payer_group);
CREATE INDEX IF NOT EXISTS idx_freight_auto_rules_active ON public.freight_auto_rules(tenant_id, active);

ALTER TABLE public.freight_auto_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view freight auto rules"
  ON public.freight_auto_rules FOR SELECT
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "Tenant admins can insert freight auto rules"
  ON public.freight_auto_rules FOR INSERT
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE POLICY "Tenant admins can update freight auto rules"
  ON public.freight_auto_rules FOR UPDATE
  USING (public.is_tenant_admin(tenant_id));

CREATE POLICY "Tenant admins can delete freight auto rules"
  ON public.freight_auto_rules FOR DELETE
  USING (public.is_tenant_admin(tenant_id));

CREATE TRIGGER trg_freight_auto_rules_updated_at
  BEFORE UPDATE ON public.freight_auto_rules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();