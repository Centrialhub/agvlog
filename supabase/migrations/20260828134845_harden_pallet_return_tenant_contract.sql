-- Keep every pallet-return relationship inside its owning tenant.
-- Existing single-column foreign keys cannot prove that a referenced row belongs
-- to the same tenant as the protocol/item/history row.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.pallet_return_protocols p
    JOIN public.clients c ON c.id = p.supplier_id
    WHERE p.supplier_id IS NOT NULL
      AND c.tenant_id IS DISTINCT FROM p.tenant_id
  ) OR EXISTS (
    SELECT 1
    FROM public.pallet_return_protocols p
    JOIN public.drivers d ON d.id = p.driver_id
    WHERE p.driver_id IS NOT NULL
      AND d.tenant_id IS DISTINCT FROM p.tenant_id
  ) OR EXISTS (
    SELECT 1
    FROM public.pallet_return_protocols p
    JOIN public.vehicles v ON v.id = p.vehicle_id
    WHERE p.vehicle_id IS NOT NULL
      AND v.tenant_id IS DISTINCT FROM p.tenant_id
  ) OR EXISTS (
    SELECT 1
    FROM public.pallet_return_protocols p
    JOIN public.loads l ON l.id = p.load_id
    WHERE p.load_id IS NOT NULL
      AND l.tenant_id IS DISTINCT FROM p.tenant_id
  ) OR EXISTS (
    SELECT 1
    FROM public.pallet_return_items i
    JOIN public.pallet_return_protocols p ON p.id = i.protocol_id
    WHERE p.tenant_id IS DISTINCT FROM i.tenant_id
  ) OR EXISTS (
    SELECT 1
    FROM public.pallet_return_items i
    JOIN public.pallet_types t ON t.id = i.pallet_type_id
    WHERE i.pallet_type_id IS NOT NULL
      AND t.tenant_id IS DISTINCT FROM i.tenant_id
  ) OR EXISTS (
    SELECT 1
    FROM public.pallet_return_history h
    JOIN public.pallet_return_protocols p ON p.id = h.protocol_id
    WHERE p.tenant_id IS DISTINCT FROM h.tenant_id
  ) THEN
    RAISE EXCEPTION 'Pallet-return tenant graph contains cross-tenant relationships';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS pallet_return_protocols_tenant_id_id_uidx
  ON public.pallet_return_protocols (tenant_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS pallet_types_tenant_id_id_uidx
  ON public.pallet_types (tenant_id, id);

CREATE INDEX IF NOT EXISTS idx_prp_tenant_driver
  ON public.pallet_return_protocols (tenant_id, driver_id)
  WHERE driver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_prp_tenant_vehicle
  ON public.pallet_return_protocols (tenant_id, vehicle_id)
  WHERE vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pri_tenant_type
  ON public.pallet_return_items (tenant_id, pallet_type_id)
  WHERE pallet_type_id IS NOT NULL;

ALTER TABLE public.pallet_return_protocols
  DROP CONSTRAINT pallet_return_protocols_supplier_id_fkey,
  DROP CONSTRAINT pallet_return_protocols_driver_id_fkey,
  DROP CONSTRAINT pallet_return_protocols_vehicle_id_fkey,
  DROP CONSTRAINT pallet_return_protocols_load_id_fkey,
  ADD CONSTRAINT pallet_return_protocols_supplier_id_fkey
    FOREIGN KEY (tenant_id, supplier_id)
    REFERENCES public.clients (tenant_id, id)
    ON DELETE SET NULL (supplier_id)
    NOT VALID,
  ADD CONSTRAINT pallet_return_protocols_driver_id_fkey
    FOREIGN KEY (tenant_id, driver_id)
    REFERENCES public.drivers (tenant_id, id)
    ON DELETE SET NULL (driver_id)
    NOT VALID,
  ADD CONSTRAINT pallet_return_protocols_vehicle_id_fkey
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES public.vehicles (tenant_id, id)
    ON DELETE SET NULL (vehicle_id)
    NOT VALID,
  ADD CONSTRAINT pallet_return_protocols_load_id_fkey
    FOREIGN KEY (tenant_id, load_id)
    REFERENCES public.loads (tenant_id, id)
    ON DELETE SET NULL (load_id)
    NOT VALID;

ALTER TABLE public.pallet_return_items
  DROP CONSTRAINT pallet_return_items_protocol_id_fkey,
  DROP CONSTRAINT pallet_return_items_pallet_type_id_fkey,
  ADD CONSTRAINT pallet_return_items_protocol_id_fkey
    FOREIGN KEY (tenant_id, protocol_id)
    REFERENCES public.pallet_return_protocols (tenant_id, id)
    ON DELETE CASCADE
    NOT VALID,
  ADD CONSTRAINT pallet_return_items_pallet_type_id_fkey
    FOREIGN KEY (tenant_id, pallet_type_id)
    REFERENCES public.pallet_types (tenant_id, id)
    ON DELETE SET NULL (pallet_type_id)
    NOT VALID;

ALTER TABLE public.pallet_return_history
  DROP CONSTRAINT pallet_return_history_protocol_id_fkey,
  ADD CONSTRAINT pallet_return_history_protocol_id_fkey
    FOREIGN KEY (tenant_id, protocol_id)
    REFERENCES public.pallet_return_protocols (tenant_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.pallet_return_protocols
  VALIDATE CONSTRAINT pallet_return_protocols_supplier_id_fkey,
  VALIDATE CONSTRAINT pallet_return_protocols_driver_id_fkey,
  VALIDATE CONSTRAINT pallet_return_protocols_vehicle_id_fkey,
  VALIDATE CONSTRAINT pallet_return_protocols_load_id_fkey;

ALTER TABLE public.pallet_return_items
  VALIDATE CONSTRAINT pallet_return_items_protocol_id_fkey,
  VALIDATE CONSTRAINT pallet_return_items_pallet_type_id_fkey;

ALTER TABLE public.pallet_return_history
  VALIDATE CONSTRAINT pallet_return_history_protocol_id_fkey;
