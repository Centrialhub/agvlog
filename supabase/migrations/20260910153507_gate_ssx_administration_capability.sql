-- SSX Administration is a separate product/capability. Expose only its
-- non-sensitive opt-in flag to the browser and clear any secondary bearer
-- token whenever the opt-in changes or credentials are replaced.

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

drop trigger if exists integration_accounts_clear_ssx_admin_token_cache
on public.integration_accounts;
create trigger integration_accounts_clear_ssx_admin_token_cache
after update of base_url, username, password_encrypted, hashauth, hashcode, settings
on public.integration_accounts
for each row
when (
  old.base_url is distinct from new.base_url
  or old.username is distinct from new.username
  or old.password_encrypted is distinct from new.password_encrypted
  or old.hashauth is distinct from new.hashauth
  or old.hashcode is distinct from new.hashcode
  or old.settings -> 'administration_enabled'
    is distinct from new.settings -> 'administration_enabled'
)
execute function private.clear_ssx_admin_token_cache_on_credential_change();

comment on function public.get_workspace_ssx_accounts_v1(uuid) is
  'Browser-safe SSX account DTO. administration_enabled is a non-sensitive explicit opt-in; credentials and provider responses remain server-only.';
