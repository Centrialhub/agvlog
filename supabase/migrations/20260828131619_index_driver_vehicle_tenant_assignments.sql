-- Cover the composite tenant-safe driver/vehicle assignment foreign keys.
CREATE INDEX IF NOT EXISTS idx_drivers_tenant_current_vehicle
  ON public.drivers (tenant_id, current_vehicle_id);

CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_current_driver
  ON public.vehicles (tenant_id, current_driver_id);
