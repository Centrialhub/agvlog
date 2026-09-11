create or replace function public.get_workspace_ssx_accounts_v1(_tenant_id uuid)
returns table(
  id uuid,
  tenant_id uuid,
  workspace_id uuid,
  provider text,
  base_url text,
  username text,
  status text,
  settings jsonb,
  last_login_at timestamptz,
  last_error text,
  created_at timestamptz,
  updated_at timestamptz,
  token_expires_at timestamptz,
  migration_state text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
begin
  if auth.uid() is null
    or not private.user_can_access_tenant(auth.uid(), _tenant_id) then
    raise exception 'workspace_ssx_not_authorized' using errcode='42501';
  end if;

  select t.workspace_id into v_workspace_id
  from public.tenants t where t.id=_tenant_id;

  return query
  select i.id,i.tenant_id,i.workspace_id,i.provider,i.base_url,i.username,i.status,
    i.settings,i.last_login_at,i.last_error,i.created_at,i.updated_at,i.token_expires_at,
    registry.migration_state
  from public.workspace_ssx_accounts registry
  join public.integration_accounts i on i.id=registry.integration_account_id
  where registry.workspace_id=v_workspace_id;
end;
$function$;

revoke all on function public.get_workspace_ssx_accounts_v1(uuid)
from public,anon,authenticated,service_role;
grant execute on function public.get_workspace_ssx_accounts_v1(uuid)
to authenticated,service_role;

create or replace function public.integration_account_matches_tenant_workspace_v1(
  _tenant_id uuid,
  _integration_account_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $function$
  select exists(
    select 1
    from public.integration_accounts i
    join public.tenants t on t.workspace_id=i.workspace_id
    join public.workspace_ssx_accounts registry
      on registry.workspace_id=i.workspace_id
      and registry.integration_account_id=i.id
    where t.id=_tenant_id
      and i.id=_integration_account_id
      and lower(i.provider)='ssx'
      and registry.migration_state='ready'
  );
$function$;

revoke all on function public.integration_account_matches_tenant_workspace_v1(uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.integration_account_matches_tenant_workspace_v1(uuid,uuid)
to service_role;

comment on function public.get_workspace_ssx_accounts_v1(uuid) is
  'Returns the browser-safe single SSX registration shared by every tenant in the workspace.';
