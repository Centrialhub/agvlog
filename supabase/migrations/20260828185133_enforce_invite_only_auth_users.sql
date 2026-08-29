-- Keep hosted Auth invite-only even if GoTrue's public signup flag is
-- accidentally enabled. The application prepares a short-lived, one-time
-- nonce immediately before calling auth.admin.inviteUserByEmail().

create table private.auth_invite_authorizations (
  email text primary key,
  nonce_hash bytea not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint auth_invite_authorizations_email_normalized
    check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint auth_invite_authorizations_nonce_hash_length
    check (octet_length(nonce_hash) = 32),
  constraint auth_invite_authorizations_expiry_after_creation
    check (expires_at > created_at)
);

alter table private.auth_invite_authorizations enable row level security;

revoke all on table private.auth_invite_authorizations
  from public, anon, authenticated;
grant select, insert, update, delete on table private.auth_invite_authorizations
  to service_role;

create or replace function public.prepare_auth_invite(
  _email text,
  _tenant_id uuid,
  _invited_by uuid,
  _nonce text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(coalesce(_email, '')));
begin
  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid invitation email' using errcode = '22023';
  end if;

  if coalesce(length(_nonce), 0) < 32 then
    raise exception 'Invalid invitation nonce' using errcode = '22023';
  end if;

  delete from private.auth_invite_authorizations
  where expires_at <= clock_timestamp();

  insert into private.auth_invite_authorizations (
    email,
    nonce_hash,
    tenant_id,
    invited_by,
    expires_at
  )
  values (
    normalized_email,
    extensions.digest(convert_to(_nonce, 'UTF8'), 'sha256'),
    _tenant_id,
    _invited_by,
    clock_timestamp() + interval '10 minutes'
  )
  on conflict (email) do update
  set nonce_hash = excluded.nonce_hash,
      tenant_id = excluded.tenant_id,
      invited_by = excluded.invited_by,
      created_at = clock_timestamp(),
      expires_at = excluded.expires_at;
end;
$$;

create or replace function public.cancel_auth_invite(
  _email text,
  _nonce text
)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from private.auth_invite_authorizations
  where email = lower(btrim(coalesce(_email, '')))
    and nonce_hash = extensions.digest(convert_to(_nonce, 'UTF8'), 'sha256');
$$;

revoke execute on function public.prepare_auth_invite(text, uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.cancel_auth_invite(text, text)
  from public, anon, authenticated;
grant execute on function public.prepare_auth_invite(text, uuid, uuid, text)
  to service_role;
grant execute on function public.cancel_auth_invite(text, text)
  to service_role;

create or replace function private.enforce_invite_only_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  provided_nonce text;
  consumed_email text;
begin
  provided_nonce := coalesce(new.raw_user_meta_data, '{}'::jsonb)
    ->> 'agvlog_invite_nonce';

  if coalesce(length(provided_nonce), 0) < 32 then
    raise exception 'User creation requires an authorized invitation'
      using errcode = '28000';
  end if;

  delete from private.auth_invite_authorizations
  where email = lower(btrim(coalesce(new.email, '')))
    and nonce_hash = extensions.digest(convert_to(provided_nonce, 'UTF8'), 'sha256')
    and expires_at > clock_timestamp()
  returning email into consumed_email;

  if consumed_email is null then
    raise exception 'User creation requires an authorized invitation'
      using errcode = '28000';
  end if;

  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb)
    - 'agvlog_invite_nonce';
  return new;
end;
$$;

revoke execute on function private.enforce_invite_only_auth_user()
  from public, anon, authenticated, service_role;

create trigger enforce_invite_only_before_auth_user_created
before insert on auth.users
for each row
execute function private.enforce_invite_only_auth_user();

comment on table private.auth_invite_authorizations is
  'Short-lived, one-time authorization for an administrative AGVLOG invitation.';
comment on function public.prepare_auth_invite(text, uuid, uuid, text) is
  'Service-role-only preparation for the invite-only auth.users insertion guard.';
comment on function public.cancel_auth_invite(text, text) is
  'Service-role-only cleanup for a prepared invitation that was not consumed.';
comment on function private.enforce_invite_only_auth_user() is
  'Rejects every auth.users insertion without a valid one-time AGVLOG invitation nonce.';
