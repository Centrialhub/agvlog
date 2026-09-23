-- Keep the restored Control Tower runtime aligned with the current application
-- authorization contract. Tenant membership and the SSX capability gate remain
-- mandatory; privileged users are not blocked by a legacy AAL check that the
-- rest of the application no longer requires.

create or replace function control_tower_private.assert_evaluator(_tenant_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  _role public.app_role;
begin
  if auth.uid() is null then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select membership.role
  into _role
  from public.tenant_memberships membership
  where membership.tenant_id = _tenant_id
    and membership.user_id = auth.uid()
    and membership.active;

  if _role is null or _role not in ('owner', 'admin', 'operator') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.tenant_feature_policy policy
    where policy.tenant_id = _tenant_id
      and policy.feature_key = 'ssx_enabled'
      and policy.enabled
  ) or exists (
    select 1
    from public.tenant_feature_policy policy
    where policy.tenant_id = _tenant_id
      and policy.feature_key = 'ssx_kill_switch'
      and policy.enabled
  ) then
    raise exception 'SSX disabled' using errcode = '42501';
  end if;
end;
$function$;

create or replace function control_tower_private.assert_route_actor(_tenant_id uuid)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  _role public.app_role;
begin
  if auth.uid() is null then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select membership.role
  into _role
  from public.tenant_memberships membership
  where membership.tenant_id = _tenant_id
    and membership.user_id = auth.uid()
    and membership.active;

  if _role is null or _role not in ('owner', 'admin', 'operator') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
end;
$function$;

revoke all on function control_tower_private.assert_evaluator(uuid)
from public, anon, authenticated, service_role;
revoke all on function control_tower_private.assert_route_actor(uuid)
from public, anon, authenticated, service_role;

comment on function control_tower_private.assert_evaluator(uuid) is
  'Authorizes tenant operators for atomic Control Tower evaluation and enforces the SSX capability gate.';
comment on function control_tower_private.assert_route_actor(uuid) is
  'Authorizes tenant operators for recoverable Control Tower route calculation.';

-- The live reader and route/evaluation helpers are SECURITY INVOKER and use
-- this immutable catalog function to classify pending/completed stops. The
-- baseline exposed it only to service_role, which makes every authenticated
-- Control Tower read fail before tenant RLS can do its job.
alter function public.stop_terminal_statuses() security invoker;
grant execute on function public.stop_terminal_statuses() to authenticated;
