create or replace function private.sync_workspace_vehicle_projection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_normalized_plate text;
  v_workspace_vehicle_id uuid;
  v_previous_workspace_vehicle_id uuid;
begin
  v_normalized_plate := upper(regexp_replace(new.plate, '[^A-Za-z0-9]', '', 'g'));
  if v_normalized_plate = '' then
    raise exception 'vehicle_plate_required' using errcode = '23514';
  end if;

  select link.workspace_vehicle_id into v_previous_workspace_vehicle_id
  from public.workspace_vehicle_tenant_links link
  where link.tenant_id = new.tenant_id and link.vehicle_id = new.id;

  insert into public.workspace_vehicles(
    id, workspace_id, plate_normalized, plate, nickname, active,
    source_data, created_at, updated_at
  ) values (
    new.id, new.workspace_id, v_normalized_plate, new.plate, new.nickname, new.active,
    to_jsonb(new), new.created_at, new.updated_at
  )
  on conflict (workspace_id, plate_normalized) do update
    set plate = excluded.plate,
        nickname = excluded.nickname,
        active = excluded.active,
        source_data = excluded.source_data,
        updated_at = excluded.updated_at
  returning id into v_workspace_vehicle_id;

  delete from public.workspace_vehicle_tenant_links link
  where link.tenant_id = new.tenant_id and link.vehicle_id = new.id;

  insert into public.workspace_vehicle_tenant_links(
    workspace_id, workspace_vehicle_id, tenant_id, vehicle_id
  ) values (new.workspace_id, v_workspace_vehicle_id, new.tenant_id, new.id);

  if v_previous_workspace_vehicle_id is not null
    and v_previous_workspace_vehicle_id <> v_workspace_vehicle_id
    and not exists(
      select 1 from public.workspace_vehicle_tenant_links link
      where link.workspace_vehicle_id = v_previous_workspace_vehicle_id
    ) then
    delete from public.workspace_vehicles where id = v_previous_workspace_vehicle_id;
  end if;

  return new;
end;
$function$;

revoke all on function private.sync_workspace_vehicle_projection()
from public, anon, authenticated, service_role;

create trigger vehicles_sync_workspace_projection
after insert or update of plate,nickname,active,workspace_id on public.vehicles
for each row execute function private.sync_workspace_vehicle_projection();

create or replace function public.list_workspace_fleet_snapshot_v1(_tenant_id uuid)
returns table(
  id uuid,
  tenant_id uuid,
  source_tenant_id uuid,
  source_vehicle_id uuid,
  plate text,
  nickname text,
  type text,
  uf text,
  active boolean,
  tags jsonb,
  created_at timestamptz,
  max_pallets integer,
  max_weight_kg numeric,
  max_volume_m3 numeric,
  body_type text,
  current_driver_id uuid,
  renavam text,
  lat double precision,
  lng double precision,
  speed double precision,
  heading double precision,
  captured_at timestamptz,
  received_at timestamptz,
  movement_state text,
  last_movement_at timestamptz,
  stopped_since timestamptz,
  stopped_duration_seconds integer,
  state_updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
begin
  if auth.uid() is null or not private.is_request_tenant_member(_tenant_id) then
    raise exception 'workspace_fleet_not_authorized' using errcode = '42501';
  end if;

  select t.workspace_id into v_workspace_id
  from public.tenants t where t.id = _tenant_id;

  return query
  select
    fleet.id,
    _tenant_id,
    projection.tenant_id,
    projection.vehicle_id,
    fleet.plate,
    fleet.nickname,
    nullif(fleet.source_data ->> 'type', ''),
    nullif(fleet.source_data ->> 'uf', ''),
    fleet.active,
    coalesce(fleet.source_data -> 'tags', '[]'::jsonb),
    fleet.created_at,
    nullif(fleet.source_data ->> 'max_pallets', '')::integer,
    nullif(fleet.source_data ->> 'max_weight_kg', '')::numeric,
    nullif(fleet.source_data ->> 'max_volume_m3', '')::numeric,
    nullif(fleet.source_data ->> 'body_type', ''),
    nullif(fleet.source_data ->> 'current_driver_id', '')::uuid,
    nullif(fleet.source_data ->> 'renavam', ''),
    telemetry.lat,
    telemetry.lng,
    telemetry.speed,
    telemetry.heading,
    telemetry.captured_at,
    telemetry.received_at,
    state.movement_state,
    state.last_movement_at,
    state.stopped_since,
    coalesce(state.stopped_duration_seconds, 0),
    state.updated_at
  from public.workspace_vehicles fleet
  left join lateral (
    select link.tenant_id,link.vehicle_id
    from public.workspace_vehicle_tenant_links link
    where link.workspace_vehicle_id = fleet.id
    order by (link.tenant_id = _tenant_id) desc, link.created_at, link.vehicle_id
    limit 1
  ) projection on true
  left join lateral (
    select p.tenant_id,p.vehicle_id,p.lat,p.lng,p.speed,p.heading,p.captured_at,p.received_at
    from public.workspace_vehicle_tenant_links link
    join public.positions_last p
      on p.tenant_id = link.tenant_id and p.vehicle_id = link.vehicle_id
    where link.workspace_vehicle_id = fleet.id
    order by p.captured_at desc, p.received_at desc
    limit 1
  ) telemetry on true
  left join public.vehicles_state state
    on state.tenant_id = telemetry.tenant_id and state.vehicle_id = telemetry.vehicle_id
  where fleet.workspace_id = v_workspace_id
  order by fleet.plate_normalized, fleet.id;
end;
$function$;

revoke all on function public.list_workspace_fleet_snapshot_v1(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_workspace_fleet_snapshot_v1(uuid)
to authenticated, service_role;

comment on function public.list_workspace_fleet_snapshot_v1(uuid) is
  'Returns one row per physical workspace vehicle and its freshest telemetry across all tenant projections.';
