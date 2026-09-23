create or replace function public.delete_operational_route_v1(
  _tenant_id uuid,
  _route_id uuid,
  _expected_updated_at timestamptz,
  _request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_route public.operational_routes%rowtype;
  v_cached public.idempotency_keys%rowtype;
  v_key text;
  v_hash text;
  v_result jsonb;
begin
  if v_actor is null
    or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'operational_route_delete_not_authorized' using errcode = '42501';
  end if;
  if _route_id is null or _expected_updated_at is null or _request_id is null then
    raise exception 'operational_route_delete_request_required' using errcode = '22023';
  end if;

  v_key := 'delete_operational_route:' || v_actor::text || ':' || _request_id::text;
  v_hash := md5(jsonb_build_object(
    'route_id', _route_id,
    'expected_updated_at', _expected_updated_at
  )::text);
  perform pg_advisory_xact_lock(hashtextextended(_tenant_id::text || ':' || v_key, 0));

  select receipt.* into v_cached
  from public.idempotency_keys receipt
  where receipt.tenant_id = _tenant_id and receipt.key_value = v_key;
  if found then
    if v_cached.operation is distinct from 'delete_operational_route'
      or v_cached.payload_hash is distinct from v_hash
      or v_cached.response_body->>'request_id' is distinct from _request_id::text then
      raise exception 'operational_route_delete_idempotency_mismatch' using errcode = '22023';
    end if;
    return v_cached.response_body;
  end if;

  select route.* into v_route
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
    _tenant_id, 'operational_route', _route_id, 'delete',
    to_jsonb(v_route), null, 'delete_operational_route_v1'
  );

  delete from public.operational_routes
  where id = _route_id and tenant_id = _tenant_id and updated_at = _expected_updated_at;
  if not found then
    raise exception 'operational_route_changed' using errcode = '40001';
  end if;

  v_result := jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'id', _route_id,
    'deleted_revision', _expected_updated_at,
    'request_id', _request_id
  );
  insert into public.idempotency_keys(
    tenant_id, key_value, operation, idempotency_key, payload_hash, result_id, response_body
  ) values (
    _tenant_id, v_key, 'delete_operational_route', _request_id::text,
    v_hash, _route_id, v_result
  );
  return v_result;
end;
$function$;

revoke all on function public.delete_operational_route_v1(uuid,uuid,timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_operational_route_v1(uuid,uuid,timestamptz,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_operational_route_v1(uuid,uuid,timestamptz,uuid)
  to authenticated, service_role;

comment on function public.delete_operational_route_v1(uuid,uuid,timestamptz,uuid) is
  'Idempotently deletes an exact operational-route revision and returns the stored result on retry.';
