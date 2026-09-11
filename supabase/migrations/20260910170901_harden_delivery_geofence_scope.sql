set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $preflight$
begin
  if pg_catalog.to_regprocedure('public.dispatch_planned_route_v3(jsonb)') is null
    or pg_catalog.to_regprocedure('public.process_geofence_position_batch_v1(uuid,uuid,jsonb)') is null
    or pg_catalog.to_regclass('public.tenant_tracking_schedules') is null
    or pg_catalog.to_regprocedure('public.stop_terminal_statuses()') is null then
    raise exception 'delivery_geofence_scope_prerequisites_missing';
  end if;
end;
$preflight$;

-- Delivery fences are derived data. Keeping this write in a private trigger
-- prevents operators from receiving broad write access to the geofences table.
create or replace function private.sync_delivery_geofence_from_stop()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_trip_status text;
  v_policy public.geofence_radius_policies%rowtype;
  v_radius double precision;
  v_geometry extensions.geometry;
  v_eligible boolean;
begin
  select status into v_trip_status
  from public.dispatch_trips
  where tenant_id=new.tenant_id and id=new.dispatch_trip_id;
  if not found then raise exception 'delivery_geofence_trip_not_found' using errcode='23503'; end if;

  v_eligible:=new.latitude is not null and new.latitude between -90 and 90
    and new.longitude is not null and new.longitude between -180 and 180
    and (new.location_source in ('address_geocoded','map_selected')
      or length(btrim(coalesce(new.location_exception_reason,'')))>=20);

  if not v_eligible then
    delete from public.geofences
    where tenant_id=new.tenant_id and dispatch_stop_id=new.id and scope_kind='delivery';
    return new;
  end if;

  select * into v_policy
  from public.geofence_radius_policies
  where tenant_id=new.tenant_id and scope_kind='delivery' and category='delivery';
  v_radius:=coalesce(new.geofence_radius_m,v_policy.radius_m,500);
  v_geometry:=extensions.st_buffer(
    extensions.st_setsrid(extensions.st_makepoint(new.longitude,new.latitude),4326)::extensions.geography,
    v_radius
  )::extensions.geometry;

  insert into public.geofences(
    tenant_id,name,category,enabled,geometry,shape_kind,source_kind,source_address,
    center_lat,center_lng,radius_m,location_provider,location_accuracy_m,location_confidence,
    enter_margin_m,exit_margin_m,transition_confirmations,location_resolved_at,location_resolved_by,
    location_audit,scope_kind,dispatch_stop_id,radius_policy_key
  ) values (
    new.tenant_id,'Entrega '||new.stop_order||' · '||left(coalesce(new.destination,'Destino'),120),
    'delivery',v_trip_status in ('in_transit','in_progress')
      and not (new.status=any(public.stop_terminal_statuses())),v_geometry,'circle',new.location_source,
    new.location_address,new.latitude,new.longitude,v_radius,new.location_provider,new.location_accuracy_m,
    new.location_confidence,coalesce(v_policy.enter_margin_m,0),coalesce(v_policy.exit_margin_m,30),
    coalesce(v_policy.transition_confirmations,2),new.location_resolved_at,new.location_resolved_by,
    coalesce(new.location_audit,'{}'::jsonb),'delivery',new.id,'delivery:delivery'
  )
  on conflict(tenant_id,dispatch_stop_id) where dispatch_stop_id is not null do update set
    name=excluded.name,category=excluded.category,enabled=excluded.enabled,geometry=excluded.geometry,
    shape_kind=excluded.shape_kind,source_kind=excluded.source_kind,source_address=excluded.source_address,
    center_lat=excluded.center_lat,center_lng=excluded.center_lng,radius_m=excluded.radius_m,
    location_provider=excluded.location_provider,location_accuracy_m=excluded.location_accuracy_m,
    location_confidence=excluded.location_confidence,enter_margin_m=excluded.enter_margin_m,
    exit_margin_m=excluded.exit_margin_m,transition_confirmations=excluded.transition_confirmations,
    location_resolved_at=excluded.location_resolved_at,location_resolved_by=excluded.location_resolved_by,
    location_audit=excluded.location_audit,scope_kind='delivery',radius_policy_key='delivery:delivery';
  return new;
end;
$function$;

revoke all on function private.sync_delivery_geofence_from_stop() from public,anon,authenticated,service_role;
drop trigger if exists sync_delivery_geofence_from_stop on public.dispatch_stops;
create trigger sync_delivery_geofence_from_stop
after insert or update of dispatch_trip_id,stop_order,destination,status,latitude,longitude,location_source,
  location_address,location_provider,location_accuracy_m,location_confidence,location_resolved_at,
  location_resolved_by,location_audit,geofence_radius_m,location_exception_reason
on public.dispatch_stops for each row execute function private.sync_delivery_geofence_from_stop();

create or replace function private.sync_delivery_geofences_from_trip()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.geofences g
  set enabled=new.status in ('in_transit','in_progress')
    and not (s.status=any(public.stop_terminal_statuses()))
  from public.dispatch_stops s
  where g.tenant_id=new.tenant_id and g.scope_kind='delivery'
    and g.dispatch_stop_id=s.id and s.tenant_id=new.tenant_id and s.dispatch_trip_id=new.id;
  return new;
end;
$function$;

revoke all on function private.sync_delivery_geofences_from_trip() from public,anon,authenticated,service_role;
drop trigger if exists sync_delivery_geofences_from_trip on public.dispatch_trips;
create trigger sync_delivery_geofences_from_trip
after insert or update of status,vehicle_id on public.dispatch_trips
for each row execute function private.sync_delivery_geofences_from_trip();

-- Reconcile fences generated before lifecycle scoping existed.
update public.dispatch_stops s
set location_audit=s.location_audit
where (s.latitude is not null and s.longitude is not null
  and (s.location_source in ('address_geocoded','map_selected')
    or length(btrim(coalesce(s.location_exception_reason,'')))>=20))
  or exists(select 1 from public.geofences g
    where g.tenant_id=s.tenant_id and g.dispatch_stop_id=s.id and g.scope_kind='delivery');

-- v3 delegates fence materialization to the trigger, so operator dispatch no
-- longer attempts a direct insert blocked by the admin-only geofence policy.
create or replace function public.dispatch_planned_route_v3(_payload jsonb)
returns uuid language plpgsql security invoker set search_path=''
as $function$
declare
  v_stop jsonb;
  v_order integer:=0;
  v_source text;
  v_reason text;
  v_trip uuid;
  v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid;
  v_stop_id uuid;
begin
  for v_stop in select value from jsonb_array_elements(_payload->'stops') loop
    v_source:=coalesce(nullif(v_stop->>'location_source',''),'legacy_coordinates');
    v_reason:=nullif(btrim(v_stop->>'location_exception_reason'),'');
    if v_source in ('address_geocoded','map_selected') then
      if nullif(v_stop->>'latitude','')::double precision is null
        or nullif(v_stop->>'latitude','')::double precision not between -90 and 90
        or nullif(v_stop->>'longitude','')::double precision is null
        or nullif(v_stop->>'longitude','')::double precision not between -180 and 180 then
        raise exception 'dispatch_verified_location_coordinates_required' using errcode='23514';
      end if;
    elsif v_reason is null or length(v_reason)<20 then
      raise exception 'dispatch_location_verification_or_exception_required' using errcode='23514';
    end if;
  end loop;

  v_trip:=public.dispatch_planned_route_v2(_payload);
  for v_stop in select value from jsonb_array_elements(_payload->'stops') loop
    v_order:=v_order+1;
    v_reason:=nullif(btrim(v_stop->>'location_exception_reason'),'');
    select id into v_stop_id from public.dispatch_stops
    where tenant_id=v_tenant and dispatch_trip_id=v_trip and stop_order=v_order for update;
    if not found then raise exception 'dispatch_stop_not_found' using errcode='40001'; end if;
    if v_reason is not null then
      update public.dispatch_stops set location_exception_reason=v_reason,
        location_exception_at=clock_timestamp(),location_exception_by=auth.uid()
      where tenant_id=v_tenant and id=v_stop_id;
    end if;
  end loop;
  return v_trip;
end;
$function$;

revoke all on function public.dispatch_planned_route_v3(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dispatch_planned_route_v3(jsonb) to authenticated;

create or replace function public.process_geofence_position_batch_v2(
  _tenant_id uuid,_vehicle_id uuid,_points jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_fence record;
  v_state public.geofence_states%rowtype;
  v_point record;
  v_geom extensions.geometry;
  v_inside boolean;
  v_candidate boolean;
  v_pending_count integer;
  v_transition_count integer := 0;
  v_processed integer := 0;
  v_transitions jsonb := '[]'::jsonb;
  v_direction text;
begin
  if current_user not in ('service_role','postgres') then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  if _tenant_id is null or _vehicle_id is null or jsonb_typeof(_points) is distinct from 'array'
    or jsonb_array_length(_points)>5000 or octet_length(_points::text)>8388608 then
    raise exception 'invalid_geofence_position_batch' using errcode='22023';
  end if;
  if not exists(select 1 from public.vehicles where id=_vehicle_id and tenant_id=_tenant_id) then
    raise exception 'geofence_vehicle_tenant_mismatch' using errcode='23514';
  end if;
  if exists(
    select 1 from jsonb_to_recordset(_points) p(captured_at timestamptz,lat double precision,lng double precision,accuracy_m double precision)
    where captured_at is null or not isfinite(captured_at) or lat is null or lat not between -90 and 90
      or lng is null or lng not between -180 and 180 or (accuracy_m is not null and accuracy_m not between 0 and 1000)
  ) then raise exception 'invalid_geofence_position' using errcode='22023'; end if;

  for v_fence in
    select g.* from public.geofences g
    where g.tenant_id=_tenant_id and g.enabled
      and (g.scope_kind='fleet' or (g.scope_kind='delivery' and exists(
        select 1 from public.dispatch_stops s
        join public.dispatch_trips t on t.tenant_id=s.tenant_id and t.id=s.dispatch_trip_id
        where s.tenant_id=_tenant_id and s.id=g.dispatch_stop_id
          and t.vehicle_id=_vehicle_id and t.status in ('in_transit','in_progress')
          and not (s.status=any(public.stop_terminal_statuses()))
      )))
    order by g.id
  loop
    insert into public.geofence_states(tenant_id,vehicle_id,geofence_id,is_inside,last_checked_at,pending_count)
      values(_tenant_id,_vehicle_id,v_fence.id,false,clock_timestamp(),0)
      on conflict(tenant_id,vehicle_id,geofence_id) do nothing;
    select * into v_state from public.geofence_states
      where tenant_id=_tenant_id and vehicle_id=_vehicle_id and geofence_id=v_fence.id for update;

    for v_point in
      select * from jsonb_to_recordset(_points) p(captured_at timestamptz,lat double precision,lng double precision,accuracy_m double precision,provider_payload_hash text)
      where v_state.last_point_at is null or captured_at>v_state.last_point_at
      order by captured_at,provider_payload_hash
    loop
      v_geom := extensions.st_setsrid(extensions.st_makepoint(v_point.lng,v_point.lat),4326);
      if v_state.is_inside then
        v_inside := extensions.st_covers(v_fence.geometry,v_geom)
          or extensions.st_dwithin(v_fence.geometry::extensions.geography,v_geom::extensions.geography,v_fence.exit_margin_m);
      elsif v_fence.enter_margin_m>0 then
        v_inside := extensions.st_covers(v_fence.geometry,v_geom)
          and extensions.st_distance(
            extensions.st_boundary(v_fence.geometry)::extensions.geography,
            v_geom::extensions.geography
          )>=v_fence.enter_margin_m;
      else
        v_inside := extensions.st_covers(v_fence.geometry,v_geom);
      end if;

      if v_inside=v_state.is_inside then
        v_candidate:=null;v_pending_count:=0;
      else
        v_candidate:=v_inside;
        v_pending_count:=case when v_state.pending_inside is not distinct from v_inside then v_state.pending_count+1 else 1 end;
      end if;

      if v_candidate is not null and v_pending_count>=v_fence.transition_confirmations then
        v_direction:=case when v_candidate then 'enter' else 'exit' end;
        insert into public.geofence_events(tenant_id,vehicle_id,geofence_id,direction,event_at,payload)
          values(_tenant_id,_vehicle_id,v_fence.id,v_direction,v_point.captured_at,
            jsonb_build_object('geofence_name',v_fence.name,'lat',v_point.lat,'lng',v_point.lng,
              'provider_payload_hash',v_point.provider_payload_hash,'confirmed_points',v_pending_count,
              'exit_margin_m',v_fence.exit_margin_m));
        insert into public.events(tenant_id,vehicle_id,event_type,severity,source,event_at,payload)
          values(_tenant_id,_vehicle_id,'geofence_'||v_direction,'info','engine',v_point.captured_at,
            jsonb_build_object('geofence_id',v_fence.id,'geofence_name',v_fence.name,'direction',v_direction));
        insert into public.alert_instances(tenant_id,vehicle_id,rule_id,status,source,opened_at)
          select _tenant_id,_vehicle_id,r.id,'open','engine',v_point.captured_at
          from public.alert_rules r where r.tenant_id=_tenant_id and r.enabled and r.rule_type='geofence'
            and r.params->>'geofence_id'=v_fence.id::text
            and (nullif(r.params->>'direction','') is null or r.params->>'direction'=v_direction)
            and not exists(select 1 from public.alert_instances a where a.tenant_id=_tenant_id and a.vehicle_id=_vehicle_id
              and a.rule_id=r.id and a.source='engine' and a.status in ('open','ack'));
        v_transition_count:=v_transition_count+1;
        v_transitions:=v_transitions||jsonb_build_array(jsonb_build_object(
          'geofence_id',v_fence.id,'direction',v_direction,'event_at',v_point.captured_at));
        v_state.is_inside:=v_candidate;v_state.last_changed_at:=v_point.captured_at;
        v_candidate:=null;v_pending_count:=0;
      end if;

      v_state.pending_inside:=v_candidate;v_state.pending_count:=v_pending_count;
      v_state.last_point_at:=v_point.captured_at;v_state.last_lat:=v_point.lat;v_state.last_lng:=v_point.lng;
      v_processed:=v_processed+1;
    end loop;
    update public.geofence_states set is_inside=v_state.is_inside,last_changed_at=v_state.last_changed_at,
      last_checked_at=clock_timestamp(),pending_inside=v_state.pending_inside,pending_count=v_state.pending_count,
      last_point_at=v_state.last_point_at,last_lat=v_state.last_lat,last_lng=v_state.last_lng
    where tenant_id=_tenant_id and vehicle_id=_vehicle_id and geofence_id=v_fence.id;
  end loop;
  return jsonb_build_object('processed_points',v_processed,'transition_count',v_transition_count,'transitions',v_transitions);
end;
$function$;

revoke all on function public.process_geofence_position_batch_v2(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.process_geofence_position_batch_v2(uuid,uuid,jsonb) to service_role;

-- Missing kill-switch rows must fail safe in the same way as the rest of the
-- SSX capability checks: enabled present + no active kill switch means tracking is required.
create or replace function private.bind_dispatch_trip_tracker()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_link uuid;
  v_count integer;
  v_ssx_required boolean := false;
begin
  if new.status not in ('in_transit','in_progress') then return new; end if;
  select exists(select 1 from public.tenant_feature_policy p
      where p.tenant_id=new.tenant_id and p.feature_key='ssx_enabled' and p.enabled)
    and not exists(select 1 from public.tenant_feature_policy p
      where p.tenant_id=new.tenant_id and p.feature_key='ssx_kill_switch' and p.enabled)
    into v_ssx_required;
  select count(*),(array_agg(id order by id))[1] into v_count,v_link from public.vehicle_tracker_links
    where tenant_id=new.tenant_id and vehicle_id=new.vehicle_id and active
      and start_at<=coalesce(new.actual_start_at,clock_timestamp())
      and (end_at is null or end_at>coalesce(new.actual_start_at,clock_timestamp()));
  if v_count>1 then raise exception 'trip_tracker_binding_ambiguous' using errcode='23505'; end if;
  if v_ssx_required and v_count<>1 then raise exception 'trip_tracker_binding_required' using errcode='23514'; end if;
  if new.tracker_link_id is not null and new.tracker_link_id is distinct from v_link then
    raise exception 'trip_tracker_binding_mismatch' using errcode='23514';
  end if;
  new.tracker_link_id:=v_link;
  return new;
end;
$function$;

revoke all on function private.bind_dispatch_trip_tracker() from public,anon,authenticated,service_role;

do $postcondition$
begin
  if pg_catalog.to_regprocedure('public.process_geofence_position_batch_v2(uuid,uuid,jsonb)') is null
    or pg_catalog.to_regprocedure('private.sync_delivery_geofence_from_stop()') is null
    or pg_catalog.to_regprocedure('private.sync_delivery_geofences_from_trip()') is null
    or pg_catalog.has_function_privilege('anon','public.process_geofence_position_batch_v2(uuid,uuid,jsonb)','execute')
    or pg_catalog.has_function_privilege('authenticated','public.process_geofence_position_batch_v2(uuid,uuid,jsonb)','execute')
    or not pg_catalog.has_function_privilege('service_role','public.process_geofence_position_batch_v2(uuid,uuid,jsonb)','execute')
    or not exists(select 1 from pg_trigger where tgname='sync_delivery_geofence_from_stop' and not tgisinternal)
    or not exists(select 1 from pg_trigger where tgname='sync_delivery_geofences_from_trip' and not tgisinternal) then
    raise exception 'delivery_geofence_scope_postcondition_failed';
  end if;
end;
$postcondition$;
