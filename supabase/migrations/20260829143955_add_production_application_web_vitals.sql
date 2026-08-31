create table public.application_web_vitals (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null,
  actor_fingerprint text not null check (actor_fingerprint ~ '^[0-9a-f]{64}$'),
  tenant_fingerprint text check (tenant_fingerprint is null or tenant_fingerprint ~ '^[0-9a-f]{64}$'),
  release text not null check (char_length(release) between 1 and 80),
  route text not null check (char_length(route) between 1 and 200),
  metric_name text not null check (metric_name in ('LCP', 'CLS', 'INP', 'TTFB')),
  metric_value numeric not null check (metric_value >= 0 and metric_value < 10000000),
  rating text not null check (rating in ('good', 'needs-improvement', 'poor')),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index application_web_vitals_release_metric_idx
  on public.application_web_vitals (release, metric_name, received_at desc);
create index application_web_vitals_actor_rate_idx
  on public.application_web_vitals (actor_fingerprint, received_at desc);

alter table public.application_web_vitals enable row level security;
revoke all on table public.application_web_vitals from public, anon, authenticated;
grant select, insert, delete on table public.application_web_vitals to service_role;

create or replace function public.purge_application_error_events_v1()
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  deleted_errors bigint;
  deleted_vitals bigint;
begin
  delete from public.application_error_events
  where received_at < clock_timestamp() - interval '30 days';
  get diagnostics deleted_errors = row_count;

  delete from public.application_web_vitals
  where received_at < clock_timestamp() - interval '30 days';
  get diagnostics deleted_vitals = row_count;
  return deleted_errors + deleted_vitals;
end;
$function$;

comment on table public.application_web_vitals is
  'Sanitized authenticated Web Vitals by immutable release and route; 30-day retention.';
