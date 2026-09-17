alter function public.revert_xml_loads_to_available(uuid)
  set schema private;
alter function private.revert_xml_loads_to_available(uuid)
  rename to revert_xml_loads_to_available_unsafe_20260917;

revoke all on function private.revert_xml_loads_to_available_unsafe_20260917(uuid)
from public, anon, authenticated, service_role;

create function public.revert_xml_loads_to_available(_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_load_ids uuid[] := array[]::uuid[];
  v_trip_ids uuid[] := array[]::uuid[];
  v_locked integer := 0;
begin
  if not (
    auth.role() = 'service_role'
    or public.is_tenant_admin(_tenant_id)
  ) then
    raise exception 'Apenas administradores do tenant podem reverter cargas de XML'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(candidate.load_id order by candidate.load_id), array[]::uuid[])
  into v_load_ids
  from (
    select distinct item.load_id
    from public.load_items item
    where item.tenant_id = _tenant_id
      and item.load_id is not null
      and item.fiscal_document_id is not null
  ) candidate;

  if cardinality(v_load_ids) = 0 then
    return private.revert_xml_loads_to_available_unsafe_20260917(_tenant_id);
  end if;

  -- These parent-row locks conflict with the FK key-share locks needed by a
  -- concurrent dispatch to create dispatch_trips/dispatch_trip_loads links.
  -- All current dispatch and reallocation commands also lock loads first.
  perform load.id
  from public.loads load
  where load.tenant_id = _tenant_id
    and load.id = any(v_load_ids)
  order by load.id
  for update;
  get diagnostics v_locked = row_count;

  if v_locked <> cardinality(v_load_ids) then
    raise exception 'xml_revert_load_graph_changed' using errcode = '40001';
  end if;

  -- Re-read the links after the load barrier. If an older transaction had
  -- already acquired an FK lock, the statement above waited for its commit and
  -- this statement now sees its completed graph.
  select coalesce(array_agg(candidate.trip_id order by candidate.trip_id), array[]::uuid[])
  into v_trip_ids
  from (
    select distinct trip.id as trip_id
    from public.dispatch_trips trip
    where trip.tenant_id = _tenant_id
      and trip.load_id = any(v_load_ids)
    union
    select distinct link.dispatch_trip_id
    from public.dispatch_trip_loads link
    where link.tenant_id = _tenant_id
      and link.load_id = any(v_load_ids)
  ) candidate;

  perform trip.id
  from public.dispatch_trips trip
  where trip.tenant_id = _tenant_id
    and trip.id = any(v_trip_ids)
  order by trip.id
  for update;

  perform link.id
  from public.dispatch_trip_loads link
  where link.tenant_id = _tenant_id
    and (
      link.load_id = any(v_load_ids)
      or link.dispatch_trip_id = any(v_trip_ids)
    )
  order by link.dispatch_trip_id, link.load_id, link.id
  for update;

  return private.revert_xml_loads_to_available_unsafe_20260917(_tenant_id);
end;
$function$;

revoke all on function public.revert_xml_loads_to_available(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.revert_xml_loads_to_available(uuid)
to authenticated, service_role;
