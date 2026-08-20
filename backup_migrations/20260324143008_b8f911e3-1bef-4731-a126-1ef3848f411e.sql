
-- Load Items: sub-items within a load linking orders/documents
CREATE TABLE public.load_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id),
  fiscal_document_id uuid REFERENCES public.fiscal_documents(id),
  item_description text NOT NULL DEFAULT '',
  quantity numeric NOT NULL DEFAULT 0,
  pallet_count integer NOT NULL DEFAULT 0,
  weight_kg numeric DEFAULT 0,
  volume_m3 numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.load_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage load_items" ON public.load_items FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view load_items" ON public.load_items FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Operational Events: divergences, errors, returns
CREATE TABLE public.operational_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  load_id uuid REFERENCES public.loads(id),
  order_id uuid REFERENCES public.orders(id),
  vehicle_id uuid REFERENCES public.vehicles(id),
  driver_id uuid REFERENCES public.drivers(id),
  client_id uuid REFERENCES public.clients(id),
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  description text,
  financial_impact numeric DEFAULT 0,
  resolution text,
  resolved_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.operational_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage operational_events" ON public.operational_events FOR ALL TO authenticated
  USING (is_tenant_admin(tenant_id)) WITH CHECK (is_tenant_admin(tenant_id));
CREATE POLICY "Members can view operational_events" ON public.operational_events FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Trigger to auto-recalculate load totals when items change
CREATE OR REPLACE FUNCTION public.recalc_load_totals()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.loads SET
    total_pallet_count = COALESCE((SELECT SUM(pallet_count) FROM public.load_items WHERE load_id = COALESCE(NEW.load_id, OLD.load_id)), 0),
    total_weight_kg = COALESCE((SELECT SUM(weight_kg) FROM public.load_items WHERE load_id = COALESCE(NEW.load_id, OLD.load_id)), 0),
    total_volume_m3 = COALESCE((SELECT SUM(volume_m3) FROM public.load_items WHERE load_id = COALESCE(NEW.load_id, OLD.load_id)), 0),
    updated_at = now()
  WHERE id = COALESCE(NEW.load_id, OLD.load_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_recalc_load_totals
  AFTER INSERT OR UPDATE OR DELETE ON public.load_items
  FOR EACH ROW EXECUTE FUNCTION public.recalc_load_totals();
