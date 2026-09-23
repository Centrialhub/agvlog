do $migration$
declare
  definition text;
  escaped_search constant text := $expr$replace(replace(replace(search_text,'\','\\'),'%','\%'),'_','\_')$expr$;
begin
  select pg_get_functiondef('public.get_geofence_dashboard_v1(uuid,integer,integer,jsonb)'::regprocedure)
  into definition;

  definition := replace(
    definition,
    $old$replace(replace(search_text,'\','\\'),'%','\%')$old$,
    escaped_search
  );
  definition := replace(
    definition,
    $old$coalesce(geofence.category,'general') ilike '%'||search_text||'%'$old$,
    $new$coalesce(geofence.category,'general') ilike '%'||$new$ || escaped_search || $new$||'%' escape '\'$new$
  );

  if position(escaped_search in definition)=0
     or position($check$coalesce(geofence.category,'general') ilike '%'||$check$ || escaped_search in definition)=0 then
    raise exception 'geofence_literal_search_patch_failed' using errcode='55000';
  end if;
  execute definition;
end;
$migration$;

comment on function public.get_geofence_dashboard_v1(uuid,integer,integer,jsonb) is
  'Returns the bounded dashboard with literal name/category search and geographically valid positions.';
