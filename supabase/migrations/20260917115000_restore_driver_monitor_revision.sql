alter table public.driver_route_monitors
  add column if not exists revision bigint not null default 0;

do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.driver_route_monitors'::regclass
      and conname = 'driver_route_monitors_revision_nonnegative'
  ) then
    alter table public.driver_route_monitors
      add constraint driver_route_monitors_revision_nonnegative check (revision >= 0) not valid;
  end if;
end;
$constraints$;

alter table public.driver_route_monitors
  validate constraint driver_route_monitors_revision_nonnegative;

comment on column public.driver_route_monitors.revision is
  'Optimistic-concurrency revision consumed by canonical driver-monitor commands.';
