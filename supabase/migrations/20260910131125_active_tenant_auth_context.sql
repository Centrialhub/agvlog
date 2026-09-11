create table private.user_active_tenant_contexts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index user_active_tenant_contexts_tenant_idx
  on private.user_active_tenant_contexts (tenant_id, user_id);

alter table private.user_active_tenant_contexts enable row level security;
revoke all on table private.user_active_tenant_contexts
from public, anon, authenticated, service_role;
grant select, insert, update, delete on table private.user_active_tenant_contexts
to service_role;

create or replace function private.user_can_access_tenant(_user_id uuid, _tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.tenant_memberships tm
    where tm.user_id = _user_id
      and tm.tenant_id = _tenant_id
      and tm.active
  ) or exists (
    select 1
    from public.client_portal_access cpa
    where cpa.user_id = _user_id
      and cpa.tenant_id = _tenant_id
      and cpa.active
  );
$function$;

create or replace function private.request_tenant_id()
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_headers jsonb;
  v_raw text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception
    when invalid_text_representation then
      raise exception 'tenant_context_invalid_headers'
        using errcode = '22023';
  end;

  v_raw := nullif(btrim(v_headers ->> 'x-agvlog-tenant-id'), '');
  if v_raw is null then
    v_raw := nullif(btrim(auth.jwt() ->> 'active_tenant_id'), '');
  end if;
  if v_raw is null then
    raise exception 'tenant_context_required'
      using errcode = '22023';
  end if;

  begin
    return v_raw::uuid;
  exception
    when invalid_text_representation then
      raise exception 'tenant_context_invalid'
        using errcode = '22023';
  end;
end;
$function$;

create or replace function private.is_request_tenant_member(_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select _tenant_id = private.request_tenant_id()
    and private.user_can_access_tenant(auth.uid(), _tenant_id);
$function$;

create or replace function public.set_active_tenant_context_v1(_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
begin
  if v_user_id is null
    or not private.user_can_access_tenant(v_user_id, _tenant_id) then
    raise exception 'tenant_context_not_authorized'
      using errcode = '42501';
  end if;

  select t.workspace_id into v_workspace_id
  from public.tenants t
  where t.id = _tenant_id;

  insert into private.user_active_tenant_contexts (user_id, tenant_id, updated_at)
  values (v_user_id, _tenant_id, now())
  on conflict (user_id) do update
    set tenant_id = excluded.tenant_id,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'workspace_id', v_workspace_id
  );
end;
$function$;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := (event ->> 'user_id')::uuid;
  v_tenant_id uuid;
  v_workspace_id uuid;
  v_claims jsonb := event -> 'claims';
begin
  select context.tenant_id
  into v_tenant_id
  from private.user_active_tenant_contexts context
  where context.user_id = v_user_id
    and private.user_can_access_tenant(v_user_id, context.tenant_id);

  if v_tenant_id is null then
    select candidate.tenant_id
    into v_tenant_id
    from (
      select tm.tenant_id, tm.created_at
      from public.tenant_memberships tm
      where tm.user_id = v_user_id and tm.active
      union all
      select cpa.tenant_id, cpa.created_at
      from public.client_portal_access cpa
      where cpa.user_id = v_user_id and cpa.active
    ) candidate
    order by candidate.created_at, candidate.tenant_id
    limit 1;
  end if;

  if v_tenant_id is not null then
    select t.workspace_id into v_workspace_id
    from public.tenants t
    where t.id = v_tenant_id;

    v_claims := jsonb_set(v_claims, '{active_tenant_id}', to_jsonb(v_tenant_id::text), true);
    v_claims := jsonb_set(v_claims, '{active_workspace_id}', to_jsonb(v_workspace_id::text), true);
  else
    v_claims := v_claims - 'active_tenant_id' - 'active_workspace_id';
  end if;

  return jsonb_build_object('claims', v_claims);
end;
$function$;

revoke all on function private.user_can_access_tenant(uuid, uuid),
                       private.request_tenant_id(),
                       private.is_request_tenant_member(uuid)
from public, anon, authenticated, service_role;
grant execute on function private.user_can_access_tenant(uuid, uuid),
                          private.request_tenant_id(),
                          private.is_request_tenant_member(uuid)
to authenticated, service_role;

revoke all on function public.set_active_tenant_context_v1(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.set_active_tenant_context_v1(uuid)
to authenticated;
grant execute on function public.set_active_tenant_context_v1(uuid)
to service_role;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb)
to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb)
from public, anon, authenticated, service_role;

comment on function public.custom_access_token_hook(jsonb) is
  'Adds the signed active tenant/workspace claims required by Realtime RLS.';
comment on function public.set_active_tenant_context_v1(uuid) is
  'Persists an authorized tenant selection before the client refreshes its access token.';
