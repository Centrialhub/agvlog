-- Canonical, fail-closed tenant capabilities for integrations excluded from
-- the initial production scope. The existing tenant_feature_policy table is
-- reused so navigation and backend authorization share one source of truth.

alter table public.tenant_feature_policy
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists updated_by uuid references auth.users(id) on delete set null;

insert into public.tenant_feature_policy (tenant_id, feature_key, enabled, notes)
select tenant.id, capability.feature_key, false, 'Disabled by default for the core launch'
from public.tenants tenant
cross join (
  values
    ('ssx_enabled'::text),
    ('fiscal_enabled'::text),
    ('ssx_kill_switch'::text),
    ('fiscal_kill_switch'::text)
) capability(feature_key)
on conflict (tenant_id, feature_key) do nothing;

create or replace function public.seed_tenant_integration_capabilities_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.tenant_feature_policy (tenant_id, feature_key, enabled, notes)
  values
    (new.id, 'ssx_enabled', false, 'Disabled by default for the core launch'),
    (new.id, 'fiscal_enabled', false, 'Disabled by default for the core launch'),
    (new.id, 'ssx_kill_switch', false, 'Independent emergency stop'),
    (new.id, 'fiscal_kill_switch', false, 'Independent emergency stop')
  on conflict (tenant_id, feature_key) do nothing;
  return new;
end;
$function$;

drop trigger if exists seed_tenant_integration_capabilities on public.tenants;
create trigger seed_tenant_integration_capabilities
after insert on public.tenants
for each row execute function public.seed_tenant_integration_capabilities_v1();

create or replace function public.get_tenant_integration_capabilities_v1(_tenant_id uuid)
returns table (
  ssx_enabled boolean,
  fiscal_enabled boolean,
  ssx_kill_switch boolean,
  fiscal_kill_switch boolean,
  ssx_effective boolean,
  fiscal_effective boolean,
  ssx_status text,
  fiscal_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_ssx_enabled boolean := false;
  v_fiscal_enabled boolean := false;
  v_ssx_kill_switch boolean := false;
  v_fiscal_kill_switch boolean := false;
  v_ssx_configured boolean := false;
  v_ssx_degraded boolean := false;
  v_fiscal_configured boolean := false;
begin
  if auth.uid() is null or not public.is_tenant_member(_tenant_id) then
    raise exception using errcode = '42501', message = 'tenant_access_denied';
  end if;

  select
    coalesce(bool_or(policy.enabled) filter (where policy.feature_key = 'ssx_enabled'), false),
    coalesce(bool_or(policy.enabled) filter (where policy.feature_key = 'fiscal_enabled'), false),
    coalesce(bool_or(policy.enabled) filter (where policy.feature_key = 'ssx_kill_switch'), false),
    coalesce(bool_or(policy.enabled) filter (where policy.feature_key = 'fiscal_kill_switch'), false)
  into v_ssx_enabled, v_fiscal_enabled, v_ssx_kill_switch, v_fiscal_kill_switch
  from public.tenant_feature_policy policy
  where policy.tenant_id = _tenant_id;

  select
    coalesce(bool_or(account.status in ('ok', 'pending', 'degraded')), false),
    coalesce(bool_or(account.status in ('degraded', 'invalid_credentials') or account.last_error is not null), false)
  into v_ssx_configured, v_ssx_degraded
  from public.integration_accounts account
  where account.tenant_id = _tenant_id and lower(account.provider) = 'ssx';

  select exists (
    select 1 from public.tenant_emitters emitter
    where emitter.tenant_id = _tenant_id and emitter.active
  ) into v_fiscal_configured;

  return query select
    v_ssx_enabled,
    v_fiscal_enabled,
    v_ssx_kill_switch,
    v_fiscal_kill_switch,
    v_ssx_enabled and not v_ssx_kill_switch,
    v_fiscal_enabled and not v_fiscal_kill_switch,
    case
      when not v_ssx_enabled or v_ssx_kill_switch then 'disabled'
      when not v_ssx_configured then 'not_configured'
      when v_ssx_degraded then 'degraded'
      else 'healthy'
    end,
    case
      when not v_fiscal_enabled or v_fiscal_kill_switch then 'disabled'
      when not v_fiscal_configured then 'not_configured'
      else 'healthy'
    end;
end;
$function$;

create or replace function public.assert_tenant_integration_capability_v1(
  _tenant_id uuid,
  _capability text
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_enabled boolean := false;
  v_kill_switch boolean := false;
begin
  if _capability not in ('ssx', 'fiscal') then
    raise exception using errcode = '22023', message = 'unknown_integration_capability';
  end if;

  select
    coalesce(bool_or(policy.enabled) filter (where policy.feature_key = _capability || '_enabled'), false),
    coalesce(bool_or(policy.enabled) filter (where policy.feature_key = _capability || '_kill_switch'), false)
  into v_enabled, v_kill_switch
  from public.tenant_feature_policy policy
  where policy.tenant_id = _tenant_id;

  if not v_enabled or v_kill_switch then
    raise exception using
      errcode = '42501',
      message = 'integration_capability_disabled',
      detail = _capability;
  end if;
end;
$function$;

-- Existing production RLS policies are already consolidated as agvlog_*.
-- Keep them intact to avoid introducing permissive overlaps.

-- Enable Fiscal only for tenants that are already operationally configured.
update public.tenant_feature_policy policy
set enabled = true,
    notes = 'Enabled during production readiness: active emitter and active Hub Fiscal credential',
    updated_at = now()
where policy.feature_key = 'fiscal_enabled'
  and exists (
    select 1
    from public.tenant_emitters emitter
    join public.hub_fiscal_credentials credential
      on credential.tenant_id = emitter.tenant_id
     and credential.emitter_id = emitter.id
     and credential.enabled
    where emitter.tenant_id = policy.tenant_id
      and emitter.active
  );

revoke all on function public.seed_tenant_integration_capabilities_v1() from public, anon, authenticated;
revoke all on function public.get_tenant_integration_capabilities_v1(uuid) from public, anon;
revoke all on function public.assert_tenant_integration_capability_v1(uuid, text) from public, anon, authenticated;

grant execute on function public.get_tenant_integration_capabilities_v1(uuid) to authenticated;
grant execute on function public.assert_tenant_integration_capability_v1(uuid, text) to service_role;

comment on function public.get_tenant_integration_capabilities_v1(uuid)
  is 'Canonical member-visible SSX/fiscal capability and operational health state for one tenant.';
comment on function public.assert_tenant_integration_capability_v1(uuid, text)
  is 'Fail-closed backend guard for SSX and fiscal Edge Functions; callable only by service_role.';
