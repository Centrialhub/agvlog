-- Reset only engine trips in the processing window and their dependent stops.
-- A stop inside the window may belong to a trip that started earlier; that
-- trip and its stop must remain untouched. The whole reset is one transaction.
create or replace function public.reset_engine_trip_window_v1(
  _tenant_id uuid,
  _vehicle_id uuid,
  _window_from timestamptz,
  _window_to timestamptz
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_stops integer;
  v_trips integer;
begin
  if current_user not in ('service_role', 'postgres') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if _tenant_id is null or _vehicle_id is null or _window_from is null or _window_to is null
    or _window_to <= _window_from or _window_to - _window_from > interval '26 hours' then
    raise exception 'invalid_trip_reset_window' using errcode = '22023';
  end if;

  delete from public.trip_stops s
  where s.tenant_id = _tenant_id and s.vehicle_id = _vehicle_id
    and (
      s.trip_id in (
        select t.id from public.trips t
        where t.tenant_id = _tenant_id and t.vehicle_id = _vehicle_id
          and t.detection_mode = 'basic'
          and t.start_at >= _window_from and t.start_at <= _window_to
      )
      or (s.trip_id is null and s.start_at >= _window_from and s.start_at <= _window_to)
    );
  get diagnostics v_stops = row_count;

  delete from public.trips t
  where t.tenant_id = _tenant_id and t.vehicle_id = _vehicle_id
    and t.detection_mode = 'basic'
    and t.start_at >= _window_from and t.start_at <= _window_to;
  get diagnostics v_trips = row_count;

  return jsonb_build_object('stops_deleted', v_stops, 'trips_deleted', v_trips);
end;
$function$;

revoke all on function public.reset_engine_trip_window_v1(uuid,uuid,timestamptz,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.reset_engine_trip_window_v1(uuid,uuid,timestamptz,timestamptz)
  to service_role;
