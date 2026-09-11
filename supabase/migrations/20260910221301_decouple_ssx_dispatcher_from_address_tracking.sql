-- Keep the SSX scheduler autonomous. Its release must not depend on tables
-- owned by the optional address-resolution/tracking pipeline.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create or replace function public.claim_workspace_ssx_dispatch_v1(
  _limit integer default 8,
  _lease_seconds integer default 300
)
returns table(
  workspace_id uuid,
  integration_account_id uuid,
  tenant_id uuid,
  lease_token uuid,
  pipeline_mode text
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_limit integer := least(greatest(coalesce(_limit, 8), 1), 32);
  v_lease_seconds integer := least(greatest(coalesce(_lease_seconds, 300), 60), 900);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with candidates as materialized (
    select
      registry.workspace_id,
      registry.integration_account_id,
      account.tenant_id,
      case
        when registry.last_full_sync_at is null
          or registry.last_full_sync_at <= pg_catalog.now() - interval '6 hours'
          then 'full'::text
        else 'poll'::text
      end as pipeline_mode
    from public.workspace_ssx_accounts registry
    join public.integration_accounts account
      on account.id = registry.integration_account_id
     and lower(account.provider) = 'ssx'
    where registry.migration_state = 'ready'
      and registry.next_dispatch_at <= pg_catalog.now()
      and (
        registry.dispatch_lease_until is null
        or registry.dispatch_lease_until <= pg_catalog.now()
      )
      and (
        select count(*)
        from public.tenant_feature_policy policy
        where policy.tenant_id = account.tenant_id
          and policy.feature_key in ('ssx_enabled', 'ssx_kill_switch')
      ) = 2
      and exists (
        select 1
        from public.tenant_feature_policy policy
        where policy.tenant_id = account.tenant_id
          and policy.feature_key = 'ssx_enabled'
          and policy.enabled
      )
      and not exists (
        select 1
        from public.tenant_feature_policy policy
        where policy.tenant_id = account.tenant_id
          and policy.feature_key = 'ssx_kill_switch'
          and policy.enabled
      )
    order by registry.next_dispatch_at, registry.workspace_id
    for update of registry skip locked
    limit v_limit
  ), claimed as (
    update public.workspace_ssx_accounts registry
    set dispatch_lease_token = gen_random_uuid(),
        dispatch_lease_until = pg_catalog.now()
          + pg_catalog.make_interval(secs => v_lease_seconds),
        dispatch_lease_mode = candidate.pipeline_mode,
        last_dispatch_started_at = pg_catalog.now(),
        last_dispatch_status = 'running',
        last_dispatch_error_code = null,
        updated_at = pg_catalog.now()
    from candidates candidate
    where registry.workspace_id = candidate.workspace_id
    returning
      registry.workspace_id,
      registry.integration_account_id,
      candidate.tenant_id,
      registry.dispatch_lease_token,
      candidate.pipeline_mode
  )
  select claimed.* from claimed;
end;
$function$;

create or replace function public.ack_workspace_ssx_dispatch_v1(
  _workspace_id uuid,
  _lease_token uuid,
  _success boolean,
  _status text,
  _error_code text default null,
  _next_delay_seconds integer default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_delay integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if _workspace_id is null or _lease_token is null or _success is null then
    raise exception 'ssx_dispatch_ack_invalid' using errcode = '22023';
  end if;
  if _status not in ('success', 'partial', 'failed', 'attention_required') then
    raise exception 'ssx_dispatch_status_invalid' using errcode = '22023';
  end if;
  if _error_code is not null and (
    length(_error_code) > 100 or _error_code !~ '^[A-Za-z0-9_.:-]+$'
  ) then
    raise exception 'ssx_dispatch_error_code_invalid' using errcode = '22023';
  end if;

  v_delay := least(
    greatest(coalesce(_next_delay_seconds, case when _success then 180 else 600 end), 30),
    3600
  );

  update public.workspace_ssx_accounts registry
  set dispatch_lease_token = null,
      dispatch_lease_until = null,
      last_dispatch_finished_at = pg_catalog.now(),
      last_full_sync_at = case
        when _success and registry.dispatch_lease_mode = 'full' then pg_catalog.now()
        else registry.last_full_sync_at
      end,
      dispatch_lease_mode = null,
      next_dispatch_at = pg_catalog.now() + pg_catalog.make_interval(secs => v_delay),
      last_dispatch_status = _status,
      last_dispatch_error_code = _error_code,
      updated_at = pg_catalog.now()
  where registry.workspace_id = _workspace_id
    and registry.dispatch_lease_token = _lease_token;

  return found;
end;
$function$;

revoke all on function public.claim_workspace_ssx_dispatch_v1(integer, integer)
from public, anon, authenticated, service_role;
revoke all on function public.ack_workspace_ssx_dispatch_v1(uuid, uuid, boolean, text, text, integer)
from public, anon, authenticated, service_role;
grant execute on function public.claim_workspace_ssx_dispatch_v1(integer, integer)
to service_role;
grant execute on function public.ack_workspace_ssx_dispatch_v1(uuid, uuid, boolean, text, text, integer)
to service_role;

comment on function public.claim_workspace_ssx_dispatch_v1(integer, integer) is
  'Claims ready SSX workspace accounts with a bounded lease; independent of address-resolution scheduling.';
comment on function public.ack_workspace_ssx_dispatch_v1(uuid, uuid, boolean, text, text, integer) is
  'CAS acknowledgement for an SSX dispatcher claim; independent of address-resolution scheduling.';

do $postcondition$
declare
  v_claim_definition text;
  v_ack_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.claim_workspace_ssx_dispatch_v1(integer,integer)'::regprocedure
  ) into v_claim_definition;
  select pg_catalog.pg_get_functiondef(
    'public.ack_workspace_ssx_dispatch_v1(uuid,uuid,boolean,text,text,integer)'::regprocedure
  ) into v_ack_definition;

  if v_claim_definition ilike '%tenant_tracking_schedules%'
    or v_ack_definition ilike '%tenant_tracking_schedules%' then
    raise exception 'SSX dispatcher still depends on tenant_tracking_schedules';
  end if;

  if pg_catalog.has_function_privilege(
    'authenticated',
    'public.claim_workspace_ssx_dispatch_v1(integer,integer)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'public.ack_workspace_ssx_dispatch_v1(uuid,uuid,boolean,text,text,integer)',
    'EXECUTE'
  ) then
    raise exception 'Browser role must not execute SSX dispatcher RPCs';
  end if;
end;
$postcondition$;
