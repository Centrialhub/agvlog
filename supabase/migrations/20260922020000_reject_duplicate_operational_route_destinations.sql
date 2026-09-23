create or replace function private.reject_duplicate_operational_route_destinations_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if jsonb_typeof(new.destinations)='array' and exists(
    select 1
    from (
      select upper(public.unaccent(btrim(regexp_replace(
        case jsonb_typeof(value)
          when 'string' then value#>>'{}'
          when 'object' then value->>'name'
          else null
        end,
        '\s+',' ','g'
      )))) as city_key
      from jsonb_array_elements(new.destinations)
    ) destination
    where nullif(destination.city_key,'') is not null
    group by destination.city_key
    having count(*)>1
  ) then
    raise exception 'duplicate_operational_route_destination' using errcode='23514';
  end if;
  return new;
end $$;

revoke all on function private.reject_duplicate_operational_route_destinations_v1()
  from public,anon,authenticated,service_role;
drop trigger if exists reject_duplicate_operational_route_destinations on public.operational_routes;
create trigger reject_duplicate_operational_route_destinations
before insert or update of destinations on public.operational_routes
for each row execute function private.reject_duplicate_operational_route_destinations_v1();
