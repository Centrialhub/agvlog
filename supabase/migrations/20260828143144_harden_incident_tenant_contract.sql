-- Keep incidents, responsibles and corrective actions inside the owning tenant.
DO $$
DECLARE
  violations bigint;
BEGIN
  SELECT COALESCE(SUM(bad), 0) INTO violations
  FROM (
    SELECT COUNT(*) FILTER (WHERE i.client_id IS NOT NULL AND (c.id IS NULL OR c.tenant_id <> i.tenant_id)) AS bad
      FROM public.incidents i LEFT JOIN public.clients c ON c.id = i.client_id
    UNION ALL
    SELECT COUNT(*) FILTER (WHERE i.employee_id IS NOT NULL AND (e.id IS NULL OR e.tenant_id <> i.tenant_id))
      FROM public.incidents i LEFT JOIN public.employees e ON e.id = i.employee_id
    UNION ALL
    SELECT COUNT(*) FILTER (WHERE i.driver_id IS NOT NULL AND (d.id IS NULL OR d.tenant_id <> i.tenant_id))
      FROM public.incidents i LEFT JOIN public.drivers d ON d.id = i.driver_id
    UNION ALL
    SELECT COUNT(*) FILTER (WHERE i.vehicle_id IS NOT NULL AND (v.id IS NULL OR v.tenant_id <> i.tenant_id))
      FROM public.incidents i LEFT JOIN public.vehicles v ON v.id = i.vehicle_id
    UNION ALL
    SELECT COUNT(*) FILTER (WHERE i.load_id IS NOT NULL AND (l.id IS NULL OR l.tenant_id <> i.tenant_id))
      FROM public.incidents i LEFT JOIN public.loads l ON l.id = i.load_id
    UNION ALL
    SELECT COUNT(*) FILTER (WHERE i.order_id IS NOT NULL AND (o.id IS NULL OR o.tenant_id <> i.tenant_id))
      FROM public.incidents i LEFT JOIN public.orders o ON o.id = i.order_id
    UNION ALL
    SELECT COUNT(*) FILTER (WHERE i.asset_id IS NOT NULL AND (a.id IS NULL OR a.tenant_id <> i.tenant_id))
      FROM public.incidents i LEFT JOIN public.assets a ON a.id = i.asset_id
    UNION ALL
    SELECT COUNT(*) FILTER (WHERE i.operational_event_id IS NOT NULL AND (oe.id IS NULL OR oe.tenant_id <> i.tenant_id))
      FROM public.incidents i LEFT JOIN public.operational_events oe ON oe.id = i.operational_event_id
    UNION ALL
    SELECT COUNT(*) FILTER (WHERE i.fiscal_document_id IS NOT NULL AND (f.id IS NULL OR f.tenant_id <> i.tenant_id))
      FROM public.incidents i LEFT JOIN public.fiscal_documents f ON f.id = i.fiscal_document_id
    UNION ALL
    SELECT COUNT(*) FILTER (WHERE i.dispatch_trip_id IS NOT NULL AND (dt.id IS NULL OR dt.tenant_id <> i.tenant_id))
      FROM public.incidents i LEFT JOIN public.dispatch_trips dt ON dt.id = i.dispatch_trip_id
    UNION ALL
    SELECT COUNT(*) FILTER (WHERE ir.employee_id IS NOT NULL AND (e.id IS NULL OR e.tenant_id <> ir.tenant_id))
      FROM public.incident_responsible ir LEFT JOIN public.employees e ON e.id = ir.employee_id
    UNION ALL
    SELECT COUNT(*) FILTER (WHERE ir.incident_id IS NOT NULL AND (i.id IS NULL OR i.tenant_id <> ir.tenant_id))
      FROM public.incident_responsible ir LEFT JOIN public.incidents i ON i.id = ir.incident_id
    UNION ALL
    SELECT COUNT(*) FILTER (WHERE a.employee_id IS NOT NULL AND (e.id IS NULL OR e.tenant_id <> a.tenant_id))
      FROM public.employee_incident_actions a LEFT JOIN public.employees e ON e.id = a.employee_id
    UNION ALL
    SELECT COUNT(*) FILTER (WHERE a.incident_id IS NOT NULL AND (i.id IS NULL OR i.tenant_id <> a.tenant_id))
      FROM public.employee_incident_actions a LEFT JOIN public.incidents i ON i.id = a.incident_id
  ) checks;

  IF violations > 0 THEN
    RAISE EXCEPTION 'Incident tenant graph has % invalid relationship(s)', violations;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS employees_tenant_id_id_uidx ON public.employees (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS assets_tenant_id_id_uidx ON public.assets (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS operational_events_tenant_id_id_uidx ON public.operational_events (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_trips_tenant_id_id_uidx ON public.dispatch_trips (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS orders_tenant_id_id_uidx ON public.orders (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS incidents_tenant_id_id_uidx ON public.incidents (tenant_id, id);

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_client ON public.incidents (tenant_id, client_id);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_employee ON public.incidents (tenant_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_driver ON public.incidents (tenant_id, driver_id);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_vehicle ON public.incidents (tenant_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_load ON public.incidents (tenant_id, load_id);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_order ON public.incidents (tenant_id, order_id);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_asset ON public.incidents (tenant_id, asset_id);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_operational_event ON public.incidents (tenant_id, operational_event_id);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_fiscal_document ON public.incidents (tenant_id, fiscal_document_id);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_dispatch_trip ON public.incidents (tenant_id, dispatch_trip_id);
CREATE INDEX IF NOT EXISTS idx_incident_responsible_tenant_incident ON public.incident_responsible (tenant_id, incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_responsible_tenant_employee ON public.incident_responsible (tenant_id, employee_id);

ALTER TABLE public.incidents
  DROP CONSTRAINT IF EXISTS incidents_asset_id_fkey,
  DROP CONSTRAINT IF EXISTS incidents_employee_id_fkey,
  DROP CONSTRAINT IF EXISTS incidents_operational_event_id_fkey;

ALTER TABLE public.incidents
  ADD CONSTRAINT incidents_client_tenant_fk FOREIGN KEY (tenant_id, client_id)
    REFERENCES public.clients (tenant_id, id) ON DELETE SET NULL (client_id),
  ADD CONSTRAINT incidents_employee_tenant_fk FOREIGN KEY (tenant_id, employee_id)
    REFERENCES public.employees (tenant_id, id),
  ADD CONSTRAINT incidents_driver_tenant_fk FOREIGN KEY (tenant_id, driver_id)
    REFERENCES public.drivers (tenant_id, id) ON DELETE SET NULL (driver_id),
  ADD CONSTRAINT incidents_vehicle_tenant_fk FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES public.vehicles (tenant_id, id) ON DELETE SET NULL (vehicle_id),
  ADD CONSTRAINT incidents_load_tenant_fk FOREIGN KEY (tenant_id, load_id)
    REFERENCES public.loads (tenant_id, id) ON DELETE SET NULL (load_id),
  ADD CONSTRAINT incidents_order_tenant_fk FOREIGN KEY (tenant_id, order_id)
    REFERENCES public.orders (tenant_id, id) ON DELETE SET NULL (order_id),
  ADD CONSTRAINT incidents_asset_tenant_fk FOREIGN KEY (tenant_id, asset_id)
    REFERENCES public.assets (tenant_id, id),
  ADD CONSTRAINT incidents_operational_event_tenant_fk FOREIGN KEY (tenant_id, operational_event_id)
    REFERENCES public.operational_events (tenant_id, id) ON DELETE SET NULL (operational_event_id),
  ADD CONSTRAINT incidents_fiscal_document_tenant_fk FOREIGN KEY (tenant_id, fiscal_document_id)
    REFERENCES public.fiscal_documents (tenant_id, id) ON DELETE SET NULL (fiscal_document_id),
  ADD CONSTRAINT incidents_dispatch_trip_tenant_fk FOREIGN KEY (tenant_id, dispatch_trip_id)
    REFERENCES public.dispatch_trips (tenant_id, id) ON DELETE SET NULL (dispatch_trip_id);

ALTER TABLE public.incident_responsible
  DROP CONSTRAINT IF EXISTS incident_responsible_employee_id_fkey,
  DROP CONSTRAINT IF EXISTS incident_responsible_incident_id_fkey,
  ADD CONSTRAINT incident_responsible_employee_tenant_fk FOREIGN KEY (tenant_id, employee_id)
    REFERENCES public.employees (tenant_id, id),
  ADD CONSTRAINT incident_responsible_incident_tenant_fk FOREIGN KEY (tenant_id, incident_id)
    REFERENCES public.incidents (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public.employee_incident_actions
  DROP CONSTRAINT IF EXISTS employee_incident_actions_employee_id_fkey,
  DROP CONSTRAINT IF EXISTS employee_incident_actions_incident_id_fkey,
  ADD CONSTRAINT employee_incident_actions_employee_tenant_fk FOREIGN KEY (tenant_id, employee_id)
    REFERENCES public.employees (tenant_id, id),
  ADD CONSTRAINT employee_incident_actions_incident_tenant_fk FOREIGN KEY (tenant_id, incident_id)
    REFERENCES public.incidents (tenant_id, id) ON DELETE CASCADE;
