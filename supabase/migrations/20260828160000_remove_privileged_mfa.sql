-- Product decision: privileged users authenticate with the same single-factor
-- session as the remaining roles. Tenant membership and role authorization
-- remain mandatory at every database boundary.

create or replace function public.get_user_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select membership.tenant_id
  from public.tenant_memberships membership
  where membership.user_id = auth.uid()
    and membership.active;
$function$;

create or replace function public.has_tenant_role(_tenant_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = auth.uid()
      and membership.tenant_id = _tenant_id
      and membership.role = _role
      and membership.active
  );
$function$;

create or replace function public.is_tenant_member(_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = auth.uid()
      and membership.tenant_id = _tenant_id
      and membership.active
  );
$function$;

create or replace function public.is_tenant_admin(_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = auth.uid()
      and membership.tenant_id = _tenant_id
      and membership.role::text in ('owner', 'admin')
      and membership.active
  );
$function$;

create or replace function public.is_tenant_operator_or_admin(_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.user_id = auth.uid()
      and membership.tenant_id = _tenant_id
      and membership.active
      and membership.role::text in ('owner', 'admin', 'operator')
  );
$function$;

create or replace function public.get_user_portal_tenants()
returns table(id uuid, name text, plan_key text, timezone text)
language sql
stable
security definer
set search_path = ''
as $function$
  select distinct tenant.id, tenant.name, tenant.plan_key, tenant.timezone
  from public.tenants tenant
  where tenant.id in (
    select membership.tenant_id
    from public.tenant_memberships membership
    where membership.user_id = auth.uid() and membership.active
    union
    select access.tenant_id
    from public.client_portal_access access
    where access.user_id = auth.uid() and access.active
  );
$function$;

drop function if exists public.session_has_privileged_mfa_v1(uuid);

comment on function public.get_current_memberships_v1()
  is 'Returns the current user active memberships for authenticated tenant and role discovery.';
