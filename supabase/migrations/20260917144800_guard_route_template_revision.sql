-- Prevent an editor opened on a stale route snapshot from replacing a newer
-- route definition (including its complete waypoint set).
alter table public.route_templates
  add column if not exists revision bigint not null default 1;

alter table public.route_templates
  drop constraint if exists route_templates_revision_positive;
alter table public.route_templates
  add constraint route_templates_revision_positive check (revision > 0);

create or replace function finance_private.save_route_template_unsafe_20260917(_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
set row_security = 'on'
as $fn$
declare
  v_tenant uuid := nullif(_payload->>'tenant_id', '')::uuid;
  v_id uuid := nullif(_payload->>'route_id', '')::uuid;
  v_expected_revision bigint := nullif(_payload->>'expected_revision', '')::bigint;
  v_route public.route_templates%rowtype;
  v_waypoints jsonb := coalesce(_payload->'waypoints', '[]'::jsonb);
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  if v_tenant is null or not public.is_tenant_admin(v_tenant) then raise exception 'admin_required'; end if;
  if jsonb_typeof(v_waypoints) <> 'array' then raise exception 'invalid_waypoints'; end if;

  if v_id is null then
    insert into public.route_templates(
      tenant_id, name, corridor_geofence_id, corridor_inside_ratio_threshold,
      allowed_outside_minutes, route_speed_limit_kmh, enabled
    ) values (
      v_tenant, _payload->>'name', nullif(_payload->>'corridor_geofence_id', '')::uuid,
      nullif(_payload->>'corridor_inside_ratio_threshold', '')::numeric,
      coalesce(nullif(_payload->>'allowed_outside_minutes', '')::integer, 5),
      nullif(_payload->>'route_speed_limit_kmh', '')::integer,
      coalesce((_payload->>'enabled')::boolean, true)
    ) returning * into v_route;
    v_id := v_route.id;
  else
    if v_expected_revision is null then
      raise exception 'expected_route_revision_required' using errcode = '22023';
    end if;

    select * into v_route
      from public.route_templates
      where id = v_id and tenant_id = v_tenant
      for update;
    if not found then raise exception 'route_not_found'; end if;
    if v_route.revision <> v_expected_revision then
      raise exception 'route_template_changed'
        using errcode = '40001',
              detail = format('expected revision %s, current revision %s', v_expected_revision, v_route.revision),
              hint = 'Reload the route before saving your changes.';
    end if;

    update public.route_templates set
      name = _payload->>'name',
      corridor_geofence_id = nullif(_payload->>'corridor_geofence_id', '')::uuid,
      corridor_inside_ratio_threshold = nullif(_payload->>'corridor_inside_ratio_threshold', '')::numeric,
      allowed_outside_minutes = coalesce(nullif(_payload->>'allowed_outside_minutes', '')::integer, 5),
      route_speed_limit_kmh = nullif(_payload->>'route_speed_limit_kmh', '')::integer,
      enabled = coalesce((_payload->>'enabled')::boolean, true),
      revision = revision + 1
      where id = v_id and tenant_id = v_tenant
      returning * into v_route;
  end if;

  delete from public.route_waypoints where route_id = v_id and tenant_id = v_tenant;
  insert into public.route_waypoints(
    tenant_id, route_id, waypoint_order, waypoint_type, label, address,
    poi_id, geofence_id, estimated_duration_min, notes, lat, lng
  )
  select v_tenant, v_id, coalesce(x.waypoint_order, ord - 1),
    coalesce(x.waypoint_type, 'stop'::public.waypoint_type), x.label, x.address,
    x.poi_id, x.geofence_id, x.estimated_duration_min, x.notes, x.lat, x.lng
  from jsonb_to_recordset(v_waypoints) with ordinality as x(
    waypoint_order integer, waypoint_type public.waypoint_type, label text,
    address text, poi_id uuid, geofence_id uuid, estimated_duration_min integer,
    notes text, lat double precision, lng double precision, ord bigint
  );

  return to_jsonb(v_route);
end;
$fn$;

revoke all on function finance_private.save_route_template_unsafe_20260917(jsonb)
  from public, anon, authenticated, service_role;
