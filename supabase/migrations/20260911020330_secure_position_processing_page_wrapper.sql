-- The queue worker is service-role-only, but this wrapper calls a helper in the
-- private schema. Execute the already-scoped wrapper as its owner instead of
-- exposing the private helper to service_role.
alter function public.read_vehicle_position_processing_page_v1(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  timestamptz,
  text,
  integer
) security definer;

revoke all on function public.read_vehicle_position_processing_page_v1(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  timestamptz,
  text,
  integer
) from public, anon, authenticated;

grant execute on function public.read_vehicle_position_processing_page_v1(
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  timestamptz,
  text,
  integer
) to service_role;
