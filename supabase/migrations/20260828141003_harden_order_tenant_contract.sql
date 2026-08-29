-- Orders must reference a client belonging to the same tenant.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.orders o
    JOIN public.clients c ON c.id = o.client_id
    WHERE o.client_id IS NOT NULL
      AND c.tenant_id IS DISTINCT FROM o.tenant_id
  ) THEN
    RAISE EXCEPTION 'Orders contain cross-tenant client links';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_orders_tenant_client
  ON public.orders (tenant_id, client_id)
  WHERE client_id IS NOT NULL;

ALTER TABLE public.orders
  DROP CONSTRAINT orders_client_id_fkey,
  ADD CONSTRAINT orders_client_id_fkey
    FOREIGN KEY (tenant_id, client_id)
    REFERENCES public.clients (tenant_id, id)
    NOT VALID;

ALTER TABLE public.orders
  VALIDATE CONSTRAINT orders_client_id_fkey;
