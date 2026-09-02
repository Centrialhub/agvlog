-- Cover foreign-key checks introduced by the atomic load aggregate contract.
-- These indexes also keep tenant-scoped load assignment reads selective.

create index if not exists idx_load_aggregate_commands_actor_id
  on private.load_aggregate_commands (actor_id);

create index if not exists idx_loads_tenant_driver
  on public.loads (tenant_id, driver_id);

create index if not exists idx_loads_tenant_vehicle
  on public.loads (tenant_id, vehicle_id);

create index if not exists idx_loads_tenant_trip
  on public.loads (tenant_id, trip_id);
