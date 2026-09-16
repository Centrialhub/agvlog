set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $preflight$
begin
  if to_regclass('public.geofences') is null
    or to_regclass('public.operator_command_ledger') is null
    or to_regprocedure('private.request_tenant_id()') is null
    or to_regprocedure('private.is_request_tenant_member(uuid)') is null then
    raise exception 'canonical_fleet_geofence_commands_prerequisites_missing';
  end if;
end;
$preflight$;

alter table public.operator_command_ledger
  drop constraint if exists operator_command_ledger_action_check;
alter table public.operator_command_ledger
  add constraint operator_command_ledger_action_check check (action in (
    'resolve_address','upsert_geofence','review_trip_cargo_divergence','mutate_fleet_geofence'
  ));

create or replace function private.mutate_fleet_geofence_v1(_payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;
  v_request uuid:=nullif(_payload->>'request_id','')::uuid;
  v_geofence uuid:=nullif(_payload->>'geofence_id','')::uuid;
  v_actor uuid:=auth.uid();
  v_action text:=nullif(_payload->>'action','');
  v_enabled boolean;
  v_hash text;
  v_existing public.operator_command_ledger%rowtype;
  v_result jsonb;
begin
  if jsonb_typeof(_payload) is distinct from 'object'
    or v_actor is null or v_tenant is null or v_request is null or v_geofence is null
    or v_action not in ('set_enabled','delete')
    or private.request_tenant_id() is distinct from v_tenant
    or not private.is_request_tenant_member(v_tenant)
    or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  if v_action='set_enabled' and jsonb_typeof(_payload->'enabled') is distinct from 'boolean' then
    raise exception 'geofence_enabled_required' using errcode='22023';
  end if;
  v_enabled:=case when v_action='set_enabled' then (_payload->>'enabled')::boolean else null end;
  v_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended('operator_command:'||v_tenant::text||':'||v_request::text,0));

  if auth.uid() is distinct from v_actor or v_actor is null
    or private.request_tenant_id() is distinct from v_tenant
    or not private.is_request_tenant_member(v_tenant)
    or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  select * into v_existing from public.operator_command_ledger
    where tenant_id=v_tenant and request_id=v_request;
  if found then
    if v_existing.actor_id<>v_actor or v_existing.action<>'mutate_fleet_geofence'
      or v_existing.entity_id<>v_geofence or v_existing.payload_hash<>v_hash then
      raise exception 'operator_request_conflict' using errcode='23505';
    end if;
    return v_existing.response;
  end if;

  perform 1 from public.geofences g
    where g.tenant_id=v_tenant and g.id=v_geofence
      and g.scope_kind='fleet' and g.dispatch_stop_id is null
    for update;
  if not found then
    raise exception 'fleet_geofence_not_found' using errcode='P0002';
  end if;

  if v_action='set_enabled' then
    update public.geofences set enabled=v_enabled where tenant_id=v_tenant and id=v_geofence;
    v_result:=jsonb_build_object('ok',true,'idempotent',false,'request_id',v_request,
      'geofence_id',v_geofence,'action',v_action,'enabled',v_enabled);
  else
    delete from public.geofences where tenant_id=v_tenant and id=v_geofence;
    v_result:=jsonb_build_object('ok',true,'idempotent',false,'request_id',v_request,
      'geofence_id',v_geofence,'action',v_action);
  end if;

  if auth.uid() is distinct from v_actor or v_actor is null
    or private.request_tenant_id() is distinct from v_tenant
    or not private.is_request_tenant_member(v_tenant)
    or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  insert into public.operator_command_ledger(
    tenant_id,request_id,actor_id,action,entity_type,entity_id,payload_hash,response
  ) values(
    v_tenant,v_request,v_actor,'mutate_fleet_geofence','geofence',v_geofence,v_hash,v_result
  );
  return v_result;
end;
$function$;

revoke all on function private.mutate_fleet_geofence_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.mutate_fleet_geofence_v1(jsonb) to authenticated;

create or replace function public.mutate_fleet_geofence_v1(_payload jsonb)
returns jsonb language sql security invoker set search_path='' set row_security='on'
as $function$
  select private.mutate_fleet_geofence_v1(_payload)
$function$;
revoke all on function public.mutate_fleet_geofence_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.mutate_fleet_geofence_v1(jsonb) to authenticated;

-- Expand phase: the canonical command is available while the currently published
-- frontend keeps its temporary direct-write compatibility. The contract phase is
-- applied only after the new frontend is promoted.
do $postcondition$
begin
  if not has_function_privilege('authenticated','public.mutate_fleet_geofence_v1(jsonb)','execute')
    or has_function_privilege('anon','public.mutate_fleet_geofence_v1(jsonb)','execute')
    or not has_table_privilege('authenticated','public.geofences','insert')
    or not has_table_privilege('authenticated','public.geofences','update')
    or not has_table_privilege('authenticated','public.geofences','delete') then
    raise exception 'staged_fleet_geofence_commands_postcondition_failed';
  end if;
end;
$postcondition$;
