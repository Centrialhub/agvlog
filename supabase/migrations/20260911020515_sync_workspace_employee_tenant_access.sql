-- Internal employees belong to the workspace and may operate every legal
-- company in it. Portal clients remain tenant-specific and are never copied.

create or replace function private.sync_employee_from_tenant_membership_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_tenant_id uuid;
  v_user_id uuid;
  v_role public.app_role;
  v_active boolean := false;
  v_was_employee boolean := false;
  v_is_employee boolean := false;
begin
  if pg_catalog.pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_tenant_id := old.tenant_id;
    v_user_id := old.user_id;
    v_role := old.role;
    v_was_employee := old.role in ('owner', 'admin', 'operator', 'driver');
  else
    v_tenant_id := new.tenant_id;
    v_user_id := new.user_id;
    v_role := new.role;
    v_active := new.active;
    v_is_employee := new.role in ('owner', 'admin', 'operator', 'driver');
    if tg_op = 'UPDATE' then
      v_was_employee := old.role in ('owner', 'admin', 'operator', 'driver');
    end if;
  end if;

  select tenant.workspace_id
  into v_workspace_id
  from public.tenants tenant
  where tenant.id = v_tenant_id;

  if v_workspace_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op <> 'DELETE' and v_is_employee then
    insert into public.workspace_memberships (workspace_id, user_id, role, active)
    values (v_workspace_id, v_user_id, v_role, v_active)
    on conflict (workspace_id, user_id) do update
    set role = excluded.role,
        active = excluded.active,
        updated_at = now();

    insert into public.tenant_memberships (tenant_id, user_id, role, active)
    select tenant.id, v_user_id, v_role, v_active
    from public.tenants tenant
    where tenant.workspace_id = v_workspace_id
    order by tenant.id
    on conflict (tenant_id, user_id) do update
    set role = excluded.role,
        active = excluded.active,
        updated_at = now();
  elsif v_was_employee then
    update public.workspace_memberships
    set active = false,
        updated_at = now()
    where workspace_id = v_workspace_id
      and user_id = v_user_id;

    update public.tenant_memberships membership
    set active = false,
        updated_at = now()
    from public.tenants tenant
    where tenant.id = membership.tenant_id
      and tenant.workspace_id = v_workspace_id
      and membership.user_id = v_user_id
      and membership.role in ('owner', 'admin', 'operator', 'driver');
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

create or replace function private.sync_employee_from_workspace_membership_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_user_id uuid;
  v_role public.app_role;
  v_active boolean := false;
  v_was_employee boolean := false;
  v_is_employee boolean := false;
begin
  if pg_catalog.pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_workspace_id := old.workspace_id;
    v_user_id := old.user_id;
    v_role := old.role;
    v_was_employee := old.role in ('owner', 'admin', 'operator', 'driver');
  else
    v_workspace_id := new.workspace_id;
    v_user_id := new.user_id;
    v_role := new.role;
    v_active := new.active;
    v_is_employee := new.role in ('owner', 'admin', 'operator', 'driver');
    if tg_op = 'UPDATE' then
      v_was_employee := old.role in ('owner', 'admin', 'operator', 'driver');
    end if;
  end if;

  if tg_op <> 'DELETE' and v_is_employee then
    insert into public.tenant_memberships (tenant_id, user_id, role, active)
    select tenant.id, v_user_id, v_role, v_active
    from public.tenants tenant
    where tenant.workspace_id = v_workspace_id
    order by tenant.id
    on conflict (tenant_id, user_id) do update
    set role = excluded.role,
        active = excluded.active,
        updated_at = now();
  elsif v_was_employee then
    update public.tenant_memberships membership
    set active = false,
        updated_at = now()
    from public.tenants tenant
    where tenant.id = membership.tenant_id
      and tenant.workspace_id = v_workspace_id
      and membership.user_id = v_user_id
      and membership.role in ('owner', 'admin', 'operator', 'driver');
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

create or replace function private.provision_workspace_employees_for_tenant_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.tenant_memberships (tenant_id, user_id, role, active)
  select new.id, membership.user_id, membership.role, true
  from public.workspace_memberships membership
  where membership.workspace_id = new.workspace_id
    and membership.active
    and membership.role in ('owner', 'admin', 'operator', 'driver')
  order by membership.user_id
  on conflict (tenant_id, user_id) do update
  set role = excluded.role,
      active = true,
      updated_at = now();

  return new;
end;
$function$;

revoke all on function private.sync_employee_from_tenant_membership_v1(),
                       private.sync_employee_from_workspace_membership_v1(),
                       private.provision_workspace_employees_for_tenant_v1()
from public, anon, authenticated, service_role;

drop trigger if exists tenant_memberships_sync_workspace_employee
on public.tenant_memberships;
create trigger tenant_memberships_sync_workspace_employee
after insert or update of role, active or delete
on public.tenant_memberships
for each row execute function private.sync_employee_from_tenant_membership_v1();

drop trigger if exists workspace_memberships_sync_tenants
on public.workspace_memberships;
create trigger workspace_memberships_sync_tenants
after insert or update of role, active or delete
on public.workspace_memberships
for each row execute function private.sync_employee_from_workspace_membership_v1();

drop trigger if exists tenants_provision_workspace_employees
on public.tenants;
create trigger tenants_provision_workspace_employees
after insert on public.tenants
for each row execute function private.provision_workspace_employees_for_tenant_v1();

-- Repair existing workspaces before the triggers become the ongoing source of
-- truth. Stable ordering reduces deadlock risk when a workspace is large.
insert into public.tenant_memberships (tenant_id, user_id, role, active)
select tenant.id, membership.user_id, membership.role, true
from public.tenants tenant
join public.workspace_memberships membership
  on membership.workspace_id = tenant.workspace_id
where membership.active
  and membership.role in ('owner', 'admin', 'operator', 'driver')
order by tenant.id, membership.user_id
on conflict (tenant_id, user_id) do update
set role = excluded.role,
    active = true,
    updated_at = now();

-- The selector must show the registered company, not the technical tenant name
-- inherited from the account that originally created it.
create or replace function public.get_current_memberships_v1()
returns table (
  tenant_id uuid,
  role public.app_role,
  tenant_name text,
  plan_key text,
  timezone text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    membership.tenant_id,
    membership.role,
    coalesce(
      nullif(btrim(tenant.settings #>> '{company,trade_name}'), ''),
      nullif(btrim(tenant.settings #>> '{company,legal_name}'), ''),
      tenant.name
    ) as tenant_name,
    tenant.plan_key,
    tenant.timezone
  from public.tenant_memberships membership
  join public.tenants tenant on tenant.id = membership.tenant_id
  where membership.user_id = auth.uid()
    and membership.active
  order by tenant.created_at, tenant.id;
$function$;

revoke all on function public.get_current_memberships_v1()
from public, anon, authenticated, service_role;
grant execute on function public.get_current_memberships_v1()
to authenticated, service_role;

comment on function private.sync_employee_from_tenant_membership_v1() is
  'Keeps internal employee access aligned across every tenant in a workspace; client memberships remain tenant-specific.';
comment on function public.get_current_memberships_v1() is
  'Returns the signed-in user memberships using the registered company display name for the per-user tenant selector.';
