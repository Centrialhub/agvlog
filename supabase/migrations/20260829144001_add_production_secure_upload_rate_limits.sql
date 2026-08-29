-- Persistent, atomic per-actor quotas for the service-role upload gateway.
-- Browser roles cannot read or write the rate ledger directly.

create table public.secure_upload_rate_events (
  id bigint generated always as identity primary key,
  actor_fingerprint text not null check (actor_fingerprint ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('upload', 'cleanup')),
  occurred_at timestamptz not null default now()
);

create index secure_upload_rate_events_actor_window_idx
  on public.secure_upload_rate_events (actor_fingerprint, action, occurred_at desc);

alter table public.secure_upload_rate_events enable row level security;
revoke all on table public.secure_upload_rate_events from public, anon, authenticated;
revoke all on sequence public.secure_upload_rate_events_id_seq from public, anon, authenticated;
grant select, insert, delete on table public.secure_upload_rate_events to service_role;
grant usage, select on sequence public.secure_upload_rate_events_id_seq to service_role;

create or replace function public.consume_secure_upload_quota_v1(
  p_actor_fingerprint text,
  p_action text,
  p_max_requests integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  recent_count integer;
begin
  if p_actor_fingerprint !~ '^[0-9a-f]{64}$'
     or p_action not in ('upload', 'cleanup')
     or p_max_requests not between 1 and 100
     or p_window_seconds not between 1 and 3600 then
    raise exception 'invalid_rate_limit_request';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_fingerprint || ':' || p_action, 0)
  );

  select count(*)::integer
    into recent_count
  from public.secure_upload_rate_events
  where actor_fingerprint = p_actor_fingerprint
    and action = p_action
    and occurred_at >= pg_catalog.clock_timestamp() - pg_catalog.make_interval(secs => p_window_seconds);

  if recent_count >= p_max_requests then
    return false;
  end if;

  insert into public.secure_upload_rate_events(actor_fingerprint, action)
  values (p_actor_fingerprint, p_action);
  return true;
end;
$function$;

revoke all on function public.consume_secure_upload_quota_v1(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_secure_upload_quota_v1(text, text, integer, integer)
  to service_role;

create or replace function public.purge_secure_upload_rate_events_v1()
returns bigint
language plpgsql
security definer
set search_path to ''
as $function$
declare
  removed bigint;
begin
  delete from public.secure_upload_rate_events
  where occurred_at < pg_catalog.clock_timestamp() - interval '1 day';
  get diagnostics removed = row_count;
  return removed;
end;
$function$;

revoke all on function public.purge_secure_upload_rate_events_v1()
  from public, anon, authenticated;
grant execute on function public.purge_secure_upload_rate_events_v1()
  to service_role;

do $schedule$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'purge-secure-upload-rate-events';
    perform cron.schedule(
      'purge-secure-upload-rate-events',
      '23 3 * * *',
      $command$select public.purge_secure_upload_rate_events_v1();$command$
    );
  end if;
end;
$schedule$;

comment on table public.secure_upload_rate_events is
  'Backend-only one-day ledger used for atomic upload and cleanup quotas.';
