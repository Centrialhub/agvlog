-- All supported monitor mutations are SECURITY DEFINER commands that validate
-- tenant, expected revision, state transitions and append immutable history.
-- Authenticated PostgREST callers must not bypass those commands.
drop policy if exists drm_update on public.driver_route_monitors;
revoke update on table public.driver_route_monitors from anon,authenticated;

drop policy if exists driver_monitor_block_direct_update on public.driver_route_monitors;
create policy driver_monitor_block_direct_update
  on public.driver_route_monitors
  as restrictive
  for update
  to authenticated
  using (false)
  with check (false);

comment on table public.driver_route_monitors is
  'Driver monitoring aggregate. Authenticated writes use versioned RPC commands; direct UPDATE is intentionally unavailable.';
