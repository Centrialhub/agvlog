-- Keep extension-owned objects out of the exposed public schema.
create schema if not exists extensions;

do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm' and n.nspname = 'public'
  ) then
    alter extension pg_trgm set schema extensions;
  end if;

  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'unaccent' and n.nspname = 'public'
  ) then
    alter extension unaccent set schema extensions;
  end if;
end
$$;

-- These functions use unaccent by name. Preserve resolution after moving the
-- extension while retaining an explicit SECURITY DEFINER search path.
alter function public.list_drivers_v1(uuid, text, text, integer)
  set search_path = public, extensions;
alter function public.list_operational_routes_v1(uuid, text, text, integer)
  set search_path = public, extensions;
