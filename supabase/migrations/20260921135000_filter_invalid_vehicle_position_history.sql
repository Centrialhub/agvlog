alter table public.positions_raw
  add constraint positions_raw_valid_coordinates_check
  check (lat between -90 and 90 and lng between -180 and 180)
  not valid;

comment on constraint positions_raw_valid_coordinates_check on public.positions_raw is
  'Rejects new non-finite or out-of-range raw positions without blocking cleanup of legacy invalid rows.';

do $migration$
declare
  definition text;
  old_filter constant text := E'  where r.tenant_id = _tenant_id\n    and r.vehicle_id = _vehicle_id\n    and r.captured_at >= _start_at';
  new_filter constant text := E'  where r.tenant_id = _tenant_id\n    and r.vehicle_id = _vehicle_id\n    and r.lat between -90 and 90\n    and r.lng between -180 and 180\n    and r.captured_at >= _start_at';
begin
  select pg_get_functiondef('public.list_vehicle_position_history_v1(uuid,uuid,timestamptz,timestamptz,timestamptz,uuid,integer)'::regprocedure)
  into definition;

  if position(new_filter in definition) > 0 then
    return;
  end if;
  if position(old_filter in definition) = 0 then
    raise exception 'vehicle_position_history_coordinate_filter_not_found' using errcode = '55000';
  end if;

  execute replace(definition, old_filter, new_filter);
end;
$migration$;

comment on function public.list_vehicle_position_history_v1(uuid,uuid,timestamptz,timestamptz,timestamptz,uuid,integer) is
  'Returns bounded, cursor-paginated vehicle history while excluding legacy positions outside geographic bounds.';
