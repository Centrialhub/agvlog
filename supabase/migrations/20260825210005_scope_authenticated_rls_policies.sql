-- These policies all depend on auth.uid()/tenant role helpers and are not
-- anonymous APIs. Scoping them avoids evaluating permissive policies for every
-- database role while preserving authenticated application access.
alter policy positions_last_select_driver
  on public.positions_last to authenticated;
alter policy positions_last_select_internal
  on public.positions_last to authenticated;

alter policy trip_alerts_select_driver
  on public.trip_alerts to authenticated;
alter policy trip_alerts_select_internal
  on public.trip_alerts to authenticated;
alter policy trip_alerts_write_internal
  on public.trip_alerts to authenticated;

alter policy trip_live_status_select_driver
  on public.trip_live_status to authenticated;
alter policy trip_live_status_select_internal
  on public.trip_live_status to authenticated;
alter policy trip_live_status_write_internal
  on public.trip_live_status to authenticated;

alter policy trip_routes_select_driver
  on public.trip_routes to authenticated;
alter policy trip_routes_select_internal
  on public.trip_routes to authenticated;
alter policy trip_routes_write_internal
  on public.trip_routes to authenticated;

alter policy "Admins can manage tracker links"
  on public.vehicle_tracker_links to authenticated;
alter policy "Members can view tracker links"
  on public.vehicle_tracker_links to authenticated;

alter policy "Admins can delete vehicles"
  on public.vehicles to authenticated;
alter policy "Admins can manage vehicles"
  on public.vehicles to authenticated;
alter policy "Admins can update vehicles"
  on public.vehicles to authenticated;
alter policy vehicles_select_driver
  on public.vehicles to authenticated;
alter policy vehicles_select_internal
  on public.vehicles to authenticated;

alter policy "Admins can delete drivers"
  on public.drivers to authenticated;
alter policy "Admins can manage drivers"
  on public.drivers to authenticated;
alter policy "Admins can update drivers"
  on public.drivers to authenticated;
alter policy drivers_select_internal
  on public.drivers to authenticated;
alter policy drivers_select_self
  on public.drivers to authenticated;
