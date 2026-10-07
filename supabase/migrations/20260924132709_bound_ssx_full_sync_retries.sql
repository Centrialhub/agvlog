-- Keep failed full synchronizations visible while allowing position polling.
-- Successful full syncs retain their six-hour cadence; failed attempts retry
-- at most once an hour. Record the attempt at claim time, including timeouts.
set local lock_timeout = '3s';
set local statement_timeout = '15s';

alter table public.workspace_ssx_accounts
  add column if not exists last_full_sync_attempt_at timestamptz;

do $patch$
declare
  v_definition text := pg_get_functiondef(
    'public.claim_workspace_ssx_dispatch_v1(integer,integer)'::regprocedure
  );
  v_old_case text := $old$when registry.last_full_sync_at is null
          or registry.last_full_sync_at <= pg_catalog.now() - interval '6 hours'$old$;
  v_new_case text := $new$when (registry.last_full_sync_at is null
          or registry.last_full_sync_at <= pg_catalog.now() - interval '6 hours')
          and (registry.last_full_sync_attempt_at is null
            or registry.last_full_sync_attempt_at <= pg_catalog.now() - interval '1 hour')$new$;
  v_old_claim text := 'dispatch_lease_mode = candidate.pipeline_mode,';
  v_new_claim text := $new$dispatch_lease_mode = candidate.pipeline_mode,
        last_full_sync_attempt_at = case when candidate.pipeline_mode = 'full'
          then pg_catalog.now() else registry.last_full_sync_attempt_at end,$new$;
begin
  if position(v_old_case in v_definition) = 0
    or position(v_old_claim in v_definition) = 0
    or position('last_full_sync_attempt_at' in v_definition) > 0 then
    raise exception 'unexpected_ssx_dispatch_claim_definition';
  end if;
  execute replace(replace(v_definition, v_old_case, v_new_case), v_old_claim, v_new_claim);
end;
$patch$;

comment on column public.workspace_ssx_accounts.last_full_sync_attempt_at is
  'Last claimed full sync attempt; independent of successful full sync time. Bounds failed full retries to one hour.';
