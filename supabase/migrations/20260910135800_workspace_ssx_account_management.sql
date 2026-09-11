create or replace function public.upsert_workspace_ssx_account_v1(
  _tenant_id uuid,
  _integration_account_id uuid,
  _base_url text,
  _username text,
  _password_encrypted text,
  _hashauth text,
  _hashcode text,
  _settings jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_account_id uuid;
  v_registry public.workspace_ssx_accounts%rowtype;
begin
  select t.workspace_id into v_workspace_id
  from public.tenants t
  where t.id = _tenant_id;

  if v_workspace_id is null then
    raise exception 'tenant_workspace_not_found' using errcode = '23503';
  end if;

  select registry.* into v_registry
  from public.workspace_ssx_accounts registry
  where registry.workspace_id = v_workspace_id
  for update;

  if _integration_account_id is null then
    if v_registry.workspace_id is not null then
      raise exception 'workspace_ssx_account_already_exists' using errcode = '23505';
    end if;

    insert into public.integration_accounts(
      tenant_id, workspace_id, provider, base_url, username,
      password_encrypted, hashauth, hashcode, status,
      token_cache, token_expires_at, last_error, last_login_at, settings
    ) values (
      _tenant_id, v_workspace_id, 'SSX', _base_url, _username,
      _password_encrypted, _hashauth, _hashcode, 'pending',
      null, null, null, null, coalesce(_settings, '{}'::jsonb)
    ) returning id into v_account_id;

    insert into public.workspace_ssx_accounts(
      workspace_id, integration_account_id, migration_state
    ) values (v_workspace_id, v_account_id, 'ready');
  else
    if v_registry.workspace_id is null
      or v_registry.integration_account_id <> _integration_account_id then
      raise exception 'workspace_ssx_account_mismatch' using errcode = '23503';
    end if;

    update public.integration_accounts i
    set base_url = _base_url,
        username = _username,
        password_encrypted = _password_encrypted,
        hashauth = _hashauth,
        hashcode = _hashcode,
        status = 'pending',
        token_cache = null,
        token_expires_at = null,
        last_error = null,
        last_login_at = null,
        settings = coalesce(_settings, '{}'::jsonb),
        updated_at = now()
    where i.id = _integration_account_id
      and i.workspace_id = v_workspace_id
      and lower(i.provider) = 'ssx'
    returning i.id into v_account_id;

    if v_account_id is null then
      raise exception 'workspace_ssx_account_not_found' using errcode = '23503';
    end if;

    update public.workspace_ssx_accounts
    set migration_state = 'ready', updated_at = now()
    where workspace_id = v_workspace_id;
  end if;

  return v_account_id;
end;
$function$;

revoke all on function public.upsert_workspace_ssx_account_v1(uuid,uuid,text,text,text,text,text,jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.upsert_workspace_ssx_account_v1(uuid,uuid,text,text,text,text,text,jsonb)
to service_role;

create or replace function public.delete_workspace_ssx_account_v1(
  _tenant_id uuid,
  _integration_account_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
begin
  if auth.uid() is null
    or not private.is_request_tenant_member(_tenant_id)
    or not public.is_tenant_admin(_tenant_id) then
    raise exception 'workspace_ssx_delete_not_authorized' using errcode = '42501';
  end if;

  select t.workspace_id into v_workspace_id
  from public.tenants t
  where t.id = _tenant_id;

  if not exists(
    select 1
    from public.workspace_ssx_accounts registry
    where registry.workspace_id = v_workspace_id
      and registry.integration_account_id = _integration_account_id
  ) then
    raise exception 'workspace_ssx_account_not_found' using errcode = 'P0002';
  end if;

  delete from public.workspace_ssx_accounts registry
  where registry.workspace_id = v_workspace_id
    and registry.integration_account_id = _integration_account_id;

  delete from public.integration_accounts i
  where i.id = _integration_account_id
    and i.workspace_id = v_workspace_id;
end;
$function$;

revoke all on function public.delete_workspace_ssx_account_v1(uuid,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.delete_workspace_ssx_account_v1(uuid,uuid)
to authenticated, service_role;

comment on function public.upsert_workspace_ssx_account_v1(uuid,uuid,text,text,text,text,text,jsonb) is
  'Atomically creates or rotates the single SSX account owned by a workspace. Service-only; caller authorization is enforced by the Edge Function.';
comment on function public.delete_workspace_ssx_account_v1(uuid,uuid) is
  'Deletes the workspace SSX registry and its integration account atomically for an admin in the active tenant context.';
