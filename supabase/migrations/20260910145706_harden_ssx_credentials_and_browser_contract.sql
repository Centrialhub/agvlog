-- SSX access tokens are bearer credentials. Keep the secondary Administration
-- token out of integration_accounts.settings, which is readable by browser roles.
create table if not exists private.ssx_admin_token_cache (
  integration_account_id uuid primary key
    references public.integration_accounts(id) on delete cascade,
  token_ciphertext text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

revoke all on table private.ssx_admin_token_cache
from public, anon, authenticated, service_role;

create or replace function public.get_ssx_admin_token_cache_v1(
  _integration_account_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when cache.integration_account_id is null then null
    else jsonb_build_object(
      'token_ciphertext', cache.token_ciphertext,
      'expires_at', cache.expires_at
    )
  end
  from (select _integration_account_id as integration_account_id) requested
  left join private.ssx_admin_token_cache cache
    on cache.integration_account_id = requested.integration_account_id
  where exists (
    select 1
    from public.integration_accounts account
    where account.id = requested.integration_account_id
      and lower(account.provider) = 'ssx'
  );
$function$;

create or replace function public.set_ssx_admin_token_cache_v1(
  _integration_account_id uuid,
  _token_ciphertext text,
  _expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if _token_ciphertext is null
    or _token_ciphertext not like 'enc:v1:%'
    or _expires_at <= now()
    or not exists (
      select 1 from public.integration_accounts account
      where account.id = _integration_account_id
        and lower(account.provider) = 'ssx'
    ) then
    raise exception 'invalid_ssx_admin_token_cache' using errcode = '22023';
  end if;

  insert into private.ssx_admin_token_cache(
    integration_account_id, token_ciphertext, expires_at
  ) values (
    _integration_account_id, _token_ciphertext, _expires_at
  )
  on conflict (integration_account_id) do update
  set token_ciphertext = excluded.token_ciphertext,
      expires_at = excluded.expires_at,
      updated_at = now();
end;
$function$;

create or replace function public.clear_ssx_admin_token_cache_v1(
  _integration_account_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $function$
  delete from private.ssx_admin_token_cache
  where integration_account_id = _integration_account_id;
$function$;

revoke all on function public.get_ssx_admin_token_cache_v1(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.set_ssx_admin_token_cache_v1(uuid,text,timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.clear_ssx_admin_token_cache_v1(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_ssx_admin_token_cache_v1(uuid) to service_role;
grant execute on function public.set_ssx_admin_token_cache_v1(uuid,text,timestamptz) to service_role;
grant execute on function public.clear_ssx_admin_token_cache_v1(uuid) to service_role;

create or replace function private.clear_ssx_admin_token_cache_on_credential_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  delete from private.ssx_admin_token_cache
  where integration_account_id = new.id;
  return new;
end;
$function$;

revoke all on function private.clear_ssx_admin_token_cache_on_credential_change()
from public, anon, authenticated, service_role;

drop trigger if exists integration_accounts_clear_ssx_admin_token_cache
on public.integration_accounts;
create trigger integration_accounts_clear_ssx_admin_token_cache
after update of base_url, username, password_encrypted, hashauth, hashcode
on public.integration_accounts
for each row
when (
  old.base_url is distinct from new.base_url
  or old.username is distinct from new.username
  or old.password_encrypted is distinct from new.password_encrypted
  or old.hashauth is distinct from new.hashauth
  or old.hashcode is distinct from new.hashcode
)
execute function private.clear_ssx_admin_token_cache_on_credential_change();

update public.integration_accounts
set settings = settings
  - 'admin_token_cache'
  - 'admin_token_expires_at'
  - 'access_token'
  - 'refresh_token'
where lower(provider) = 'ssx'
  and settings ?| array[
    'admin_token_cache', 'admin_token_expires_at', 'access_token', 'refresh_token'
  ];

alter table public.integration_accounts
  drop constraint if exists integration_accounts_ssx_settings_no_secrets;
alter table public.integration_accounts
  add constraint integration_accounts_ssx_settings_no_secrets
  check (
    lower(provider) <> 'ssx'
    or not settings ?| array[
      'admin_token_cache', 'admin_token_expires_at', 'access_token',
      'refresh_token', 'password', 'hashauth', 'hashcode'
    ]
  );

-- Browser DTO: expose only settings used by the UI and never provider bodies.
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

comment on table private.ssx_admin_token_cache is
  'Encrypted, service-only cache for the separate SSX Administration bearer token.';
comment on function public.get_workspace_ssx_accounts_v1(uuid) is
  'Returns the browser-safe SSX registration without credentials, bearer tokens, raw settings or provider response bodies.';
