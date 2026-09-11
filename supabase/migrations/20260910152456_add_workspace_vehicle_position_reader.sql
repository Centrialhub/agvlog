create or replace function public.get_workspace_vehicle_position_v1(
  _tenant_id uuid,
  _vehicle_id uuid
)
returns table (
  lat double precision,
  lng double precision,
  captured_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_workspace_vehicle_id uuid;
begin
  if auth.uid() is null or not private.is_request_tenant_member(_tenant_id) then
    raise exception 'tenant_access_denied' using errcode = '42501';
  end if;

  select t.workspace_id
    into v_workspace_id
  from public.tenants t
  where t.id = _tenant_id;

  select l.workspace_vehicle_id
    into v_workspace_vehicle_id
  from public.workspace_vehicle_tenant_links l
  where l.workspace_id = v_workspace_id
    and l.vehicle_id = _vehicle_id;

  if v_workspace_vehicle_id is null then
    raise exception 'workspace_vehicle_not_found' using errcode = 'P0002';
  end if;

  return query
  select p.lat, p.lng, p.captured_at
  from public.workspace_vehicle_tenant_links l
  join public.positions_last p
    on p.tenant_id = l.tenant_id
   and p.vehicle_id = l.vehicle_id
  where l.workspace_id = v_workspace_id
    and l.workspace_vehicle_id = v_workspace_vehicle_id
  order by p.captured_at desc, p.received_at desc
  limit 1;
end;
$$;

revoke all on function public.get_workspace_vehicle_position_v1(uuid, uuid) from public;
revoke all on function public.get_workspace_vehicle_position_v1(uuid, uuid) from anon;
revoke all on function public.get_workspace_vehicle_position_v1(uuid, uuid) from authenticated;
revoke all on function public.get_workspace_vehicle_position_v1(uuid, uuid) from service_role;
grant execute on function public.get_workspace_vehicle_position_v1(uuid, uuid) to authenticated;
grant execute on function public.get_workspace_vehicle_position_v1(uuid, uuid) to service_role;

comment on function public.get_workspace_vehicle_position_v1(uuid, uuid) is
  'Returns the freshest position for a physical workspace vehicle across all tenant projections.';
