-- Cover the foreign keys used by dispatch routing and assignment flows.
-- The composite stop index also serves the ordered stop lookup performed by
-- calculate-trip-route (dispatch_trip_id + stop_order).

create index if not exists idx_dispatch_stops_client_id
  on public.dispatch_stops (client_id);

create index if not exists idx_dispatch_stops_trip_order
  on public.dispatch_stops (dispatch_trip_id, stop_order);

create index if not exists idx_dispatch_trips_driver_id
  on public.dispatch_trips (driver_id);

create index if not exists idx_dispatch_trips_load_id
  on public.dispatch_trips (load_id);

create index if not exists idx_dispatch_trips_vehicle_id
  on public.dispatch_trips (vehicle_id);
