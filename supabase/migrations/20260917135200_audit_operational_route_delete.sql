create or replace function public.delete_operational_route_v1(
  _tenant_id uuid,
  _route_id uuid,
  _expected_updated_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_route public.operational_routes%rowtype;
begin
  if auth.uid() is null
    or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'operational_route_delete_not_authorized' using errcode = '42501';
  end if;
  if _route_id is null or _expected_updated_at is null then
    raise exception 'operational_route_delete_revision_required' using errcode = '22023';
  end if;

  select route.*
    into v_route
  from public.operational_routes route
  where route.id = _route_id and route.tenant_id = _tenant_id
  for update;
  if not found then
    raise exception 'operational_route_not_found' using errcode = 'P0002';
  end if;
  if v_route.updated_at is distinct from _expected_updated_at then
    raise exception 'operational_route_changed' using errcode = '40001';
  end if;

  perform public._log_entity_audit(
    _tenant_id,
    'operational_route',
    _route_id,
    'delete',
    to_jsonb(v_route),
    null,
    'delete_operational_route_v1'
  );

  delete from public.operational_routes
  where id = _route_id
    and tenant_id = _tenant_id
    and updated_at = _expected_updated_at;
  if not found then
    raise exception 'operational_route_changed' using errcode = '40001';
  end if;

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'id', _route_id,
    'deleted_revision', _expected_updated_at
  );
end;
$function$;

revoke all on function public.delete_operational_route_v1(uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_operational_route_v1(uuid,uuid,timestamptz)
  to authenticated, service_role;

comment on function public.delete_operational_route_v1(uuid,uuid,timestamptz) is
  'Deletes an exact operational-route revision and atomically preserves its full previous state in entity audit.';
