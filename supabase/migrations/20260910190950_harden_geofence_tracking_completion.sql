set local lock_timeout='3s';
set local statement_timeout='60s';

do $preflight$
begin
  if to_regprocedure('public.dispatch_planned_route_v3(jsonb)') is null
    or to_regprocedure('public.process_geofence_position_batch_v2(uuid,uuid,jsonb)') is null
    or to_regclass('public.geofences') is null
    or to_regclass('public.geofence_states') is null then
    raise exception 'geofence_tracking_completion_prerequisites_missing';
  end if;
end;
$preflight$;

alter table public.dispatch_stops add column if not exists geofence_radius_is_override boolean not null default false;
comment on column public.dispatch_stops.geofence_radius_is_override is
  'Explicit dispatch override marker. The historical 500 m application default does not shadow tenant policy.';
update public.dispatch_stops set geofence_radius_is_override=true
where not geofence_radius_is_override and geofence_radius_m is distinct from 500::double precision;

-- BEGIN_TESTABLE_RADIUS_HELPER
create or replace function private.effective_delivery_geofence_radius(boolean,double precision,double precision)
returns double precision language sql immutable security invoker set search_path=''
as $f$ select coalesce(case when $1 then $2 end,$3,500::double precision) $f$;
revoke all on function private.effective_delivery_geofence_radius(boolean,double precision,double precision)
  from public,anon,authenticated,service_role;
-- END_TESTABLE_RADIUS_HELPER

create or replace function private.sync_delivery_geofence_from_stop()
returns trigger language plpgsql security definer set search_path=''
as $f$
declare
  v_trip_status text; v_policy public.geofence_radius_policies%rowtype;
  v_radius double precision; v_geometry extensions.geometry; v_eligible boolean;
begin
  select status into v_trip_status from public.dispatch_trips
  where tenant_id=new.tenant_id and id=new.dispatch_trip_id;
  if not found then raise exception 'delivery_geofence_trip_not_found' using errcode='23503'; end if;
  v_eligible:=new.latitude is not null and new.latitude between -90 and 90
    and new.longitude is not null and new.longitude between -180 and 180
    and (new.location_source in ('address_geocoded','map_selected')
      or length(btrim(coalesce(new.location_exception_reason,'')))>=20);
  if not v_eligible then
    delete from public.geofences where tenant_id=new.tenant_id and dispatch_stop_id=new.id and scope_kind='delivery';
    return new;
  end if;
  select * into v_policy from public.geofence_radius_policies
  where tenant_id=new.tenant_id and scope_kind='delivery' and category='delivery';
  v_radius:=private.effective_delivery_geofence_radius(
    new.geofence_radius_is_override,new.geofence_radius_m,v_policy.radius_m);
  v_geometry:=extensions.st_buffer(
    extensions.st_setsrid(extensions.st_makepoint(new.longitude,new.latitude),4326)::extensions.geography,v_radius
  )::extensions.geometry;
  insert into public.geofences(
    tenant_id,name,category,enabled,geometry,shape_kind,source_kind,source_address,
    center_lat,center_lng,radius_m,location_provider,location_accuracy_m,location_confidence,
    enter_margin_m,exit_margin_m,transition_confirmations,location_resolved_at,location_resolved_by,
    location_audit,scope_kind,dispatch_stop_id,radius_policy_key
  ) values (
    new.tenant_id,'Entrega '||new.stop_order||' · '||left(coalesce(new.destination,'Destino'),120),
    'delivery',v_trip_status in ('in_transit','in_progress') and not(new.status=any(public.stop_terminal_statuses())),
    v_geometry,'circle',new.location_source,new.location_address,new.latitude,new.longitude,v_radius,
    new.location_provider,new.location_accuracy_m,new.location_confidence,coalesce(v_policy.enter_margin_m,0),
    coalesce(v_policy.exit_margin_m,30),coalesce(v_policy.transition_confirmations,2),new.location_resolved_at,
    new.location_resolved_by,coalesce(new.location_audit,'{}'::jsonb),'delivery',new.id,'delivery:delivery'
  ) on conflict(tenant_id,dispatch_stop_id) where dispatch_stop_id is not null do update set
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
$f$;
revoke all on function private.sync_delivery_geofence_from_stop() from public,anon,authenticated,service_role;
drop trigger if exists sync_delivery_geofence_from_stop on public.dispatch_stops;
create trigger sync_delivery_geofence_from_stop after insert or update of dispatch_trip_id,stop_order,destination,
  status,latitude,longitude,location_source,location_address,location_provider,location_accuracy_m,
  location_confidence,location_resolved_at,location_resolved_by,location_audit,geofence_radius_m,
  geofence_radius_is_override,location_exception_reason on public.dispatch_stops
  for each row execute function private.sync_delivery_geofence_from_stop();

create or replace function public.dispatch_planned_route_v3(_payload jsonb)
returns uuid language plpgsql security invoker set search_path=''
as $f$
declare
  v_stop jsonb; v_order integer:=0; v_source text; v_reason text; v_trip uuid;
  v_tenant uuid:=nullif(_payload->>'tenant_id','')::uuid; v_stop_id uuid;
  v_override boolean; v_radius double precision;
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
    if v_stop?'geofence_radius_override' and jsonb_typeof(v_stop->'geofence_radius_override') is distinct from 'boolean' then
      raise exception 'dispatch_geofence_radius_override_invalid' using errcode='22023';
    end if;
    v_override:=coalesce((v_stop->>'geofence_radius_override')::boolean,false);
    v_radius:=nullif(v_stop->>'geofence_radius_m','')::double precision;
    if v_override and (v_radius is null or v_radius not between 50 and 5000) then
      raise exception 'dispatch_geofence_radius_override_invalid' using errcode='22023';
    end if;
  end loop;
  v_trip:=public.dispatch_planned_route_v2(_payload);
  for v_stop in select value from jsonb_array_elements(_payload->'stops') loop
    v_order:=v_order+1; v_reason:=nullif(btrim(v_stop->>'location_exception_reason'),'');
    v_override:=coalesce((v_stop->>'geofence_radius_override')::boolean,false);
    v_radius:=nullif(v_stop->>'geofence_radius_m','')::double precision;
    select id into v_stop_id from public.dispatch_stops
    where tenant_id=v_tenant and dispatch_trip_id=v_trip and stop_order=v_order for update;
    if not found then raise exception 'dispatch_stop_not_found' using errcode='40001'; end if;
    update public.dispatch_stops set geofence_radius_is_override=v_override,
      geofence_radius_m=case when v_override then v_radius else geofence_radius_m end,
      location_exception_reason=coalesce(v_reason,location_exception_reason),
      location_exception_at=case when v_reason is not null then clock_timestamp() else location_exception_at end,
      location_exception_by=case when v_reason is not null then auth.uid() else location_exception_by end
    where tenant_id=v_tenant and id=v_stop_id;
  end loop;
  return v_trip;
end;
$f$;
revoke all on function public.dispatch_planned_route_v3(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dispatch_planned_route_v3(jsonb) to authenticated;

update public.dispatch_stops s set geofence_radius_is_override=s.geofence_radius_is_override
where (s.latitude is not null and s.longitude is not null and
  (s.location_source in ('address_geocoded','map_selected') or length(btrim(coalesce(s.location_exception_reason,'')))>=20))
  or exists(select 1 from public.geofences g where g.tenant_id=s.tenant_id
    and g.dispatch_stop_id=s.id and g.scope_kind='delivery');

alter table public.geofence_states add column if not exists last_point_key text;
update public.geofence_states set last_point_key='~legacy~' where last_point_at is not null and last_point_key is null;

-- BEGIN_TESTABLE_CURSOR_HELPER
create or replace function private.geofence_position_cursor_key(timestamptz,double precision,double precision,double precision,text)
returns text language sql stable security invoker set search_path=''
as $f$ select case when nullif(btrim($5),'') is not null then 'p:'||btrim($5)
  else 'f:'||pg_catalog.md5(pg_catalog.concat_ws('|',extract(epoch from $1)::text,$2::text,$3::text,coalesce($4::text,''))) end $f$;
revoke all on function private.geofence_position_cursor_key(timestamptz,double precision,double precision,double precision,text)
  from public,anon,authenticated,service_role;
-- END_TESTABLE_CURSOR_HELPER

create or replace function public.process_geofence_position_batch_v2(_tenant_id uuid,_vehicle_id uuid,_points jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $f$
declare
  v_fence record; v_state public.geofence_states%rowtype; v_point record; v_geom extensions.geometry;
  v_inside boolean; v_candidate boolean; v_pending_count integer; v_transition_count integer:=0;
  v_processed integer:=0; v_transitions jsonb:='[]'::jsonb; v_direction text;
begin
  if current_user not in ('service_role','postgres') then raise exception 'not_authorized' using errcode='42501'; end if;
  if _tenant_id is null or _vehicle_id is null or jsonb_typeof(_points) is distinct from 'array'
    or jsonb_array_length(_points)>5000 or octet_length(_points::text)>8388608 then
    raise exception 'invalid_geofence_position_batch' using errcode='22023';
  end if;
  if not exists(select 1 from public.vehicles where id=_vehicle_id and tenant_id=_tenant_id) then
    raise exception 'geofence_vehicle_tenant_mismatch' using errcode='23514'; end if;
  if exists(select 1 from jsonb_to_recordset(_points) p(captured_at timestamptz,lat double precision,lng double precision,
    accuracy_m double precision,provider_payload_hash text) where captured_at is null or not isfinite(captured_at)
    or lat is null or lat not between -90 and 90 or lng is null or lng not between -180 and 180
    or (accuracy_m is not null and accuracy_m not between 0 and 1000) or length(coalesce(provider_payload_hash,''))>256)
  then raise exception 'invalid_geofence_position' using errcode='22023'; end if;

  for v_fence in select g.* from public.geofences g where g.tenant_id=_tenant_id and g.enabled
    and (g.scope_kind='fleet' or (g.scope_kind='delivery' and exists(select 1 from public.dispatch_stops s
      join public.dispatch_trips t on t.tenant_id=s.tenant_id and t.id=s.dispatch_trip_id
      where s.tenant_id=_tenant_id and s.id=g.dispatch_stop_id and t.vehicle_id=_vehicle_id
        and t.status in ('in_transit','in_progress') and not(s.status=any(public.stop_terminal_statuses()))))) order by g.id
  loop
    insert into public.geofence_states(tenant_id,vehicle_id,geofence_id,is_inside,last_checked_at,pending_count)
      values(_tenant_id,_vehicle_id,v_fence.id,false,clock_timestamp(),0) on conflict(tenant_id,vehicle_id,geofence_id) do nothing;
    select * into v_state from public.geofence_states where tenant_id=_tenant_id and vehicle_id=_vehicle_id
      and geofence_id=v_fence.id for update;
    for v_point in
       with parsed as (select captured_at,lat,lng,accuracy_m,provider_payload_hash,
         case when nullif(btrim(provider_payload_hash),'') is not null
           then 'p:'||btrim(provider_payload_hash)
           else 'f:'||pg_catalog.md5(pg_catalog.concat_ws('|',extract(epoch from captured_at)::text,
             lat::text,lng::text,coalesce(accuracy_m::text,''))) end point_key
        from jsonb_to_recordset(_points) p(captured_at timestamptz,lat double precision,lng double precision,
          accuracy_m double precision,provider_payload_hash text)),
      deduplicated as (select distinct on(captured_at,point_key) * from parsed order by captured_at,point_key)
      select * from deduplicated where v_state.last_point_at is null or captured_at>v_state.last_point_at
        or (captured_at=v_state.last_point_at and point_key>coalesce(v_state.last_point_key,'')) order by captured_at,point_key
    loop
      v_geom:=extensions.st_setsrid(extensions.st_makepoint(v_point.lng,v_point.lat),4326);
      if v_state.is_inside then v_inside:=extensions.st_covers(v_fence.geometry,v_geom)
        or extensions.st_dwithin(v_fence.geometry::extensions.geography,v_geom::extensions.geography,v_fence.exit_margin_m);
      elsif v_fence.enter_margin_m>0 then v_inside:=extensions.st_covers(v_fence.geometry,v_geom)
        and extensions.st_distance(extensions.st_boundary(v_fence.geometry)::extensions.geography,
          v_geom::extensions.geography)>=v_fence.enter_margin_m;
      else v_inside:=extensions.st_covers(v_fence.geometry,v_geom); end if;
      if v_inside=v_state.is_inside then v_candidate:=null;v_pending_count:=0;
      else v_candidate:=v_inside; v_pending_count:=case when v_state.pending_inside is not distinct from v_inside
        then v_state.pending_count+1 else 1 end; end if;
      if v_candidate is not null and v_pending_count>=v_fence.transition_confirmations then
        v_direction:=case when v_candidate then 'enter' else 'exit' end;
        insert into public.geofence_events(tenant_id,vehicle_id,geofence_id,direction,event_at,payload)
          values(_tenant_id,_vehicle_id,v_fence.id,v_direction,v_point.captured_at,jsonb_build_object(
            'geofence_name',v_fence.name,'lat',v_point.lat,'lng',v_point.lng,'provider_payload_hash',v_point.provider_payload_hash,
            'confirmed_points',v_pending_count,'exit_margin_m',v_fence.exit_margin_m));
        insert into public.events(tenant_id,vehicle_id,event_type,severity,source,event_at,payload)
          values(_tenant_id,_vehicle_id,'geofence_'||v_direction,'info','engine',v_point.captured_at,
            jsonb_build_object('geofence_id',v_fence.id,'geofence_name',v_fence.name,'direction',v_direction));
        insert into public.alert_instances(tenant_id,vehicle_id,rule_id,status,source,opened_at)
          select _tenant_id,_vehicle_id,r.id,'open','engine',v_point.captured_at from public.alert_rules r
          where r.tenant_id=_tenant_id and r.enabled and r.rule_type='geofence' and r.params->>'geofence_id'=v_fence.id::text
            and (nullif(r.params->>'direction','') is null or r.params->>'direction'=v_direction)
            and not exists(select 1 from public.alert_instances a where a.tenant_id=_tenant_id and a.vehicle_id=_vehicle_id
              and a.rule_id=r.id and a.source='engine' and a.status in ('open','ack'));
        v_transition_count:=v_transition_count+1; v_transitions:=v_transitions||jsonb_build_array(jsonb_build_object(
          'geofence_id',v_fence.id,'direction',v_direction,'event_at',v_point.captured_at));
        v_state.is_inside:=v_candidate;v_state.last_changed_at:=v_point.captured_at;v_candidate:=null;v_pending_count:=0;
      end if;
      v_state.pending_inside:=v_candidate;v_state.pending_count:=v_pending_count;
      v_state.last_point_at:=v_point.captured_at;v_state.last_point_key:=v_point.point_key;
      v_state.last_lat:=v_point.lat;v_state.last_lng:=v_point.lng;v_processed:=v_processed+1;
    end loop;
    update public.geofence_states set is_inside=v_state.is_inside,last_changed_at=v_state.last_changed_at,
      last_checked_at=clock_timestamp(),pending_inside=v_state.pending_inside,pending_count=v_state.pending_count,
      last_point_at=v_state.last_point_at,last_point_key=v_state.last_point_key,last_lat=v_state.last_lat,last_lng=v_state.last_lng
    where tenant_id=_tenant_id and vehicle_id=_vehicle_id and geofence_id=v_fence.id;
  end loop;
  return jsonb_build_object('processed_points',v_processed,'transition_count',v_transition_count,'transitions',v_transitions);
end;
$f$;
revoke all on function public.process_geofence_position_batch_v2(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.process_geofence_position_batch_v2(uuid,uuid,jsonb) to service_role;

-- BEGIN_TESTABLE_SCHEDULER_GUARD
do $disable_legacy_scheduler$
begin
  if to_regclass('public.workspace_ssx_accounts') is not null
    and to_regprocedure('public.claim_workspace_ssx_dispatch_v1(integer,integer)') is not null
    and to_regclass('cron.job') is not null and to_regprocedure('cron.unschedule(bigint)') is not null then
    perform cron.unschedule(job.jobid) from cron.job job
    where job.jobname='agvlog-schedule-tenants-every-minute';
  end if;
end;
$disable_legacy_scheduler$;
-- END_TESTABLE_SCHEDULER_GUARD

-- BEGIN_TESTABLE_NEXT_STOP_RECOVERY
create or replace function private.auto_arrive_next_stop_from_active_geofence_v1()
returns trigger language plpgsql security definer set search_path=''
as $f$
declare
  v_trip public.dispatch_trips%rowtype; v_next public.dispatch_stops%rowtype;
  v_geofence_id uuid; v_inside_since timestamptz; v_now timestamptz:=clock_timestamp(); v_updated integer;
begin
  if new.status is not distinct from old.status or not(new.status=any(public.stop_terminal_statuses()))
    or old.status=any(public.stop_terminal_statuses()) then return new; end if;
  select * into v_trip from public.dispatch_trips where id=new.dispatch_trip_id and tenant_id=new.tenant_id
    and vehicle_id is not null and status in ('in_transit','in_progress') and actual_start_at is not null;
  if not found then return new; end if;
  select * into v_next from public.dispatch_stops where tenant_id=new.tenant_id and dispatch_trip_id=new.dispatch_trip_id
    and status in ('pending','planned','arriving') and actual_arrival_at is null
    order by stop_order,id limit 1 for update;
  if not found then return new; end if;
  select g.id,s.last_changed_at into v_geofence_id,v_inside_since from public.geofences g
  join public.geofence_states s on s.tenant_id=g.tenant_id and s.geofence_id=g.id
    and s.vehicle_id=v_trip.vehicle_id and s.is_inside
  where g.tenant_id=new.tenant_id and g.dispatch_stop_id=v_next.id and g.scope_kind='delivery' and g.enabled
  order by s.last_changed_at desc nulls last,g.id limit 1;
  if not found then return new; end if;
  update public.dispatch_stops set status='arrived',actual_arrival_at=v_now,updated_at=v_now
  where id=v_next.id and tenant_id=new.tenant_id and status in ('pending','planned','arriving') and actual_arrival_at is null;
  get diagnostics v_updated=row_count; if v_updated<>1 then return new; end if;
  insert into public.dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,event_at,payload,created_by)
  values(new.tenant_id,new.dispatch_trip_id,v_next.id,'arrival',v_now,jsonb_build_object(
    'source','tracking_ssx','automatic',true,'geofence_verified',true,'recovered_from_active_state',true,
    'geofence_id',v_geofence_id,'vehicle_id',v_trip.vehicle_id,'inside_since',v_inside_since,'released_by_stop_id',new.id),null);
  return new;
end;
$f$;
revoke all on function private.auto_arrive_next_stop_from_active_geofence_v1() from public,anon,authenticated,service_role;
drop trigger if exists auto_arrive_next_stop_from_active_geofence_v1 on public.dispatch_stops;
create trigger auto_arrive_next_stop_from_active_geofence_v1 after update of status on public.dispatch_stops
  for each row execute function private.auto_arrive_next_stop_from_active_geofence_v1();
-- END_TESTABLE_NEXT_STOP_RECOVERY

do $postcondition$
begin
  if to_regprocedure('private.effective_delivery_geofence_radius(boolean,double precision,double precision)') is null
    or to_regprocedure('private.geofence_position_cursor_key(timestamp with time zone,double precision,double precision,double precision,text)') is null
    or to_regprocedure('private.auto_arrive_next_stop_from_active_geofence_v1()') is null then
    raise exception 'geofence_tracking_completion_postcondition_failed';
  end if;
end;
$postcondition$;
