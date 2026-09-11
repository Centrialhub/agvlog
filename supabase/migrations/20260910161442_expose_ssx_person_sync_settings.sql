-- Browser-safe, non-secret defaults required by the published Tracking Person
-- contract. Recreate the DTO so credential values remain impossible to read.

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
    raise exception 'workspace_ssx_not_authorized' using errcode = '42501';
  end if;

  select tenant.workspace_id into v_workspace_id
  from public.tenants tenant
  where tenant.id = _tenant_id;

  return query
  select
    account.id,
    account.tenant_id,
    account.workspace_id,
    account.provider,
    account.base_url,
    account.username,
    account.status,
    jsonb_strip_nulls(jsonb_build_object(
      'administration_enabled',
        case
          when account.settings -> 'administration_enabled' = 'true'::jsonb
            then 'true'::jsonb
          else 'false'::jsonb
        end,
      'hashauth_configured', to_jsonb(coalesce(account.hashauth, '') <> ''),
      'hashcentral_configured', to_jsonb(coalesce(account.hashcode, '') <> ''),
      'organization_unit_integration_code', account.settings -> 'organization_unit_integration_code',
      'person_role_integration_code', account.settings -> 'person_role_integration_code',
      'work_schedule_integration_code', account.settings -> 'work_schedule_integration_code',
      'sync_units_backoff_until', account.settings -> 'sync_units_backoff_until',
      'last_units_sync_at', account.settings -> 'last_units_sync_at',
      'credential_reentry_required', account.settings -> 'credential_reentry_required'
    )),
    account.last_login_at,
    case
      when account.last_error is null then null
      else 'Falha na integração; execute o diagnóstico para detalhes sanitizados.'
    end,
    account.created_at,
    account.updated_at,
    account.token_expires_at,
    registry.migration_state
  from public.workspace_ssx_accounts registry
  join public.integration_accounts account
    on account.id = registry.integration_account_id
  where registry.workspace_id = v_workspace_id;
end;
$function$;

revoke all on function public.get_workspace_ssx_accounts_v1(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_workspace_ssx_accounts_v1(uuid)
to authenticated, service_role;

comment on function public.get_workspace_ssx_accounts_v1(uuid) is
  'Browser-safe SSX account DTO. Exposes only non-secret capability and Person mapping defaults.';
