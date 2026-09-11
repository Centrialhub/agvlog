set local lock_timeout = '3s';
set local statement_timeout = '60s';

do $preflight$
begin
  if pg_catalog.to_regclass('public.dispatch_stops') is null
    or pg_catalog.to_regclass('public.geofences') is null
    or pg_catalog.to_regclass('public.geofence_states') is null
    or pg_catalog.to_regclass('public.geofence_events') is null
    or pg_catalog.to_regclass('public.vehicle_tracker_links') is null then
    raise exception 'driver_geocoding_geofence_tracking_prerequisites_missing';
  end if;
end;
$preflight$;

alter table public.dispatch_stops
  add column if not exists location_source text not null default 'legacy_coordinates',
  add column if not exists location_address text,
  add column if not exists location_provider text,
  add column if not exists location_accuracy_m double precision,
  add column if not exists location_confidence double precision,
  add column if not exists location_resolved_at timestamptz,
  add column if not exists location_resolved_by uuid,
  add column if not exists location_audit jsonb not null default '{}'::jsonb,
  add column if not exists geofence_radius_m double precision not null default 500;

alter table public.dispatch_stops
  drop constraint if exists dispatch_stops_location_source_check,
  add constraint dispatch_stops_location_source_check
    check (location_source in ('address_geocoded','map_selected','imported','legacy_coordinates')),
  drop constraint if exists dispatch_stops_location_accuracy_check,
  add constraint dispatch_stops_location_accuracy_check
    check (location_accuracy_m is null or location_accuracy_m between 0 and 100000),
  drop constraint if exists dispatch_stops_location_confidence_check,
  add constraint dispatch_stops_location_confidence_check
    check (location_confidence is null or location_confidence between 0 and 1),
  drop constraint if exists dispatch_stops_geofence_radius_check,
  add constraint dispatch_stops_geofence_radius_check
    check (geofence_radius_m between 50 and 5000);

alter table public.geofences
  add column if not exists shape_kind text not null default 'polygon',
  add column if not exists source_kind text not null default 'legacy_coordinates',
  add column if not exists source_address text,
  add column if not exists center_lat double precision,
  add column if not exists center_lng double precision,
  add column if not exists radius_m double precision,
  add column if not exists location_provider text,
  add column if not exists location_accuracy_m double precision,
  add column if not exists location_confidence double precision,
  add column if not exists enter_margin_m double precision not null default 0,
  add column if not exists exit_margin_m double precision not null default 30,
  add column if not exists transition_confirmations integer not null default 2,
  add column if not exists location_resolved_at timestamptz,
  add column if not exists location_resolved_by uuid,
  add column if not exists location_audit jsonb not null default '{}'::jsonb;

alter table public.geofences
  drop constraint if exists geofences_shape_kind_check,
  add constraint geofences_shape_kind_check check (shape_kind in ('circle','polygon')),
  drop constraint if exists geofences_source_kind_check,
  add constraint geofences_source_kind_check
    check (source_kind in ('address_geocoded','map_selected','imported','legacy_coordinates')),
  drop constraint if exists geofences_center_check,
  add constraint geofences_center_check check (
    (center_lat is null and center_lng is null)
    or (center_lat between -90 and 90 and center_lng between -180 and 180)
  ),
  drop constraint if exists geofences_radius_check,
  add constraint geofences_radius_check check (radius_m is null or radius_m between 50 and 50000),
  drop constraint if exists geofences_hysteresis_check,
  add constraint geofences_hysteresis_check check (
    enter_margin_m between 0 and 1000 and exit_margin_m between 0 and 2000
    and transition_confirmations between 1 and 10
  );

alter table public.geofence_states
  add column if not exists pending_inside boolean,
  add column if not exists pending_count integer not null default 0,
  add column if not exists last_point_at timestamptz,
  add column if not exists last_lat double precision,
  add column if not exists last_lng double precision;

alter table public.dispatch_trips
  add column if not exists tracker_link_id uuid references public.vehicle_tracker_links(id) on delete restrict;

create unique index if not exists uq_running_dispatch_trip_tracker
  on public.dispatch_trips(tenant_id, tracker_link_id)
  where tracker_link_id is not null and status in ('in_transit','in_progress');

create or replace function public.upsert_geofence_v2(_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_id uuid := nullif(_payload->>'id','')::uuid;
  v_tenant uuid := nullif(_payload->>'tenant_id','')::uuid;
  v_name text := nullif(btrim(_payload->>'name'),'');
  v_category text := coalesce(nullif(btrim(_payload->>'category'),''),'general');
  v_shape text := coalesce(nullif(_payload->>'shape_kind',''),'circle');
  v_source text := nullif(_payload->>'source_kind','');
  v_lat double precision := nullif(_payload->>'center_lat','')::double precision;
  v_lng double precision := nullif(_payload->>'center_lng','')::double precision;
  v_radius double precision := coalesce(nullif(_payload->>'radius_m','')::double precision,200);
  v_geometry extensions.geometry;
begin
  if auth.uid() is null or v_tenant is null or not coalesce(public.is_tenant_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  if jsonb_typeof(_payload) is distinct from 'object' or v_name is null or length(v_name)>200
    or v_source not in ('address_geocoded','map_selected','imported') then
    raise exception 'invalid_geofence_payload' using errcode='22023';
  end if;
  if v_source='address_geocoded' and nullif(btrim(_payload->>'source_address'),'') is null then
    raise exception 'geofence_address_required' using errcode='22023';
  end if;
  if v_shape='circle' then
    if v_lat is null or v_lat not between -90 and 90 or v_lng is null or v_lng not between -180 and 180
      or v_radius not between 50 and 50000 then
      raise exception 'invalid_geofence_circle' using errcode='22023';
    end if;
    v_geometry := extensions.st_buffer(
      extensions.st_setsrid(extensions.st_makepoint(v_lng,v_lat),4326)::extensions.geography,
      v_radius
    )::extensions.geometry;
  elsif v_shape='polygon' then
    if jsonb_typeof(_payload->'geometry') is distinct from 'object' then
      raise exception 'invalid_geofence_polygon' using errcode='22023';
    end if;
    v_geometry := extensions.st_setsrid(extensions.st_geomfromgeojson((_payload->'geometry')::text),4326);
    if extensions.st_geometrytype(v_geometry) <> 'ST_Polygon' or not extensions.st_isvalid(v_geometry) then
      raise exception 'invalid_geofence_polygon' using errcode='22023';
    end if;
    v_lat := extensions.st_y(extensions.st_centroid(v_geometry));
    v_lng := extensions.st_x(extensions.st_centroid(v_geometry));
    v_radius := null;
  else
    raise exception 'invalid_geofence_shape' using errcode='22023';
  end if;

  if v_id is null then
    insert into public.geofences(
      tenant_id,name,category,enabled,geometry,shape_kind,source_kind,source_address,
      center_lat,center_lng,radius_m,location_provider,location_accuracy_m,location_confidence,
      enter_margin_m,exit_margin_m,transition_confirmations,location_resolved_at,location_resolved_by,location_audit
    ) values (
      v_tenant,v_name,v_category,coalesce((_payload->>'enabled')::boolean,true),v_geometry,v_shape,v_source,
      nullif(btrim(_payload->>'source_address'),''),v_lat,v_lng,v_radius,nullif(_payload->>'location_provider',''),
      nullif(_payload->>'location_accuracy_m','')::double precision,nullif(_payload->>'location_confidence','')::double precision,
      coalesce(nullif(_payload->>'enter_margin_m','')::double precision,0),
      coalesce(nullif(_payload->>'exit_margin_m','')::double precision,30),
      coalesce(nullif(_payload->>'transition_confirmations','')::integer,2),
      case when v_source='address_geocoded' then clock_timestamp() else null end,auth.uid(),
      coalesce(_payload->'location_audit','{}'::jsonb)
    ) returning id into v_id;
  else
    update public.geofences set
      name=v_name,category=v_category,enabled=coalesce((_payload->>'enabled')::boolean,true),geometry=v_geometry,
      shape_kind=v_shape,source_kind=v_source,source_address=nullif(btrim(_payload->>'source_address'),''),
      center_lat=v_lat,center_lng=v_lng,radius_m=v_radius,location_provider=nullif(_payload->>'location_provider',''),
      location_accuracy_m=nullif(_payload->>'location_accuracy_m','')::double precision,
      location_confidence=nullif(_payload->>'location_confidence','')::double precision,
      enter_margin_m=coalesce(nullif(_payload->>'enter_margin_m','')::double precision,0),
      exit_margin_m=coalesce(nullif(_payload->>'exit_margin_m','')::double precision,30),
      transition_confirmations=coalesce(nullif(_payload->>'transition_confirmations','')::integer,2),
      location_resolved_at=case when v_source='address_geocoded' then clock_timestamp() else null end,
      location_resolved_by=auth.uid(),location_audit=coalesce(_payload->'location_audit','{}'::jsonb)
    where id=v_id and tenant_id=v_tenant;
    if not found then raise exception 'geofence_not_found' using errcode='P0002'; end if;
  end if;
  return v_id;
end;
$function$;

revoke all on function public.upsert_geofence_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.upsert_geofence_v2(jsonb) to authenticated,service_role;

create or replace function public.dispatch_planned_route_v2(_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_trip uuid;
  v_stop jsonb;
  v_order integer := 0;
  v_source text;
begin
  v_trip := public.dispatch_planned_route(_payload);
  for v_stop in select value from jsonb_array_elements(_payload->'stops') loop
    v_order := v_order + 1;
    v_source := coalesce(nullif(v_stop->>'location_source',''),'legacy_coordinates');
    if v_source not in ('address_geocoded','map_selected','imported','legacy_coordinates')
      or (v_source='address_geocoded' and nullif(btrim(v_stop->>'location_address'),'') is null) then
      raise exception 'invalid_dispatch_stop_location_source' using errcode='22023';
    end if;
    update public.dispatch_stops set
      location_source=v_source,location_address=nullif(btrim(v_stop->>'location_address'),''),
      location_provider=nullif(v_stop->>'location_provider',''),
      location_accuracy_m=nullif(v_stop->>'location_accuracy_m','')::double precision,
      location_confidence=nullif(v_stop->>'location_confidence','')::double precision,
      location_resolved_at=case when v_source='address_geocoded' then clock_timestamp() else null end,
      location_resolved_by=auth.uid(),location_audit=coalesce(v_stop->'location_audit','{}'::jsonb),
      geofence_radius_m=coalesce(nullif(v_stop->>'geofence_radius_m','')::double precision,500)
    where tenant_id=(_payload->>'tenant_id')::uuid and dispatch_trip_id=v_trip and stop_order=v_order;
    if not found then raise exception 'dispatch_stop_location_update_failed' using errcode='40001'; end if;
  end loop;
  return v_trip;
end;
$function$;

revoke all on function public.dispatch_planned_route_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dispatch_planned_route_v2(jsonb) to authenticated,service_role;

create or replace function public.replan_load_items_v2(_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_target jsonb := _payload->'target_stop';
  v_source text;
begin
  v_result := public.replan_load_items(_payload);
  if v_target->>'mode'='new' then
    v_source := nullif(v_target->>'location_source','');
    if v_source not in ('address_geocoded','map_selected')
      or (v_source='address_geocoded' and nullif(btrim(v_target->>'location_address'),'') is null) then
      raise exception 'invalid_replanning_location_source' using errcode='22023';
    end if;
    update public.dispatch_stops set location_source=v_source,
      location_address=nullif(btrim(v_target->>'location_address'),''),location_provider=nullif(v_target->>'location_provider',''),
      location_accuracy_m=nullif(v_target->>'location_accuracy_m','')::double precision,
      location_confidence=nullif(v_target->>'location_confidence','')::double precision,
      location_resolved_at=case when v_source='address_geocoded' then clock_timestamp() else null end,
      location_resolved_by=auth.uid(),location_audit=coalesce(v_target->'location_audit','{}'::jsonb),
      geofence_radius_m=coalesce(nullif(v_target->>'geofence_radius_m','')::double precision,500)
    where id=(v_result->>'target_stop_id')::uuid and tenant_id=(_payload->>'tenant_id')::uuid;
    if not found then raise exception 'replanning_location_update_failed' using errcode='40001'; end if;
  end if;
  return v_result;
end;
$function$;

revoke all on function public.replan_load_items_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.replan_load_items_v2(jsonb) to authenticated,service_role;

create or replace function public.change_load_documents_v2(_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_target jsonb := _payload->'target_stop';
  v_source text;
begin
  v_result := public.change_load_documents(_payload);
  if _payload->>'action'='attach' and v_target->>'mode'='new' then
    v_source := nullif(v_target->>'location_source','');
    if v_source not in ('address_geocoded','map_selected')
      or (v_source='address_geocoded' and nullif(btrim(v_target->>'location_address'),'') is null) then
      raise exception 'invalid_document_change_location_source' using errcode='22023';
    end if;
    update public.dispatch_stops set location_source=v_source,
      location_address=nullif(btrim(v_target->>'location_address'),''),location_provider=nullif(v_target->>'location_provider',''),
      location_accuracy_m=nullif(v_target->>'location_accuracy_m','')::double precision,
      location_confidence=nullif(v_target->>'location_confidence','')::double precision,
      location_resolved_at=case when v_source='address_geocoded' then clock_timestamp() else null end,
      location_resolved_by=auth.uid(),location_audit=coalesce(v_target->'location_audit','{}'::jsonb),
      geofence_radius_m=coalesce(nullif(v_target->>'geofence_radius_m','')::double precision,500)
    where id=(v_result->>'target_stop_id')::uuid and tenant_id=(_payload->>'tenant_id')::uuid;
    if not found then raise exception 'document_change_location_update_failed' using errcode='40001'; end if;
  end if;
  return v_result;
end;
$function$;

revoke all on function public.change_load_documents_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.change_load_documents_v2(jsonb) to authenticated,service_role;

create or replace function public.process_geofence_position_batch_v1(
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

  for v_fence in select * from public.geofences where tenant_id=_tenant_id and enabled order by id loop
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

revoke all on function public.process_geofence_position_batch_v1(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.process_geofence_position_batch_v1(uuid,uuid,jsonb) to service_role;

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
  select coalesce(bool_and(case when feature_key='ssx_enabled' then enabled else not enabled end),false)
    into v_ssx_required from public.tenant_feature_policy
    where tenant_id=new.tenant_id and feature_key in ('ssx_enabled','ssx_kill_switch')
    having count(*)=2;
  v_ssx_required:=coalesce(v_ssx_required,false);
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
drop trigger if exists bind_dispatch_trip_tracker on public.dispatch_trips;
create trigger bind_dispatch_trip_tracker before insert or update of status,actual_start_at,vehicle_id,tracker_link_id
  on public.dispatch_trips for each row execute function private.bind_dispatch_trip_tracker();

create or replace function private.protect_running_trip_tracker_link()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.active and (not new.active or new.vehicle_id is distinct from old.vehicle_id
      or new.provider_unit_id is distinct from old.provider_unit_id or new.end_at is distinct from old.end_at)
    and exists(select 1 from public.dispatch_trips where tenant_id=old.tenant_id and tracker_link_id=old.id
      and status in ('in_transit','in_progress')) then
    raise exception 'tracker_link_in_use_by_running_trip' using errcode='23514';
  end if;
  return new;
end;
$function$;

revoke all on function private.protect_running_trip_tracker_link() from public,anon,authenticated,service_role;
drop trigger if exists protect_running_trip_tracker_link on public.vehicle_tracker_links;
create trigger protect_running_trip_tracker_link before update of active,vehicle_id,provider_unit_id,end_at
  on public.vehicle_tracker_links for each row execute function private.protect_running_trip_tracker_link();

do $postcondition$
begin
  if pg_catalog.to_regprocedure('public.upsert_geofence_v2(jsonb)') is null
    or pg_catalog.to_regprocedure('public.dispatch_planned_route_v2(jsonb)') is null
    or pg_catalog.to_regprocedure('public.replan_load_items_v2(jsonb)') is null
    or pg_catalog.to_regprocedure('public.change_load_documents_v2(jsonb)') is null
    or pg_catalog.to_regprocedure('public.process_geofence_position_batch_v1(uuid,uuid,jsonb)') is null
    or pg_catalog.has_function_privilege('anon','public.process_geofence_position_batch_v1(uuid,uuid,jsonb)','execute')
    or pg_catalog.has_function_privilege('authenticated','public.process_geofence_position_batch_v1(uuid,uuid,jsonb)','execute') then
    raise exception 'driver_geocoding_geofence_tracking_postcondition_failed';
  end if;
end;
$postcondition$;
