
-- Pickup orders (Coletas)
CREATE TABLE public.pickup_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  pickup_number text NOT NULL,
  remitter_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  remitter_name text,
  remitter_cnpj text,
  recipient_name text,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  driver_name_snapshot text,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  vehicle_plate_snapshot text,
  pickup_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','vinculada','finalizada','cancelada')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (tenant_id, pickup_number)
);

CREATE INDEX idx_pickup_orders_tenant ON public.pickup_orders(tenant_id, pickup_at DESC);
CREATE INDEX idx_pickup_orders_status ON public.pickup_orders(tenant_id, status);
CREATE INDEX idx_pickup_orders_driver ON public.pickup_orders(driver_id);
CREATE INDEX idx_pickup_orders_remitter ON public.pickup_orders(remitter_client_id);
CREATE INDEX idx_pickup_orders_remitter_name_trgm ON public.pickup_orders USING gin (remitter_name gin_trgm_ops);
CREATE INDEX idx_pickup_orders_driver_name_trgm ON public.pickup_orders USING gin (driver_name_snapshot gin_trgm_ops);
CREATE INDEX idx_pickup_orders_number_trgm ON public.pickup_orders USING gin (pickup_number gin_trgm_ops);

ALTER TABLE public.pickup_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view pickup orders"
  ON public.pickup_orders FOR SELECT
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members can insert pickup orders"
  ON public.pickup_orders FOR INSERT
  WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members can update pickup orders"
  ON public.pickup_orders FOR UPDATE
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant admins can delete pickup orders"
  ON public.pickup_orders FOR DELETE
  USING (public.is_tenant_admin(tenant_id));

CREATE TRIGGER trg_pickup_orders_updated_at
  BEFORE UPDATE ON public.pickup_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Link from fiscal_documents
ALTER TABLE public.fiscal_documents
  ADD COLUMN pickup_order_id uuid REFERENCES public.pickup_orders(id) ON DELETE SET NULL;
CREATE INDEX idx_fiscal_documents_pickup ON public.fiscal_documents(pickup_order_id);

-- Sequential pickup number per tenant
CREATE OR REPLACE FUNCTION public.peek_next_pickup_number(_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path = 'public'
AS $$
DECLARE _next integer;
BEGIN
  IF NOT public.is_tenant_member(_tenant_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  SELECT GREATEST(
    COALESCE(MAX((regexp_match(pickup_number, '[0-9]+$'))[1]::integer), 0) + 1,
    1
  ) INTO _next
  FROM public.pickup_orders
  WHERE tenant_id = _tenant_id;
  RETURN _next::text;
END;
$$;
