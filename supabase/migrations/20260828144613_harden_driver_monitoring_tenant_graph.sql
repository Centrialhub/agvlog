-- Enforce tenant ownership across the driver-monitoring aggregate.
DO $$
DECLARE
  violations bigint;
BEGIN
  SELECT COALESCE(SUM(bad), 0) INTO violations FROM (
    SELECT COUNT(*) FILTER (WHERE t.id IS NULL) bad FROM public.driver_route_monitors m LEFT JOIN public.tenants t ON t.id = m.tenant_id
    UNION ALL SELECT COUNT(*) FILTER (WHERE t.id IS NULL) FROM public.driver_route_progress_updates u LEFT JOIN public.tenants t ON t.id = u.tenant_id
    UNION ALL SELECT COUNT(*) FILTER (WHERE t.id IS NULL) FROM public.driver_arrival_forecasts f LEFT JOIN public.tenants t ON t.id = f.tenant_id
    UNION ALL SELECT COUNT(*) FILTER (WHERE t.id IS NULL) FROM public.driver_monitoring_history h LEFT JOIN public.tenants t ON t.id = h.tenant_id
    UNION ALL SELECT COUNT(*) FILTER (WHERE t.id IS NULL) FROM public.driver_monitoring_import_batches b LEFT JOIN public.tenants t ON t.id = b.tenant_id
    UNION ALL SELECT COUNT(*) FILTER (WHERE m.driver_id IS NOT NULL AND (d.id IS NULL OR d.tenant_id <> m.tenant_id)) FROM public.driver_route_monitors m LEFT JOIN public.drivers d ON d.id = m.driver_id
    UNION ALL SELECT COUNT(*) FILTER (WHERE m.vehicle_id IS NOT NULL AND (v.id IS NULL OR v.tenant_id <> m.tenant_id)) FROM public.driver_route_monitors m LEFT JOIN public.vehicles v ON v.id = m.vehicle_id
    UNION ALL SELECT COUNT(*) FILTER (WHERE m.load_id IS NOT NULL AND (l.id IS NULL OR l.tenant_id <> m.tenant_id)) FROM public.driver_route_monitors m LEFT JOIN public.loads l ON l.id = m.load_id
    UNION ALL SELECT COUNT(*) FILTER (WHERE m.import_batch_id IS NOT NULL AND (b.id IS NULL OR b.tenant_id <> m.tenant_id)) FROM public.driver_route_monitors m LEFT JOIN public.driver_monitoring_import_batches b ON b.id = m.import_batch_id
    UNION ALL SELECT COUNT(*) FILTER (WHERE p.id IS NULL OR p.tenant_id <> u.tenant_id) FROM public.driver_route_progress_updates u LEFT JOIN public.driver_route_monitors p ON p.id = u.monitor_id
    UNION ALL SELECT COUNT(*) FILTER (WHERE u.driver_id IS NOT NULL AND (d.id IS NULL OR d.tenant_id <> u.tenant_id)) FROM public.driver_route_progress_updates u LEFT JOIN public.drivers d ON d.id = u.driver_id
    UNION ALL SELECT COUNT(*) FILTER (WHERE u.load_id IS NOT NULL AND (l.id IS NULL OR l.tenant_id <> u.tenant_id)) FROM public.driver_route_progress_updates u LEFT JOIN public.loads l ON l.id = u.load_id
    UNION ALL SELECT COUNT(*) FILTER (WHERE m.id IS NULL OR m.tenant_id <> f.tenant_id) FROM public.driver_arrival_forecasts f LEFT JOIN public.driver_route_monitors m ON m.id = f.monitor_id
    UNION ALL SELECT COUNT(*) FILTER (WHERE f.driver_id IS NOT NULL AND (d.id IS NULL OR d.tenant_id <> f.tenant_id)) FROM public.driver_arrival_forecasts f LEFT JOIN public.drivers d ON d.id = f.driver_id
    UNION ALL SELECT COUNT(*) FILTER (WHERE m.id IS NULL OR m.tenant_id <> h.tenant_id) FROM public.driver_monitoring_history h LEFT JOIN public.driver_route_monitors m ON m.id = h.monitor_id
  ) checks;

  IF violations > 0 THEN
    RAISE EXCEPTION 'Driver monitoring tenant graph has % invalid relationship(s)', violations;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS driver_monitoring_import_batches_tenant_id_id_uidx ON public.driver_monitoring_import_batches (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS driver_route_monitors_tenant_id_id_uidx ON public.driver_route_monitors (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_driver_route_monitors_tenant_driver ON public.driver_route_monitors (tenant_id, driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_route_monitors_tenant_vehicle ON public.driver_route_monitors (tenant_id, vehicle_id);
CREATE INDEX IF NOT EXISTS idx_driver_route_monitors_tenant_load ON public.driver_route_monitors (tenant_id, load_id);
CREATE INDEX IF NOT EXISTS idx_driver_route_monitors_tenant_import_batch ON public.driver_route_monitors (tenant_id, import_batch_id);
CREATE INDEX IF NOT EXISTS idx_driver_progress_tenant_monitor ON public.driver_route_progress_updates (tenant_id, monitor_id);
CREATE INDEX IF NOT EXISTS idx_driver_progress_tenant_driver ON public.driver_route_progress_updates (tenant_id, driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_progress_tenant_load ON public.driver_route_progress_updates (tenant_id, load_id);
CREATE INDEX IF NOT EXISTS idx_driver_forecasts_tenant_monitor ON public.driver_arrival_forecasts (tenant_id, monitor_id);
CREATE INDEX IF NOT EXISTS idx_driver_forecasts_tenant_driver ON public.driver_arrival_forecasts (tenant_id, driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_monitor_history_tenant_monitor ON public.driver_monitoring_history (tenant_id, monitor_id);

ALTER TABLE public.driver_route_monitors
  DROP CONSTRAINT IF EXISTS driver_route_monitors_driver_id_fkey,
  DROP CONSTRAINT IF EXISTS driver_route_monitors_load_id_fkey,
  DROP CONSTRAINT IF EXISTS driver_route_monitors_vehicle_id_fkey,
  ADD CONSTRAINT driver_route_monitors_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
  ADD CONSTRAINT driver_route_monitors_driver_tenant_fk FOREIGN KEY (tenant_id, driver_id) REFERENCES public.drivers (tenant_id, id) ON DELETE SET NULL (driver_id),
  ADD CONSTRAINT driver_route_monitors_vehicle_tenant_fk FOREIGN KEY (tenant_id, vehicle_id) REFERENCES public.vehicles (tenant_id, id) ON DELETE SET NULL (vehicle_id),
  ADD CONSTRAINT driver_route_monitors_load_tenant_fk FOREIGN KEY (tenant_id, load_id) REFERENCES public.loads (tenant_id, id) ON DELETE SET NULL (load_id),
  ADD CONSTRAINT driver_route_monitors_import_batch_tenant_fk FOREIGN KEY (tenant_id, import_batch_id) REFERENCES public.driver_monitoring_import_batches (tenant_id, id) ON DELETE SET NULL (import_batch_id);

ALTER TABLE public.driver_route_progress_updates
  DROP CONSTRAINT IF EXISTS driver_route_progress_updates_driver_id_fkey,
  DROP CONSTRAINT IF EXISTS driver_route_progress_updates_load_id_fkey,
  DROP CONSTRAINT IF EXISTS driver_route_progress_updates_monitor_id_fkey,
  ADD CONSTRAINT driver_route_progress_updates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
  ADD CONSTRAINT driver_route_progress_updates_monitor_tenant_fk FOREIGN KEY (tenant_id, monitor_id) REFERENCES public.driver_route_monitors (tenant_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT driver_route_progress_updates_driver_tenant_fk FOREIGN KEY (tenant_id, driver_id) REFERENCES public.drivers (tenant_id, id) ON DELETE SET NULL (driver_id),
  ADD CONSTRAINT driver_route_progress_updates_load_tenant_fk FOREIGN KEY (tenant_id, load_id) REFERENCES public.loads (tenant_id, id) ON DELETE SET NULL (load_id);

ALTER TABLE public.driver_arrival_forecasts
  DROP CONSTRAINT IF EXISTS driver_arrival_forecasts_driver_id_fkey,
  DROP CONSTRAINT IF EXISTS driver_arrival_forecasts_monitor_id_fkey,
  ADD CONSTRAINT driver_arrival_forecasts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
  ADD CONSTRAINT driver_arrival_forecasts_monitor_tenant_fk FOREIGN KEY (tenant_id, monitor_id) REFERENCES public.driver_route_monitors (tenant_id, id) ON DELETE CASCADE,
  ADD CONSTRAINT driver_arrival_forecasts_driver_tenant_fk FOREIGN KEY (tenant_id, driver_id) REFERENCES public.drivers (tenant_id, id) ON DELETE SET NULL (driver_id);

ALTER TABLE public.driver_monitoring_history
  DROP CONSTRAINT IF EXISTS driver_monitoring_history_monitor_id_fkey,
  ADD CONSTRAINT driver_monitoring_history_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE,
  ADD CONSTRAINT driver_monitoring_history_monitor_tenant_fk FOREIGN KEY (tenant_id, monitor_id) REFERENCES public.driver_route_monitors (tenant_id, id) ON DELETE CASCADE;

ALTER TABLE public.driver_monitoring_import_batches
  ADD CONSTRAINT driver_monitoring_import_batches_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants (id) ON DELETE CASCADE;
