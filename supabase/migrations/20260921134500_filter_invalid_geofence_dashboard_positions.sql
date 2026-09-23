do $migration$
declare
  definition text;
  old_filter constant text := E'    where position.tenant_id=_tenant_id\n      and position.captured_at>=clock_timestamp()-interval ''10 minutes''\n    order by position.captured_at desc,position.vehicle_id\n    limit 201';
  new_filter constant text := E'    where position.tenant_id=_tenant_id\n      and position.lat between -90 and 90\n      and position.lng between -180 and 180\n      and position.captured_at>=clock_timestamp()-interval ''10 minutes''\n    order by position.captured_at desc,position.vehicle_id\n    limit 201';
begin
  select pg_get_functiondef('public.get_geofence_dashboard_v1(uuid,integer,integer,jsonb)'::regprocedure)
  into definition;

  if position(new_filter in definition) > 0 then
    return;
  end if;
  if position(old_filter in definition) = 0 then
    raise exception 'geofence_dashboard_position_filter_not_found' using errcode = '55000';
  end if;

  execute replace(definition, old_filter, new_filter);
end;
$migration$;

comment on function public.get_geofence_dashboard_v1(uuid,integer,integer,jsonb) is
  'Returns the bounded geofence dashboard and excludes legacy positions outside geographic bounds.';
