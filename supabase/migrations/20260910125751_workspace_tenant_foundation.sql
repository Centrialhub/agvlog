-- Workspace is the corporate group boundary. Tenants remain the legal/fiscal
-- boundary. Existing installations start with one workspace per tenant and can
-- merge tenants into the same workspace in a controlled data migration later.

create schema if not exists private;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenants
  add column workspace_id uuid;

insert into public.workspaces (id, name, active, settings, created_at, updated_at)
select id, name, true, '{}'::jsonb, created_at, updated_at
from public.tenants;

update public.tenants
set workspace_id = id
where workspace_id is null;

alter table public.tenants
  alter column workspace_id set not null,
  add constraint tenants_workspace_id_fkey
    foreign key (workspace_id) references public.workspaces(id) on delete restrict;

create index tenants_workspace_id_idx
  on public.tenants (workspace_id);

create table public.workspace_memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'operator',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_memberships_workspace_user_key unique (workspace_id, user_id)
);

create index workspace_memberships_user_active_idx
  on public.workspace_memberships (user_id, active, workspace_id);

insert into public.workspace_memberships (
  workspace_id,
  user_id,
  role,
  active,
  created_at,
  updated_at
)
select distinct on (t.workspace_id, tm.user_id)
  t.workspace_id,
  tm.user_id,
  tm.role,
  tm.active,
  tm.created_at,
  tm.updated_at
from public.tenant_memberships tm
join public.tenants t on t.id = tm.tenant_id
order by
  t.workspace_id,
  tm.user_id,
  tm.active desc,
  case tm.role
    when 'owner' then 1
    when 'admin' then 2
    when 'operator' then 3
    when 'driver' then 4
    when 'client' then 5
  end;

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

create or replace function private.is_workspace_member(_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.workspace_memberships wm
    where wm.workspace_id = _workspace_id
      and wm.user_id = auth.uid()
      and wm.active
  ) or exists (
    select 1
    from public.tenant_memberships tm
    join public.tenants t on t.id = tm.tenant_id
    where t.workspace_id = _workspace_id
      and tm.user_id = auth.uid()
      and tm.active
  );
$function$;

create or replace function private.is_workspace_admin(_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.workspace_memberships wm
    where wm.workspace_id = _workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner', 'admin')
      and wm.active
  ) or exists (
    select 1
    from public.tenant_memberships tm
    join public.tenants t on t.id = tm.tenant_id
    where t.workspace_id = _workspace_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'admin')
      and tm.active
  );
$function$;

create or replace function private.is_request_tenant_member(_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select _tenant_id = private.request_tenant_id()
    and exists (
      select 1
      from public.tenant_memberships tm
      where tm.tenant_id = _tenant_id
        and tm.user_id = auth.uid()
        and tm.active
    );
$function$;

revoke all on function private.request_tenant_id(),
                       private.is_workspace_member(uuid),
                       private.is_workspace_admin(uuid),
                       private.is_request_tenant_member(uuid)
from public, anon, authenticated, service_role;

grant usage on schema private to authenticated, service_role;
grant execute on function private.request_tenant_id(),
                          private.is_workspace_member(uuid),
                          private.is_workspace_admin(uuid),
                          private.is_request_tenant_member(uuid)
to authenticated, service_role;

alter table public.workspaces enable row level security;
alter table public.workspace_memberships enable row level security;

create policy "workspace members can view workspace"
on public.workspaces
for select
to authenticated
using (private.is_workspace_member(id));

create policy "workspace admins can update workspace"
on public.workspaces
for update
to authenticated
using (private.is_workspace_admin(id))
with check (private.is_workspace_admin(id));

create policy "workspace members can view memberships"
on public.workspace_memberships
for select
to authenticated
using (private.is_workspace_member(workspace_id));

create policy "workspace admins can insert memberships"
on public.workspace_memberships
for insert
to authenticated
with check (private.is_workspace_admin(workspace_id));

create policy "workspace admins can update memberships"
on public.workspace_memberships
for update
to authenticated
using (private.is_workspace_admin(workspace_id))
with check (private.is_workspace_admin(workspace_id));

create policy "workspace admins can delete memberships"
on public.workspace_memberships
for delete
to authenticated
using (private.is_workspace_admin(workspace_id));

revoke all on table public.workspaces, public.workspace_memberships
from public, anon, authenticated, service_role;
grant select, update on table public.workspaces to authenticated;
grant select, insert, update, delete on table public.workspace_memberships to authenticated;
grant all on table public.workspaces, public.workspace_memberships to service_role;

create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function public.update_updated_at_column();

create trigger workspace_memberships_set_updated_at
before update on public.workspace_memberships
for each row execute function public.update_updated_at_column();

create or replace function public.create_tenant_with_owner(_tenant_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_tenant_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if nullif(btrim(_tenant_name), '') is null then
    raise exception 'tenant_name_required' using errcode = '22023';
  end if;

  insert into public.workspaces (name)
  values (btrim(_tenant_name))
  returning id into v_workspace_id;

  insert into public.tenants (workspace_id, name, plan_key)
  values (v_workspace_id, btrim(_tenant_name), 'free')
  returning id into v_tenant_id;

  insert into public.workspace_memberships (workspace_id, user_id, role, active)
  values (v_workspace_id, v_user_id, 'owner', true);

  insert into public.tenant_memberships (tenant_id, user_id, role, active)
  values (v_tenant_id, v_user_id, 'owner', true);

  return v_tenant_id;
end;
$function$;

comment on table public.workspaces is
  'Corporate group boundary for shared master data such as parties, people, vehicles and SSX.';
comment on column public.tenants.workspace_id is
  'Workspace that owns this legal/fiscal/accounting tenant.';
comment on function private.is_request_tenant_member(uuid) is
  'Fail-closed tenant authorization for fiscal, financial and document RLS policies.';
