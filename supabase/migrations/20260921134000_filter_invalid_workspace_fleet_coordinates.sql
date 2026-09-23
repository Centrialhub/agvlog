do $migration$
declare
  definition text;
  old_projection constant text := E'    telemetry.lat,\n    telemetry.lng,';
  new_projection constant text := E'    case when telemetry.lat between -90 and 90 and telemetry.lng between -180 and 180 then telemetry.lat else null end,\n    case when telemetry.lat between -90 and 90 and telemetry.lng between -180 and 180 then telemetry.lng else null end,';
begin
  select pg_get_functiondef('public.list_workspace_fleet_snapshot_v1(uuid)'::regprocedure)
  into definition;

  if position(new_projection in definition) > 0 then
    return;
  end if;
  if position(old_projection in definition) = 0 then
    raise exception 'workspace_fleet_snapshot_coordinate_projection_not_found' using errcode = '55000';
  end if;

  execute replace(definition, old_projection, new_projection);
end;
$migration$;

comment on function public.list_workspace_fleet_snapshot_v1(uuid) is
  'Returns one row per physical workspace vehicle and exposes telemetry coordinates only when both axes are finite and within geographic bounds.';
