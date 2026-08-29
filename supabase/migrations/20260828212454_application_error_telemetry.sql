-- Minimal, backend-only frontend exception telemetry. Free-form request bodies
-- are never persisted: the Edge collector writes only allowlisted, bounded
-- fields and one-way actor/tenant fingerprints.

create table public.application_error_events (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null,
  actor_fingerprint text not null check (actor_fingerprint ~ '^[0-9a-f]{64}$'),
  tenant_fingerprint text check (tenant_fingerprint is null or tenant_fingerprint ~ '^[0-9a-f]{64}$'),
  release text not null check (char_length(release) between 1 and 80),
  route text not null check (char_length(route) between 1 and 200),
  error_name text not null check (char_length(error_name) between 1 and 80),
  safe_message text not null check (char_length(safe_message) between 1 and 500),
  component_stack text check (component_stack is null or char_length(component_stack) <= 2000),
  phase text check (phase is null or phase in ('boundary', 'window', 'promise', 'manual')),
  client_family text check (client_family is null or char_length(client_family) <= 80),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index application_error_events_received_idx
  on public.application_error_events (received_at desc);
create index application_error_events_correlation_idx
  on public.application_error_events (correlation_id);
create index application_error_events_actor_rate_idx
  on public.application_error_events (actor_fingerprint, received_at desc);

alter table public.application_error_events enable row level security;
revoke all on table public.application_error_events from public, anon, authenticated;
grant select, insert, delete on table public.application_error_events to service_role;

create or replace function public.purge_application_error_events_v1()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  deleted_rows bigint;
begin
  delete from public.application_error_events
  where received_at < clock_timestamp() - interval '30 days';
  get diagnostics deleted_rows = row_count;
  return deleted_rows;
end;
$function$;

revoke all on function public.purge_application_error_events_v1()
  from public, anon, authenticated;
grant execute on function public.purge_application_error_events_v1()
  to service_role;

do $schedule$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'agvlog-application-error-retention'
  loop
    perform cron.unschedule(existing_job);
  end loop;

  perform cron.schedule(
    'agvlog-application-error-retention',
    '15 3 * * *',
    $command$select public.purge_application_error_events_v1();$command$
  );
end;
$schedule$;

comment on table public.application_error_events is
  'Sanitized frontend exception signals with 30-day retention; backend-only.';
