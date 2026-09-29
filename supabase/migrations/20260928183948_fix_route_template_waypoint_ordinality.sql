-- Fix the active route helper reached by save_route_template_v1(jsonb).
-- Preserve the wrapper, durable request ledger, tenant guards and revision lock.
-- The real enum/table default uses checkpoint; stop is not an enum label.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $route_waypoint_json$
declare
  function_oid oid := pg_catalog.to_regprocedure('finance_private.save_route_template_unsafe_20260917(jsonb)');
  definition text;
  changed text;
  target record;
  original_count integer;
  corrected_count integer;
begin
  if function_oid is null or not exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_language l on l.oid=p.prolang
    where p.oid=function_oid and p.prokind='f' and not p.prosecdef and l.lanname='plpgsql'
      and p.prorettype='pg_catalog.jsonb'::pg_catalog.regtype
      and pg_catalog.pg_get_userbyid(p.proowner)='postgres'
  ) then
    raise exception 'Route waypoint helper contract changed' using errcode='55000';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_enum where enumtypid='public.waypoint_type'::pg_catalog.regtype and enumlabel='checkpoint'
  ) or exists (
    select 1 from pg_catalog.pg_enum where enumtypid='public.waypoint_type'::pg_catalog.regtype and enumlabel='stop'
  ) or not exists (
    select 1 from pg_catalog.pg_attrdef d join pg_catalog.pg_attribute a on a.attrelid=d.adrelid and a.attnum=d.adnum
    where d.adrelid='public.route_waypoints'::pg_catalog.regclass and a.attname='waypoint_type'
      and pg_catalog.pg_get_expr(d.adbin,d.adrelid) in ('''checkpoint''::waypoint_type','''checkpoint''::public.waypoint_type')
  ) then
    raise exception 'Route waypoint enum/default changed; review the fallback' using errcode='55000';
  end if;
  definition := pg_catalog.pg_get_functiondef(function_oid);
  changed := definition;
  for target in select * from (values
    (
      $old$from jsonb_to_recordset(v_waypoints) with ordinality as x(
    waypoint_order integer, waypoint_type public.waypoint_type, label text,
    address text, poi_id uuid, geofence_id uuid, estimated_duration_min integer,
    notes text, lat double precision, lng double precision, ord bigint
  )$old$,
      $new$from jsonb_array_elements(v_waypoints) with ordinality as item(value,ord)
  cross join lateral jsonb_to_record(item.value) as x(
    waypoint_order integer, waypoint_type public.waypoint_type, label text,
    address text, poi_id uuid, geofence_id uuid, estimated_duration_min integer,
    notes text, lat double precision, lng double precision
  )$new$
    ),
    (
      $old$coalesce(x.waypoint_type, 'stop'::public.waypoint_type)$old$,
      $new$coalesce(x.waypoint_type, 'checkpoint'::public.waypoint_type)$new$
    )
  ) as patch(original,corrected)
  loop
    original_count := (length(changed)-length(replace(changed,target.original,'')))/length(target.original);
    corrected_count := (length(changed)-length(replace(changed,target.corrected,'')))/length(target.corrected);
    if original_count=1 and corrected_count=0 then
      changed := replace(changed,target.original,target.corrected);
    elsif original_count<>0 or corrected_count<>1 then
      raise exception 'Route waypoint helper body changed' using errcode='55000';
    end if;
  end loop;
  if changed<>definition then execute changed;end if;
end;
$route_waypoint_json$;
