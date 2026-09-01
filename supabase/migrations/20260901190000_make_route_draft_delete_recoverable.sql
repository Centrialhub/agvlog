-- Recoverable compare-and-swap deletion for route-planning drafts.
-- Database-only command: no tracking, fiscal or paid provider call.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regprocedure('public.get_route_planning_draft_delete_context_v1(uuid,uuid)') is not null
    or to_regprocedure('public.delete_route_planning_draft_v1(jsonb)') is not null then
    raise exception 'Route-planning draft delete command is already installed';
  end if;
  if to_regclass('public.route_planning_drafts') is null
    or to_regclass('public.tenant_memberships') is null
    or to_regclass('public.idempotency_keys') is null
    or to_regprocedure('public.is_tenant_operator_or_admin(uuid)') is null
    or to_regprocedure('public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text)') is null then
    raise exception 'Route-planning draft delete dependency is missing';
  end if;
end;
$guard$;

create function public.get_route_planning_draft_delete_context_v1(
  _tenant_id uuid,
  _draft_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_draft public.route_planning_drafts%rowtype;
  v_snapshot jsonb;
begin
  if v_actor is null
    or _tenant_id is null
    or _draft_id is null
    or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'route_draft_not_authorized' using errcode = '42501';
  end if;

  select * into v_draft
  from public.route_planning_drafts
  where tenant_id = _tenant_id and id = _draft_id;

  if not found then
    return jsonb_build_object(
      'version', 1,
      'tenant_id', _tenant_id,
      'actor_id', v_actor,
      'draft_id', _draft_id,
      'exists', false,
      'can_delete', true,
      'status', null,
      'revision', null
    );
  end if;

  v_snapshot := to_jsonb(v_draft);
  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'actor_id', v_actor,
    'draft_id', _draft_id,
    'exists', true,
    'can_delete', v_draft.status = 'draft',
    'status', v_draft.status,
    'revision', encode(sha256(convert_to(v_snapshot::text, 'UTF8')), 'hex')
  );
end;
$fn$;

create function public.delete_route_planning_draft_v1(_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_request uuid;
  v_draft_id uuid;
  v_expected text;
  v_key text;
  v_hash text;
  v_revision text;
  v_deleted boolean := false;
  v_response jsonb;
  v_before jsonb;
  v_existing public.idempotency_keys%rowtype;
  v_draft public.route_planning_drafts%rowtype;
begin
  if _payload is null
    or jsonb_typeof(_payload) <> 'object'
    or octet_length(_payload::text) > 4000
    or _payload->'version' is distinct from '1'::jsonb
    or (_payload - array['version','tenant_id','actor_id','request_id','draft_id','expected_revision']) <> '{}'::jsonb
    or exists (
      select 1 from jsonb_each(_payload) item
      where item.key in ('tenant_id','actor_id','request_id','draft_id')
        and jsonb_typeof(item.value) <> 'string'
    )
    or not (_payload ? 'expected_revision')
    or jsonb_typeof(_payload->'expected_revision') not in ('string','null') then
    raise exception 'route_draft_invalid_payload' using errcode = '22023';
  end if;

  v_tenant := (_payload->>'tenant_id')::uuid;
  v_request := (_payload->>'request_id')::uuid;
  v_draft_id := (_payload->>'draft_id')::uuid;
  v_expected := _payload->>'expected_revision';

  if v_actor is null
    or (_payload->>'actor_id')::uuid is distinct from v_actor
    or v_tenant is null
    or v_request is null
    or v_draft_id is null
    or (v_expected is not null and v_expected !~ '^[0-9a-f]{64}$') then
    raise exception 'route_draft_invalid_payload' using errcode = '22023';
  end if;

  perform 1
  from public.tenant_memberships
  where tenant_id = v_tenant
    and user_id = v_actor
    and active
    and role::text in ('owner','admin','operator')
  for share nowait;
  if not found or not coalesce(public.is_tenant_operator_or_admin(v_tenant), false) then
    raise exception 'route_draft_not_authorized' using errcode = '42501';
  end if;

  v_hash := encode(sha256(convert_to(_payload::text, 'UTF8')), 'hex');
  v_key := 'route-planning-draft-delete:' || v_actor::text || ':' || v_request::text;
  perform pg_advisory_xact_lock(
    hashtext('route-planning-draft-delete'),
    hashtext(v_tenant::text || ':' || v_actor::text || ':' || v_request::text)
  );

  select * into v_existing
  from public.idempotency_keys
  where tenant_id = v_tenant and key_value = v_key;
  if found then
    if v_existing.payload_hash <> v_hash
      or v_existing.result_id is distinct from v_draft_id
      or v_existing.operation not in ('route_planning_draft_delete','route_planning_draft_delete_absent') then
      raise exception 'route_draft_request_key_mismatch' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'version', 1,
      'tenant_id', v_tenant,
      'actor_id', v_actor,
      'request_id', v_request,
      'draft_id', v_draft_id,
      'confirmed', true,
      'deleted', v_existing.operation = 'route_planning_draft_delete'
    );
  end if;

  select * into v_draft
  from public.route_planning_drafts
  where tenant_id = v_tenant and id = v_draft_id
  for update nowait;

  if found then
    v_before := to_jsonb(v_draft);
    v_revision := encode(sha256(convert_to(v_before::text, 'UTF8')), 'hex');
    if v_expected is null or v_expected <> v_revision then
      raise exception 'route_draft_context_changed' using errcode = '40001';
    end if;
    if v_draft.status <> 'draft' then
      raise exception 'route_draft_lifecycle_closed' using errcode = '23514';
    end if;

    delete from public.route_planning_drafts
    where tenant_id = v_tenant and id = v_draft_id and status = 'draft';
    if not found then
      raise exception 'route_draft_concurrent_change' using errcode = '40001';
    end if;
    v_deleted := true;
    perform public._log_entity_audit(
      v_tenant,
      'route_planning_draft',
      v_draft_id,
      'delete',
      v_before,
      jsonb_build_object('request_id', v_request, 'confirmed', true),
      'delete_route_planning_draft_v1'
    );
  elsif v_expected is not null then
    raise exception 'route_draft_context_changed' using errcode = '40001';
  end if;

  insert into public.idempotency_keys(
    tenant_id,
    key_value,
    operation,
    idempotency_key,
    payload_hash,
    result_id
  ) values (
    v_tenant,
    v_key,
    case when v_deleted then 'route_planning_draft_delete' else 'route_planning_draft_delete_absent' end,
    v_request::text,
    v_hash,
    v_draft_id
  );

  v_response := jsonb_build_object(
    'version', 1,
    'tenant_id', v_tenant,
    'actor_id', v_actor,
    'request_id', v_request,
    'draft_id', v_draft_id,
    'confirmed', true,
    'deleted', v_deleted
  );
  return v_response;
exception
  when lock_not_available or deadlock_detected then
    raise exception 'route_draft_concurrent_change' using errcode = '40001';
end;
$fn$;

revoke all on function public.get_route_planning_draft_delete_context_v1(uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_route_planning_draft_v1(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.get_route_planning_draft_delete_context_v1(uuid,uuid)
  to authenticated, service_role;
grant execute on function public.delete_route_planning_draft_v1(jsonb)
  to authenticated, service_role;

comment on function public.get_route_planning_draft_delete_context_v1(uuid,uuid) is
  'Tenant-scoped delete context with a server-derived CAS revision for a route-planning draft.';
comment on function public.delete_route_planning_draft_v1(jsonb) is
  'Idempotent tenant-scoped draft deletion. A persisted draft is deleted only when its server revision still matches.';
