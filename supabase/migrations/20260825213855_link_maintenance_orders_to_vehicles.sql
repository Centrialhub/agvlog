alter table public.maintenance_orders
  add constraint maintenance_orders_vehicle_id_fkey
  foreign key (vehicle_id) references public.vehicles(id)
  on delete set null
  not valid;

alter table public.maintenance_orders
  validate constraint maintenance_orders_vehicle_id_fkey;

create index if not exists idx_maintenance_orders_vehicle_id
  on public.maintenance_orders (vehicle_id)
  where vehicle_id is not null;
