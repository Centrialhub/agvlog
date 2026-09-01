begin;

-- Position tables are fed by trusted backend workers. Browser sessions only
-- receive the columns required by the operational UI; provider payloads,
-- hashes and the raw-position foreign key stay backend-only.
alter table public.positions_raw enable row level security;
alter table public.positions_last enable row level security;
alter table public.vehicles_state enable row level security;

revoke all privileges on table public.positions_raw from public, anon, authenticated, service_role;
revoke all privileges on table public.positions_last from public, anon, authenticated, service_role;
revoke all privileges on table public.vehicles_state from public, anon, authenticated, service_role;

grant select (
  id, tenant_id, vehicle_id, captured_at, received_at,
  lat, lng, speed, heading
) on public.positions_raw to authenticated;

grant select (
  tenant_id, vehicle_id, lat, lng, speed, heading,
  captured_at, received_at
) on public.positions_last to authenticated;

grant select (
  tenant_id, vehicle_id, lat, lng, speed, heading, movement_state,
  last_movement_at, last_position_at, stopped_since,
  stopped_duration_seconds, updated_at
) on public.vehicles_state to authenticated;

grant select, insert, update, delete on table public.positions_raw to service_role;
grant select, insert, update, delete on table public.positions_last to service_role;
grant select, insert, update, delete on table public.vehicles_state to service_role;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.driver_can_read_vehicle_position(
  _tenant_id uuid,
  _vehicle_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.dispatch_trips dt
      join public.drivers d
        on d.id = dt.driver_id
       and d.tenant_id = dt.tenant_id
      where dt.tenant_id = _tenant_id
        and dt.vehicle_id = _vehicle_id
        and d.user_id = (select auth.uid())
        and d.active = true
        and dt.status in (
          'planned', 'loading', 'dispatched', 'in_transit',
          'in_progress', 'en_route', 'arrived'
        )
    );
$function$;

revoke execute on function private.driver_can_read_vehicle_position(uuid, uuid)
from public, anon;
grant execute on function private.driver_can_read_vehicle_position(uuid, uuid)
to authenticated, service_role;

drop policy if exists "Members can view positions_raw" on public.positions_raw;
drop policy if exists positions_raw_select_internal on public.positions_raw;
create policy positions_raw_select_internal
on public.positions_raw
for select
to authenticated
using ((select public.is_user_internal_role(tenant_id)));

drop policy if exists "Members can view vehicles_state" on public.vehicles_state;
drop policy if exists vehicles_state_select_internal on public.vehicles_state;
create policy vehicles_state_select_internal
on public.vehicles_state
for select
to authenticated
using ((select public.is_user_internal_role(tenant_id)));

drop policy if exists positions_last_select_internal on public.positions_last;
create policy positions_last_select_internal
on public.positions_last
for select
to authenticated
using ((select public.is_user_internal_role(tenant_id)));

drop policy if exists positions_last_select_driver on public.positions_last;
create policy positions_last_select_driver
on public.positions_last
for select
to authenticated
using (
  (select private.driver_can_read_vehicle_position(tenant_id, vehicle_id))
);

create index if not exists idx_positions_raw_history_page
  on public.positions_raw (tenant_id, vehicle_id, captured_at, id);

create or replace function public.list_vehicle_position_history_v1(
  _tenant_id uuid,
  _vehicle_id uuid,
  _start_at timestamptz,
  _end_at timestamptz,
  _after_captured_at timestamptz default null,
  _after_id uuid default null,
  _page_size integer default 500
)
returns table (
  id uuid,
  tenant_id uuid,
  vehicle_id uuid,
  captured_at timestamptz,
  received_at timestamptz,
  lat double precision,
  lng double precision,
  speed double precision,
  heading double precision
)
language plpgsql
stable
security invoker
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'auth_required';
  end if;

  if _tenant_id is null
     or not coalesce(public.is_user_internal_role(_tenant_id), false) then
    raise exception using errcode = '42501', message = 'forbidden';
  end if;

  if _vehicle_id is null
     or _start_at is null
     or _end_at is null
     or _start_at >= _end_at
     or _end_at - _start_at > interval '31 days' then
    raise exception using errcode = '22023', message = 'invalid_position_history_window';
  end if;

  if _page_size is null or _page_size < 1 or _page_size > 500 then
    raise exception using errcode = '22023', message = 'invalid_page_size';
  end if;

  if (_after_captured_at is null) <> (_after_id is null) then
    raise exception using errcode = '22023', message = 'invalid_position_history_cursor';
  end if;

  return query
  select
    r.id,
    r.tenant_id,
    r.vehicle_id,
    r.captured_at,
    r.received_at,
    r.lat,
    r.lng,
    r.speed,
    r.heading
  from public.positions_raw r
  where r.tenant_id = _tenant_id
    and r.vehicle_id = _vehicle_id
    and r.captured_at >= _start_at
    and r.captured_at <= _end_at
    and (
      _after_captured_at is null
      or (r.captured_at, r.id) > (_after_captured_at, _after_id)
    )
  order by r.captured_at, r.id
  limit _page_size;
end;
$function$;

revoke execute on function public.list_vehicle_position_history_v1(
  uuid, uuid, timestamptz, timestamptz, timestamptz, uuid, integer
) from public, anon, service_role;
grant execute on function public.list_vehicle_position_history_v1(
  uuid, uuid, timestamptz, timestamptz, timestamptz, uuid, integer
) to authenticated, service_role;

comment on function public.list_vehicle_position_history_v1(
  uuid, uuid, timestamptz, timestamptz, timestamptz, uuid, integer
) is
  'Bounded keyset history reader for active owner/admin/operator memberships. Provider payloads and hashes are never returned.';

commit;
