-- Forward-only restoration of mandatory AAL2 authorization for owner/admin.
-- The frontend enrollment/challenge gate ships in the same release.

create or replace function public.session_has_privileged_mfa_v1(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    not exists (
      select 1
      from public.tenant_memberships membership
      where membership.user_id = auth.uid()
        and membership.tenant_id = p_tenant_id
        and membership.active
        and membership.role::text in ('owner', 'admin')
    )
    or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2';
$function$;

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
    and membership.active
    and (
      membership.role::text not in ('owner', 'admin')
      or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
    );
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
      and (
        membership.role::text not in ('owner', 'admin')
        or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      )
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
      and (
        membership.role::text not in ('owner', 'admin')
        or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
      )
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
      and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
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
      and (
        membership.role::text = 'operator'
        or (
          membership.role::text in ('owner', 'admin')
          and coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2'
        )
      )
  );
$function$;

create or replace function public.is_user_internal_role(_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.is_tenant_operator_or_admin(_tenant_id);
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
  where public.session_has_privileged_mfa_v1(tenant.id)
    and tenant.id in (
      select membership.tenant_id
      from public.tenant_memberships membership
      where membership.user_id = auth.uid() and membership.active
      union
      select access.tenant_id
      from public.client_portal_access access
      where access.user_id = auth.uid() and access.active
    );
$function$;

revoke all on function public.session_has_privileged_mfa_v1(uuid) from public, anon, authenticated;
grant execute on function public.session_has_privileged_mfa_v1(uuid) to service_role;

comment on function public.session_has_privileged_mfa_v1(uuid)
  is 'Release gate: owner/admin tenant access requires an AAL2 JWT; non-privileged roles keep their existing access model.';
