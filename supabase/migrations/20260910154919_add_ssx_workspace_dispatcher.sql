-- One leased dispatcher target per workspace replaces the historical cron that
-- embedded a single tenant id. Claims and acknowledgements are service-only;
-- browser roles cannot inspect scheduler state.

alter table public.workspace_ssx_accounts
  add column if not exists dispatch_lease_token uuid,
  add column if not exists dispatch_lease_until timestamptz,
  add column if not exists dispatch_lease_mode text,
  add column if not exists next_dispatch_at timestamptz not null default now(),
  add column if not exists last_dispatch_started_at timestamptz,
  add column if not exists last_dispatch_finished_at timestamptz,
  add column if not exists last_full_sync_at timestamptz,
  add column if not exists last_dispatch_status text,
  add column if not exists last_dispatch_error_code text;

alter table public.workspace_ssx_accounts
  drop constraint if exists workspace_ssx_accounts_dispatch_lease_shape;
alter table public.workspace_ssx_accounts
  add constraint workspace_ssx_accounts_dispatch_lease_shape check (
    (dispatch_lease_token is null and dispatch_lease_until is null and dispatch_lease_mode is null)
    or
    (dispatch_lease_token is not null and dispatch_lease_until is not null
      and dispatch_lease_mode in ('poll', 'full'))
  );

create index if not exists workspace_ssx_accounts_dispatch_ready_idx
on public.workspace_ssx_accounts(next_dispatch_at, dispatch_lease_until)
where migration_state = 'ready';

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
  return query
  with candidates as materialized (
    select
      registry.workspace_id,
      registry.integration_account_id,
      account.tenant_id,
      case
        when registry.last_full_sync_at is null
          or registry.last_full_sync_at <= now() - make_interval(hours => schedule.full_sync_interval_hours)
          then 'full'::text
        else 'poll'::text
      end as pipeline_mode
    from public.workspace_ssx_accounts registry
    join public.integration_accounts account
      on account.id = registry.integration_account_id
     and lower(account.provider) = 'ssx'
    join public.tenant_tracking_schedules schedule
      on schedule.tenant_id = account.tenant_id
     and schedule.enabled
    where registry.migration_state = 'ready'
      and registry.next_dispatch_at <= now()
      and (
        registry.dispatch_lease_until is null
        or registry.dispatch_lease_until <= now()
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
        dispatch_lease_until = now() + make_interval(secs => v_lease_seconds),
        dispatch_lease_mode = candidate.pipeline_mode,
        last_dispatch_started_at = now(),
        last_dispatch_status = 'running',
        last_dispatch_error_code = null,
        updated_at = now()
    from candidates candidate
    where registry.workspace_id = candidate.workspace_id
    returning
      registry.workspace_id,
      registry.integration_account_id,
      candidate.tenant_id,
      registry.dispatch_lease_token,
      candidate.pipeline_mode
  ), schedules_updated as (
    update public.tenant_tracking_schedules schedule
    set last_poll_claimed_at = now(),
        last_full_claimed_at = case when claimed.pipeline_mode = 'full' then now() else schedule.last_full_claimed_at end,
        updated_at = now()
    from claimed
    where schedule.tenant_id = claimed.tenant_id
    returning schedule.tenant_id
  )
  select claimed.* from claimed join schedules_updated using(tenant_id);
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
  v_tenant_id uuid;
  v_acknowledged boolean;
begin
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

  select account.tenant_id into v_tenant_id
  from public.workspace_ssx_accounts registry
  join public.integration_accounts account on account.id=registry.integration_account_id
  where registry.workspace_id=_workspace_id and registry.dispatch_lease_token=_lease_token;

  v_delay := least(greatest(
    coalesce(_next_delay_seconds,case when _success then (
      select schedule.poll_interval_minutes*60 from public.tenant_tracking_schedules schedule
      where schedule.tenant_id=v_tenant_id
    ) else 600 end,600),
    30
  ), 3600);

  update public.workspace_ssx_accounts registry
  set dispatch_lease_token = null,
      dispatch_lease_until = null,
      last_dispatch_finished_at = now(),
      last_full_sync_at = case
        when _success and registry.dispatch_lease_mode = 'full' then now()
        else registry.last_full_sync_at
      end,
      dispatch_lease_mode = null,
      next_dispatch_at = now() + make_interval(secs => v_delay),
      last_dispatch_status = _status,
      last_dispatch_error_code = _error_code,
      updated_at = now()
  where registry.workspace_id = _workspace_id
    and registry.dispatch_lease_token = _lease_token;

  v_acknowledged:=found;
  if v_acknowledged then
    update public.tenant_tracking_schedules
    set last_finished_at=now(),last_status=_status,last_error=_error_code,
      consecutive_failures=case when _success then 0 else consecutive_failures+1 end,updated_at=now()
    where tenant_id=v_tenant_id;
  end if;
  return v_acknowledged;
end;
$function$;

revoke all on function public.claim_workspace_ssx_dispatch_v1(integer,integer)
from public, anon, authenticated, service_role;
revoke all on function public.ack_workspace_ssx_dispatch_v1(uuid,uuid,boolean,text,text,integer)
from public, anon, authenticated, service_role;
grant execute on function public.claim_workspace_ssx_dispatch_v1(integer,integer)
to service_role;
grant execute on function public.ack_workspace_ssx_dispatch_v1(uuid,uuid,boolean,text,text,integer)
to service_role;

comment on function public.claim_workspace_ssx_dispatch_v1(integer,integer) is
  'Claims ready SSX workspace accounts with SKIP LOCKED and a bounded lease. Uses the registration owner tenant only as the current capability anchor.';
comment on function public.ack_workspace_ssx_dispatch_v1(uuid,uuid,boolean,text,text,integer) is
  'CAS acknowledgement for an SSX dispatcher claim; stores only bounded status/error codes.';

-- Retire fixed-tenant jobs. Install one dispatcher job only when the standard
-- Supabase scheduling secrets already exist in Vault. The dispatcher has
-- verify_jwt=false but authenticates the cron secret itself, so pg_cron does
-- not need to receive or retain the project's public API key.
do $schedule_ssx_workspace_dispatcher$
declare
  v_has_schedule boolean := to_regprocedure('cron.schedule(text,text,text)') is not null;
  v_has_unschedule boolean := to_regprocedure('cron.unschedule(bigint)') is not null;
  v_has_secrets boolean := false;
begin
  if v_has_unschedule then
    perform cron.unschedule(job.jobid)
    from cron.job job
    where job.jobname in (
      'agvlog-poll-positions-3min',
      'agvlog-full-sync-6h',
      'agvlog-daily-aggregate',
      'agvlog-ssx-workspace-dispatcher'
    );
  end if;

  if to_regclass('vault.decrypted_secrets') is not null then
    select count(distinct secret.name) = 2
    into v_has_secrets
    from vault.decrypted_secrets secret
    where secret.name in ('project_url', 'agvlog_cron_secret');
  end if;

  if v_has_schedule and v_has_secrets then
    perform cron.schedule(
      'agvlog-ssx-workspace-dispatcher',
      '*/3 * * * *',
      $command$
        select net.http_post(
          url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url' limit 1)
            || '/functions/v1/agvlog-ssx-dispatcher',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-agvlog-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'agvlog_cron_secret' limit 1)
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 120000
        );
      $command$
    );
  end if;
end;
$schedule_ssx_workspace_dispatcher$;
