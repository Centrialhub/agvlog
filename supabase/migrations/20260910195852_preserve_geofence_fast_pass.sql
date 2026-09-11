do $guard$
begin
  if to_regclass('public.positions_raw') is null
    or to_regclass('public.geofence_states') is null
    or to_regprocedure('public.process_geofence_position_batch_v2(uuid,uuid,jsonb)') is null
    or to_regprocedure('private.geofence_position_cursor_key(timestamptz,double precision,double precision,double precision,text)') is null then
    raise exception 'geofence_tracking_foundation_missing';
  end if;
end;
$guard$;

alter table public.geofence_states
  add column if not exists pending_bracketed_from_outside boolean not null default false;

comment on column public.geofence_states.pending_bracketed_from_outside is
  'True only when a pending one-point entry was preceded by a point beyond the exit margin; used for deterministic fast-pass detection.';

-- BEGIN_TESTABLE_POSITION_PAGE
-- The worker and the geofence engine must traverse the exact same total order.
-- Returning one JSON object per row preserves every raw signal used by the other
-- engine stages while the explicit cursor remains (captured_at, point_key).
create or replace function public.read_vehicle_position_processing_page_v1(
  _tenant_id uuid,
  _vehicle_id uuid,
  _window_from timestamptz,
  _window_to timestamptz,
  _after_captured_at timestamptz default null,
  _after_point_key text default null,
  _page_size integer default 5000
)
returns table(position_payload jsonb, position_captured_at timestamptz, position_point_key text)
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if current_user not in ('service_role','postgres') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if _tenant_id is null or _vehicle_id is null or _window_from is null or _window_to is null
    or _window_from >= _window_to or _page_size not between 1 and 5000
    or ((_after_captured_at is null) <> (_after_point_key is null)) then
    raise exception 'invalid_position_processing_page' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.vehicles v where v.id = _vehicle_id and v.tenant_id = _tenant_id
  ) then
    raise exception 'geofence_vehicle_tenant_mismatch' using errcode = '23514';
  end if;

  return query
  with keyed as (
    select p.*,
      private.geofence_position_cursor_key(
        p.captured_at,
        p.lat,
        p.lng,
        null::double precision,
        p.provider_payload_hash
      ) as processing_point_key
    from public.positions_raw p
    where p.tenant_id = _tenant_id
      and p.vehicle_id = _vehicle_id
      and p.captured_at >= _window_from
      and p.captured_at <= _window_to
  ), deduplicated as (
    select distinct on (k.captured_at, k.processing_point_key) k.*
    from keyed k
    order by k.captured_at, k.processing_point_key, k.id
  )
  select to_jsonb(d) - 'processing_point_key', d.captured_at, d.processing_point_key
  from deduplicated d
  where _after_captured_at is null
     or (d.captured_at, d.processing_point_key) > (_after_captured_at, _after_point_key)
  order by d.captured_at, d.processing_point_key
  limit _page_size;
end;
$function$;

revoke all on function public.read_vehicle_position_processing_page_v1(
  uuid,uuid,timestamptz,timestamptz,timestamptz,text,integer
) from public,anon,authenticated,service_role;
grant execute on function public.read_vehicle_position_processing_page_v1(
  uuid,uuid,timestamptz,timestamptz,timestamptz,text,integer
) to service_role;
-- END_TESTABLE_POSITION_PAGE

-- BEGIN_TESTABLE_FAST_PASS
create or replace function public.process_geofence_position_batch_v2(
  _tenant_id uuid,
  _vehicle_id uuid,
  _points jsonb
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
  v_previous_geom extensions.geometry;
  v_inside boolean;
  v_candidate boolean;
  v_pending_count integer;
  v_transition_count integer := 0;
  v_processed integer := 0;
  v_transitions jsonb := '[]'::jsonb;
  v_direction text;
  v_fast_pass boolean;
begin
  if current_user not in ('service_role','postgres') then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if _tenant_id is null or _vehicle_id is null or jsonb_typeof(_points) is distinct from 'array'
    or jsonb_array_length(_points) > 5000 or octet_length(_points::text) > 8388608 then
    raise exception 'invalid_geofence_position_batch' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.vehicles where id = _vehicle_id and tenant_id = _tenant_id
  ) then
    raise exception 'geofence_vehicle_tenant_mismatch' using errcode = '23514';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(_points) p(
      captured_at timestamptz,
      lat double precision,
      lng double precision,
      accuracy_m double precision,
      provider_payload_hash text
    )
    where captured_at is null or not isfinite(captured_at)
      or lat is null or lat not between -90 and 90
      or lng is null or lng not between -180 and 180
      or (accuracy_m is not null and accuracy_m not between 0 and 1000)
      or length(coalesce(provider_payload_hash,'')) > 256
  ) then
    raise exception 'invalid_geofence_position' using errcode = '22023';
  end if;

  for v_fence in
    select g.*
    from public.geofences g
    where g.tenant_id = _tenant_id
      and g.enabled
      and (
        g.scope_kind = 'fleet'
        or (
          g.scope_kind = 'delivery'
          and exists (
            select 1
            from public.dispatch_stops s
            join public.dispatch_trips t
              on t.tenant_id = s.tenant_id and t.id = s.dispatch_trip_id
            where s.tenant_id = _tenant_id
              and s.id = g.dispatch_stop_id
              and t.vehicle_id = _vehicle_id
              and t.status in ('in_transit','in_progress')
              and not (s.status = any(public.stop_terminal_statuses()))
          )
        )
      )
    order by g.id
  loop
    insert into public.geofence_states(
      tenant_id,vehicle_id,geofence_id,is_inside,last_checked_at,pending_count
    ) values (
      _tenant_id,_vehicle_id,v_fence.id,false,clock_timestamp(),0
    ) on conflict(tenant_id,vehicle_id,geofence_id) do nothing;

    select * into v_state
    from public.geofence_states
    where tenant_id = _tenant_id and vehicle_id = _vehicle_id and geofence_id = v_fence.id
    for update;

    for v_point in
      with parsed as (
        select captured_at,lat,lng,accuracy_m,provider_payload_hash,
          private.geofence_position_cursor_key(
            captured_at,lat,lng,accuracy_m,provider_payload_hash
          ) as point_key
        from jsonb_to_recordset(_points) p(
          captured_at timestamptz,
          lat double precision,
          lng double precision,
          accuracy_m double precision,
          provider_payload_hash text
        )
      ), deduplicated as (
        select distinct on(captured_at,point_key) *
        from parsed
        order by captured_at,point_key
      )
      select *
      from deduplicated
      where v_state.last_point_at is null
        or captured_at > v_state.last_point_at
        or (
          captured_at = v_state.last_point_at
          and point_key > coalesce(v_state.last_point_key,'')
        )
      order by captured_at,point_key
    loop
      v_geom := extensions.st_setsrid(extensions.st_makepoint(v_point.lng,v_point.lat),4326);

      if v_state.is_inside then
        v_inside := extensions.st_covers(v_fence.geometry,v_geom)
          or extensions.st_dwithin(
            v_fence.geometry::extensions.geography,
            v_geom::extensions.geography,
            v_fence.exit_margin_m
          );
      elsif v_fence.enter_margin_m > 0 then
        v_inside := extensions.st_covers(v_fence.geometry,v_geom)
          and extensions.st_distance(
            extensions.st_boundary(v_fence.geometry)::extensions.geography,
            v_geom::extensions.geography
          ) >= v_fence.enter_margin_m;
      else
        v_inside := extensions.st_covers(v_fence.geometry,v_geom);
      end if;

      -- A fast pass is accepted only when a single deep-inside point is
      -- bracketed by two unequivocally outside points. Merely touching the
      -- enter/exit margins never satisfies this branch, preventing edge flap.
      v_fast_pass := not v_state.is_inside
        and v_state.pending_inside is true
        and v_state.pending_count = 1
        and v_state.pending_bracketed_from_outside
        and not extensions.st_dwithin(
          v_fence.geometry::extensions.geography,
          v_geom::extensions.geography,
          v_fence.exit_margin_m
        );

      if v_fast_pass then
        insert into public.geofence_events(
          tenant_id,vehicle_id,geofence_id,direction,event_at,payload
        ) values (
          _tenant_id,_vehicle_id,v_fence.id,'enter',v_state.last_point_at,
          jsonb_build_object(
            'geofence_name',v_fence.name,
            'lat',v_state.last_lat,
            'lng',v_state.last_lng,
            'point_key',v_state.last_point_key,
            'confirmed_points',1,
            'transition_reason','fast_pass_bracketed',
            'algorithm_version','fast_pass_v1',
            'enter_margin_m',v_fence.enter_margin_m,
            'exit_margin_m',v_fence.exit_margin_m
          )
        );
        insert into public.events(
          tenant_id,vehicle_id,event_type,severity,source,event_at,payload
        ) values (
          _tenant_id,_vehicle_id,'geofence_enter','info','engine',v_state.last_point_at,
          jsonb_build_object(
            'geofence_id',v_fence.id,
            'geofence_name',v_fence.name,
            'direction','enter',
            'transition_reason','fast_pass_bracketed',
            'algorithm_version','fast_pass_v1'
          )
        );
        insert into public.alert_instances(tenant_id,vehicle_id,rule_id,status,source,opened_at)
          select _tenant_id,_vehicle_id,r.id,'open','engine',v_state.last_point_at
          from public.alert_rules r
          where r.tenant_id = _tenant_id and r.enabled and r.rule_type = 'geofence'
            and r.params->>'geofence_id' = v_fence.id::text
            and (nullif(r.params->>'direction','') is null or r.params->>'direction' = 'enter')
            and not exists (
              select 1 from public.alert_instances a
              where a.tenant_id = _tenant_id and a.vehicle_id = _vehicle_id
                and a.rule_id = r.id and a.source = 'engine' and a.status in ('open','ack')
            );

        insert into public.geofence_events(
          tenant_id,vehicle_id,geofence_id,direction,event_at,payload
        ) values (
          _tenant_id,_vehicle_id,v_fence.id,'exit',v_point.captured_at,
          jsonb_build_object(
            'geofence_name',v_fence.name,
            'lat',v_point.lat,
            'lng',v_point.lng,
            'provider_payload_hash',v_point.provider_payload_hash,
            'point_key',v_point.point_key,
            'confirmed_points',1,
            'transition_reason','fast_pass_bracketed',
            'algorithm_version','fast_pass_v1',
            'enter_margin_m',v_fence.enter_margin_m,
            'exit_margin_m',v_fence.exit_margin_m
          )
        );
        insert into public.events(
          tenant_id,vehicle_id,event_type,severity,source,event_at,payload
        ) values (
          _tenant_id,_vehicle_id,'geofence_exit','info','engine',v_point.captured_at,
          jsonb_build_object(
            'geofence_id',v_fence.id,
            'geofence_name',v_fence.name,
            'direction','exit',
            'transition_reason','fast_pass_bracketed',
            'algorithm_version','fast_pass_v1'
          )
        );
        insert into public.alert_instances(tenant_id,vehicle_id,rule_id,status,source,opened_at)
          select _tenant_id,_vehicle_id,r.id,'open','engine',v_point.captured_at
          from public.alert_rules r
          where r.tenant_id = _tenant_id and r.enabled and r.rule_type = 'geofence'
            and r.params->>'geofence_id' = v_fence.id::text
            and (nullif(r.params->>'direction','') is null or r.params->>'direction' = 'exit')
            and not exists (
              select 1 from public.alert_instances a
              where a.tenant_id = _tenant_id and a.vehicle_id = _vehicle_id
                and a.rule_id = r.id and a.source = 'engine' and a.status in ('open','ack')
            );

        v_transition_count := v_transition_count + 2;
        v_transitions := v_transitions || jsonb_build_array(
          jsonb_build_object(
            'geofence_id',v_fence.id,'direction','enter','event_at',v_state.last_point_at,
            'transition_reason','fast_pass_bracketed'
          ),
          jsonb_build_object(
            'geofence_id',v_fence.id,'direction','exit','event_at',v_point.captured_at,
            'transition_reason','fast_pass_bracketed'
          )
        );
        v_state.is_inside := false;
        v_state.last_changed_at := v_point.captured_at;
        v_candidate := null;
        v_pending_count := 0;
        v_state.pending_bracketed_from_outside := false;
      else
        if v_inside = v_state.is_inside then
          v_candidate := null;
          v_pending_count := 0;
          v_state.pending_bracketed_from_outside := false;
        else
          v_candidate := v_inside;
          v_pending_count := case
            when v_state.pending_inside is not distinct from v_inside then v_state.pending_count + 1
            else 1
          end;

          if v_pending_count = 1 then
            v_state.pending_bracketed_from_outside := false;
            if v_inside and not v_state.is_inside
              and v_state.last_point_at is not null
              and v_state.last_lat is not null
              and v_state.last_lng is not null then
              v_previous_geom := extensions.st_setsrid(
                extensions.st_makepoint(v_state.last_lng,v_state.last_lat),4326
              );
              v_state.pending_bracketed_from_outside := not extensions.st_dwithin(
                v_fence.geometry::extensions.geography,
                v_previous_geom::extensions.geography,
                v_fence.exit_margin_m
              );
            end if;
          end if;
        end if;

        if v_candidate is not null and v_pending_count >= v_fence.transition_confirmations then
          v_direction := case when v_candidate then 'enter' else 'exit' end;
          insert into public.geofence_events(
            tenant_id,vehicle_id,geofence_id,direction,event_at,payload
          ) values (
            _tenant_id,_vehicle_id,v_fence.id,v_direction,v_point.captured_at,
            jsonb_build_object(
              'geofence_name',v_fence.name,
              'lat',v_point.lat,
              'lng',v_point.lng,
              'provider_payload_hash',v_point.provider_payload_hash,
              'confirmed_points',v_pending_count,
              'transition_reason','confirmed_samples',
              'algorithm_version','fast_pass_v1',
              'exit_margin_m',v_fence.exit_margin_m
            )
          );
          insert into public.events(
            tenant_id,vehicle_id,event_type,severity,source,event_at,payload
          ) values (
            _tenant_id,_vehicle_id,'geofence_' || v_direction,'info','engine',v_point.captured_at,
            jsonb_build_object(
              'geofence_id',v_fence.id,
              'geofence_name',v_fence.name,
              'direction',v_direction,
              'transition_reason','confirmed_samples',
              'algorithm_version','fast_pass_v1'
            )
          );
          insert into public.alert_instances(tenant_id,vehicle_id,rule_id,status,source,opened_at)
            select _tenant_id,_vehicle_id,r.id,'open','engine',v_point.captured_at
            from public.alert_rules r
            where r.tenant_id = _tenant_id and r.enabled and r.rule_type = 'geofence'
              and r.params->>'geofence_id' = v_fence.id::text
              and (nullif(r.params->>'direction','') is null or r.params->>'direction' = v_direction)
              and not exists (
                select 1 from public.alert_instances a
                where a.tenant_id = _tenant_id and a.vehicle_id = _vehicle_id
                  and a.rule_id = r.id and a.source = 'engine' and a.status in ('open','ack')
              );
          v_transition_count := v_transition_count + 1;
          v_transitions := v_transitions || jsonb_build_array(jsonb_build_object(
            'geofence_id',v_fence.id,
            'direction',v_direction,
            'event_at',v_point.captured_at,
            'transition_reason','confirmed_samples'
          ));
          v_state.is_inside := v_candidate;
          v_state.last_changed_at := v_point.captured_at;
          v_candidate := null;
          v_pending_count := 0;
          v_state.pending_bracketed_from_outside := false;
        end if;
      end if;

      v_state.pending_inside := v_candidate;
      v_state.pending_count := v_pending_count;
      v_state.last_point_at := v_point.captured_at;
      v_state.last_point_key := v_point.point_key;
      v_state.last_lat := v_point.lat;
      v_state.last_lng := v_point.lng;
      v_processed := v_processed + 1;
    end loop;

    update public.geofence_states
    set is_inside = v_state.is_inside,
      last_changed_at = v_state.last_changed_at,
      last_checked_at = clock_timestamp(),
      pending_inside = v_state.pending_inside,
      pending_count = v_state.pending_count,
      pending_bracketed_from_outside = v_state.pending_bracketed_from_outside,
      last_point_at = v_state.last_point_at,
      last_point_key = v_state.last_point_key,
      last_lat = v_state.last_lat,
      last_lng = v_state.last_lng
    where tenant_id = _tenant_id and vehicle_id = _vehicle_id and geofence_id = v_fence.id;
  end loop;

  return jsonb_build_object(
    'processed_points',v_processed,
    'transition_count',v_transition_count,
    'transitions',v_transitions
  );
end;
$function$;

revoke all on function public.process_geofence_position_batch_v2(uuid,uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.process_geofence_position_batch_v2(uuid,uuid,jsonb) to service_role;
-- END_TESTABLE_FAST_PASS
