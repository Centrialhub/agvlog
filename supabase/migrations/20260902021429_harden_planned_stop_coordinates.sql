-- Fail closed for every newly planned stop without rewriting the two legacy
-- rows that still need an operational reconciliation. Replanning APIs already
-- require explicit coordinates; this trigger closes the remaining planner and
-- direct-writer gaps without calling a geocoder or inventing a city centroid.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $preflight$
declare
  v_lat_type text;
  v_lng_type text;
begin
  if pg_catalog.to_regclass('public.dispatch_stops') is null then
    raise exception 'Planned stop coordinate hardening requires public.dispatch_stops';
  end if;

  select pg_catalog.format_type(a.atttypid, a.atttypmod)
    into v_lat_type
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.dispatch_stops'::pg_catalog.regclass
    and a.attname = 'latitude' and not a.attisdropped;

  select pg_catalog.format_type(a.atttypid, a.atttypmod)
    into v_lng_type
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.dispatch_stops'::pg_catalog.regclass
    and a.attname = 'longitude' and not a.attisdropped;

  if v_lat_type is null or v_lng_type is null
    or v_lat_type not in ('numeric', 'double precision', 'real')
    or v_lng_type not in ('numeric', 'double precision', 'real') then
    raise exception 'Planned stop coordinate columns changed (latitude %, longitude %)', v_lat_type, v_lng_type;
  end if;

  if pg_catalog.to_regprocedure('public.enforce_planned_stop_coordinates()') is not null
    or exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = 'public.dispatch_stops'::pg_catalog.regclass
        and tgname = 'enforce_planned_stop_coordinates'
        and not tgisinternal
    ) then
    raise exception 'Planned stop coordinate hardening already exists or collides';
  end if;
end;
$preflight$;

create function public.enforce_planned_stop_coordinates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if new.status in ('planned', 'pending', 'arriving')
    and (
      new.latitude is null
      or new.longitude is null
      or new.latitude not between -90 and 90
      or new.longitude not between -180 and 180
    ) then
    raise exception 'planned_stop_coordinates_required'
      using errcode = '22023',
        hint = 'Informe latitude (-90 a 90) e longitude (-180 a 180) do ponto físico da parada.';
  end if;
  return new;
end;
$function$;

revoke all privileges on function public.enforce_planned_stop_coordinates()
  from public, anon, authenticated, service_role;

create trigger enforce_planned_stop_coordinates
before insert or update of status, latitude, longitude
on public.dispatch_stops
for each row execute function public.enforce_planned_stop_coordinates();

comment on function public.enforce_planned_stop_coordinates() is
  'Rejects new or newly transitioned pre-arrival stops without valid explicit coordinates; legacy rows remain untouched until reconciled.';

do $postcondition$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.dispatch_stops'::pg_catalog.regclass
      and t.tgname = 'enforce_planned_stop_coordinates'
      and not t.tgisinternal
      and t.tgenabled = 'O'
      and t.tgfoid = pg_catalog.to_regprocedure('public.enforce_planned_stop_coordinates()')
  ) then
    raise exception 'Planned stop coordinate hardening postcondition failed';
  end if;
end;
$postcondition$;
