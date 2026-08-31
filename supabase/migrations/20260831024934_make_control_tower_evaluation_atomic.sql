-- Local candidate. No integration is activated; deploy with the caller-JWT Edge.
begin;
create schema if not exists control_tower_private;
revoke all on schema control_tower_private from public,anon,authenticated,service_role;
grant usage on schema control_tower_private to authenticated;

create or replace function control_tower_private.distance_m(a_lat double precision,a_lng double precision,b_lat double precision,b_lng double precision)
returns double precision language sql immutable strict security invoker set search_path=''
as $function$
 select 12742000 * asin(sqrt(greatest(0,least(1,
   power(sin(radians(b_lat-a_lat)/2),2)+cos(radians(a_lat))*cos(radians(b_lat))*power(sin(radians(b_lng-a_lng)/2),2)))));
$function$;

create or replace function control_tower_private.route_distance_m(p_lat double precision,p_lng double precision,geometry jsonb)
returns double precision language plpgsql immutable strict security invoker set search_path=''
as $function$
declare c jsonb; a_lat double precision; a_lng double precision; b_lat double precision; b_lng double precision;
 d double precision; len double precision; bearing_p double precision; bearing_b double precision;
 along double precision; cross_track double precision; result double precision := 'Infinity';
begin
 if geometry->>'type' is distinct from 'LineString' or jsonb_typeof(geometry->'coordinates') is distinct from 'array' then
   raise exception 'Invalid route geometry' using errcode='22023';
 end if;
 if jsonb_array_length(geometry->'coordinates')<2 then raise exception 'Route requires two points' using errcode='22023';end if;
 for c in select value from jsonb_array_elements(geometry->'coordinates') loop
   if jsonb_typeof(c)<>'array' or jsonb_array_length(c)<2 or jsonb_typeof(c->0)<>'number' or jsonb_typeof(c->1)<>'number' then
     raise exception 'Invalid route coordinate' using errcode='22023';
   end if;
   b_lng:=(c->>0)::double precision;b_lat:=(c->>1)::double precision;
   if not (b_lat between -90 and 90 and b_lng between -180 and 180) then raise exception 'Invalid route coordinate' using errcode='22023';end if;
   result:=least(result,control_tower_private.distance_m(p_lat,p_lng,b_lat,b_lng));
   if a_lat is not null then
     len:=control_tower_private.distance_m(a_lat,a_lng,b_lat,b_lng)/6371000;
     d:=control_tower_private.distance_m(a_lat,a_lng,p_lat,p_lng)/6371000;
     if len>1e-12 and pi()-len>1e-12 then
       bearing_p:=atan2(sin(radians(p_lng-a_lng))*cos(radians(p_lat)),cos(radians(a_lat))*sin(radians(p_lat))-sin(radians(a_lat))*cos(radians(p_lat))*cos(radians(p_lng-a_lng)));
       bearing_b:=atan2(sin(radians(b_lng-a_lng))*cos(radians(b_lat)),cos(radians(a_lat))*sin(radians(b_lat))-sin(radians(a_lat))*cos(radians(b_lat))*cos(radians(b_lng-a_lng)));
       along:=atan2(sin(d)*cos(bearing_p-bearing_b),cos(d));
       if along between 0 and len then
         cross_track:=asin(greatest(-1,least(1,sin(d)*sin(bearing_p-bearing_b))));
         result:=least(result,abs(cross_track)*6371000);
       end if;
     end if;
   end if;
   a_lat:=b_lat;a_lng:=b_lng;
 end loop;
 return result;
end;
$function$;

-- INVOKER: the reader cannot use this digest to bypass table RLS.
create or replace function control_tower_private.context_revision(_tenant_id uuid,_trip_id uuid)
returns text language sql stable security invoker set search_path=''
as $function$
 select md5(jsonb_build_object('trip',jsonb_build_array(t.id,t.tenant_id,t.vehicle_id,t.status,t.actual_start_at),
 'stops',(select jsonb_agg(jsonb_build_array(s.id,s.stop_order,s.status,s.latitude,s.longitude,s.planned_arrival_at,s.actual_arrival_at,s.actual_departure_at) order by s.stop_order,s.id)
   from public.dispatch_stops s where s.tenant_id=t.tenant_id and s.dispatch_trip_id=t.id),
 'position',(select jsonb_build_array(p.lat,p.lng,p.speed,p.captured_at) from public.positions_last p where p.tenant_id=t.tenant_id and p.vehicle_id=t.vehicle_id),
 'route',(select jsonb_build_array(r.id,r.geometry_geojson,r.calculated_at,r.updated_at) from public.trip_routes r where r.tenant_id=t.tenant_id and r.trip_id=t.id and r.provider='osrm'))::text)
 from public.dispatch_trips t where t.tenant_id=_tenant_id and t.id=_trip_id;
$function$;

create or replace function control_tower_private.assert_evaluator(_tenant_id uuid)
returns void language plpgsql volatile security invoker set search_path=''
as $function$
declare _role public.app_role;
begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 select m.role into _role from public.tenant_memberships m where m.tenant_id=_tenant_id and m.user_id=auth.uid() and m.active;
 if _role is null or _role not in ('owner','admin','operator') then raise exception 'Forbidden' using errcode='42501';end if;
 if _role in ('owner','admin') and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'MFA required' using errcode='42501';end if;
 if not exists(select 1 from public.tenant_feature_policy p where p.tenant_id=_tenant_id and p.feature_key='ssx_enabled' and p.enabled)
   or exists(select 1 from public.tenant_feature_policy p where p.tenant_id=_tenant_id and p.feature_key='ssx_kill_switch' and p.enabled) then
   raise exception 'SSX disabled' using errcode='42501';
 end if;
end;
$function$;

-- Definer is confined to this non-exposed schema. Operators must not acquire
-- generic UPDATE rights on trips/stops merely to serialize derived evaluations.
-- No caller-provided status, geometry, actor, timestamp or metric is accepted.
create or replace function control_tower_private.evaluate(_tenant_id uuid,_trip_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare
 t public.dispatch_trips%rowtype;p public.positions_last%rowtype;s public.dispatch_stops%rowtype;
 r public.trip_routes%rowtype;_now timestamptz;_revision text;_state text:='normal';_severity text:='info';_message text:='Em rota';
 _distance double precision;_stop_distance double precision;_speed double precision;_age integer;_delay integer;_stopped integer;_since timestamptz;_eta timestamptz;
 _alert_type text;_alert_id uuid;_title text;
begin
 perform control_tower_private.assert_evaluator(_tenant_id);
 -- Same root-first lock order as the delivery/planning writers. NOWAIT on child
 -- rows prevents inversion with a legacy child-first writer: retry, never partial success.
 select * into t from public.dispatch_trips where tenant_id=_tenant_id and id=_trip_id for update;
 if not found then raise exception 'Trip unavailable' using errcode='42501';end if;
 perform 1 from public.dispatch_stops where tenant_id=_tenant_id and dispatch_trip_id=t.id order by id for share nowait;
 select * into p from public.positions_last where tenant_id=_tenant_id and vehicle_id=t.vehicle_id for share nowait;
 select * into r from public.trip_routes where tenant_id=_tenant_id and trip_id=t.id and provider='osrm' for share nowait;
 -- Recheck after any root wait, and hold existing membership/capability rows.
 perform 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() for share nowait;
 perform 1 from public.tenant_feature_policy where tenant_id=_tenant_id and feature_key in ('ssx_enabled','ssx_kill_switch') order by feature_key for share nowait;
 perform control_tower_private.assert_evaluator(_tenant_id);
 if t.status not in ('in_transit','in_progress') or t.vehicle_id is null then
   return jsonb_build_object('ok',true,'evaluated',false,'trip_id',t.id,'reason','trip_not_in_transit');
 end if;
 if not exists(select 1 from public.vehicles where id=t.vehicle_id and tenant_id=_tenant_id) then
   raise exception 'Vehicle unavailable' using errcode='23514';
 end if;
 _now:=clock_timestamp();
 _revision:=control_tower_private.context_revision(_tenant_id,t.id);
 select * into s from public.dispatch_stops where tenant_id=_tenant_id and dispatch_trip_id=t.id
   and not(status=any(public.stop_terminal_statuses())) order by stop_order,id limit 1;
 if p.vehicle_id is null or p.captured_at is null or p.captured_at>_now
   or not(p.lat between -90 and 90 and p.lng between -180 and 180) then
   _state:='no_signal';_severity:='danger';_message:='Veículo sem posição registrada';
 else
   _age:=least(2147483647,greatest(0,round(extract(epoch from _now-p.captured_at))))::integer;
   if p.speed>=0 and p.speed<'Infinity'::double precision then _speed:=p.speed;end if;
   if _now-p.captured_at>=interval '15 minutes' then
     _state:='no_signal';_severity:='danger';_message:=format('Sem sinal há %s minutos',round(_age/60.0));
   else
     if r.id is not null then
       _distance:=control_tower_private.route_distance_m(p.lat,p.lng,r.geometry_geojson);
       if _distance>500 and _speed>10 then
         _state:='off_route';_severity:='critical';_message:=format('Veículo a %sm da rota planejada',round(_distance));
       end if;
     end if;
     if _state='normal' and s.latitude between -90 and 90 and s.longitude between -180 and 180 then
       _stop_distance:=control_tower_private.distance_m(p.lat,p.lng,s.latitude,s.longitude);
       if _stop_distance<=150 and _speed<5 then _state:='at_stop';_severity:='success';_message:='Na parada';
       elsif _stop_distance<=1000 then _state:='arriving';_message:=format('Chegando (%sm)',round(_stop_distance));end if;
       -- Reference the observation time: repeated polling must not push ETA forward.
       if _speed>5 then _eta:=p.captured_at+(_stop_distance/(_speed/3.6))*interval '1 second';end if;
       if _eta>s.planned_arrival_at then
         _delay:=round(extract(epoch from _eta-s.planned_arrival_at)/60)::integer;
         if _delay>5 and _state<>'at_stop' then
           _state:='delayed';_severity:=case when _delay>30 then 'danger' else 'warning' end;
           _message:=format('ETA %smin após o planejado',_delay);
         end if;
       end if;
     end if;
     if _state='normal' and _speed<3 then
       select max(captured_at) into _since from public.positions_raw where tenant_id=_tenant_id and vehicle_id=t.vehicle_id
         and captured_at between p.captured_at-interval '2 hours' and p.captured_at and speed>=3;
       if _since is null then
         select min(captured_at) into _since from public.positions_raw where tenant_id=_tenant_id and vehicle_id=t.vehicle_id
           and captured_at between p.captured_at-interval '2 hours' and p.captured_at and speed>=0 and speed<3;
       end if;
       _stopped:=coalesce(least(120,greatest(0,floor(extract(epoch from p.captured_at-_since)/60)))::integer,0);
       if _stopped>=10 then _state:='stopped';_severity:='warning';_message:=format('Veículo parado há %smin',_stopped);end if;
     end if;
   end if;
 end if;
 insert into public.trip_live_status(tenant_id,trip_id,vehicle_id,state,severity,current_stop_id,next_stop_id,
   distance_from_route_meters,delay_minutes,stopped_minutes,average_speed_kmh,eta_next_stop_at,last_signal_at,last_signal_age_seconds,message,metadata,updated_at)
 values(_tenant_id,t.id,t.vehicle_id,_state,_severity,case when _state='at_stop' then s.id end,s.id,
   _distance,_delay,_stopped,null,_eta,p.captured_at,_age,_message,jsonb_build_object('evaluation_version',1,'context_revision',_revision),_now)
 on conflict(tenant_id,trip_id) do update set vehicle_id=excluded.vehicle_id,state=excluded.state,severity=excluded.severity,
   current_stop_id=excluded.current_stop_id,next_stop_id=excluded.next_stop_id,distance_from_route_meters=excluded.distance_from_route_meters,
   delay_minutes=excluded.delay_minutes,stopped_minutes=excluded.stopped_minutes,average_speed_kmh=excluded.average_speed_kmh,
   eta_next_stop_at=excluded.eta_next_stop_at,last_signal_at=excluded.last_signal_at,last_signal_age_seconds=excluded.last_signal_age_seconds,
   message=excluded.message,metadata=coalesce(public.trip_live_status.metadata,'{}'::jsonb)||excluded.metadata,updated_at=excluded.updated_at;

 if _state in ('off_route','no_signal','delayed','stopped') then _alert_type:=_state;end if;
 update public.trip_alerts set status='closed',closed_at=_now,
   metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('closed_by','tracking_evaluation','context_revision',_revision)
   where tenant_id=_tenant_id and trip_id=t.id and status in ('open','acknowledged')
     and type in ('off_route','no_signal','delayed','stopped') and type is distinct from _alert_type;
 if _alert_type is not null then
   select id into _alert_id from public.trip_alerts where tenant_id=_tenant_id and trip_id=t.id
     and status in ('open','acknowledged') and type=_alert_type order by opened_at,id limit 1;
   _title:=case _state when 'off_route' then 'Fora da rota' when 'no_signal' then 'Sem sinal' when 'delayed' then 'Atrasado' else 'Parado' end;
   if _alert_id is null then
     insert into public.trip_alerts(tenant_id,trip_id,vehicle_id,type,severity,title,message,opened_at,metadata)
     values(_tenant_id,t.id,t.vehicle_id,_alert_type,_severity,_title,_message,_now,jsonb_build_object('source','tracking_evaluation','context_revision',_revision)) returning id into _alert_id;
   else
     update public.trip_alerts set vehicle_id=t.vehicle_id,severity=_severity,title=_title,message=_message,
       metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('context_revision',_revision) where tenant_id=_tenant_id and id=_alert_id;
     -- Preserve IDs/history of old duplicates, explicitly marking their replacement.
     update public.trip_alerts set status='closed',closed_at=_now,
       metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('superseded_by',_alert_id,'closed_by','tracking_evaluation')
       where tenant_id=_tenant_id and trip_id=t.id and type=_alert_type and status in ('open','acknowledged') and id<>_alert_id;
   end if;
 end if;
 return jsonb_build_object('ok',true,'evaluated',true,'trip_id',t.id,'state',_state,'context_revision',_revision);
end;
$function$;

create or replace function public.evaluate_trip_live_status_v1(_tenant_id uuid,_trip_id uuid)
returns jsonb language sql volatile security invoker set search_path=''
as $function$ select control_tower_private.evaluate(_tenant_id,_trip_id); $function$;

revoke all on all functions in schema control_tower_private from public,anon,authenticated,service_role;
grant execute on function control_tower_private.context_revision(uuid,uuid),control_tower_private.evaluate(uuid,uuid) to authenticated;
revoke all on function public.evaluate_trip_live_status_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.evaluate_trip_live_status_v1(uuid,uuid) to authenticated;
-- Current application callers inventoried: only update-trip-live-status wrote
-- these tables. Keep SELECT policies and service ingestion rights unchanged.
revoke insert,update,delete,truncate,references,trigger on public.trip_live_status,public.trip_alerts from public,anon,authenticated;
create or replace function public.get_active_trips_live(_tenant_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $function$
declare _result jsonb; _tracking boolean; _read_at timestamptz := statement_timestamp();
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  -- Also safe with the legacy role helpers during a coordinated rollout.
  if coalesce(auth.jwt()->>'aal','aal1') <> 'aal2' and
    (public.has_tenant_role(_tenant_id,'owner') or public.has_tenant_role(_tenant_id,'admin')) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  select exists(select 1 from public.tenant_feature_policy p where p.tenant_id=_tenant_id
      and p.feature_key='ssx_enabled' and p.enabled)
    and not exists(select 1 from public.tenant_feature_policy p where p.tenant_id=_tenant_id
      and p.feature_key='ssx_kill_switch' and p.enabled) into _tracking;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.trip_id),'[]'::jsonb) into _result
  from (
    select dt.id trip_id, dt.tenant_id, dt.status trip_status, dt.actual_start_at,
      coalesce(ld.items->0->>'code',dt.id::text) trip_code,
      dt.vehicle_id,v.plate vehicle_plate,v.nickname vehicle_name,
      dt.driver_id,d.name driver_name,d.phone driver_phone,
      _tracking tracking_enabled,
      case when pos.fresh then pl.lat end lat,case when pos.fresh then pl.lng end lng,
      case when pos.fresh then pl.speed end speed_kmh,case when pos.fresh then pl.heading end heading,
      case when dt.status not in ('in_transit','in_progress') then 'planned'
        when not _tracking then 'tracking_disabled'
        when not coalesce(pos.fresh,false) then 'no_signal'
        when tls.trip_id is null then 'unknown' else tls.state end state,
      case when dt.status not in ('in_transit','in_progress') or not _tracking then 'info'
        when not coalesce(pos.fresh,false) then 'danger'
        when tls.trip_id is null then 'info' else tls.severity end severity,
      case when dt.status not in ('in_transit','in_progress') then 'Viagem ainda não iniciada'
        when not _tracking then 'SSX desativado; dados operacionais disponíveis'
        when not coalesce(pos.fresh,false) then 'Sem posição recente válida'
        when tls.trip_id is null then 'Aguardando avaliação da posição atual' else tls.message end status_message,
      tr.geometry_geojson route_geometry_geojson,
      tls.distance_from_route_meters,tls.delay_minutes,tls.stopped_minutes,
      tls.average_speed_kmh,tls.eta_next_stop_at,
      pl.captured_at last_signal_at,
      case when pl.captured_at <= _read_at then extract(epoch from _read_at-pl.captured_at)::integer end last_signal_age_seconds,
      pl.captured_at position_captured_at,
      pending.items->0 next_stop, previous.items previous_stops,pending.items pending_stops,ld.items loads
    from public.dispatch_trips dt
    left join public.vehicles v on v.id=dt.vehicle_id and v.tenant_id=dt.tenant_id
    left join public.drivers d on d.id=dt.driver_id and d.tenant_id=dt.tenant_id
    left join public.positions_last pl on pl.vehicle_id=dt.vehicle_id and pl.tenant_id=dt.tenant_id and _tracking
    cross join lateral (select coalesce(_tracking and pl.captured_at between _read_at-interval '15 minutes' and _read_at
      and pl.lat between -90 and 90 and pl.lng between -180 and 180,false) fresh) pos
    left join public.trip_live_status tls on tls.trip_id=dt.id and tls.tenant_id=dt.tenant_id
      and tls.vehicle_id=dt.vehicle_id and pos.fresh and dt.status in ('in_transit','in_progress')
      and tls.last_signal_at=pl.captured_at and tls.updated_at>=pl.captured_at
      and tls.updated_at between _read_at-interval '15 minutes' and _read_at
      and tls.metadata->>'context_revision'=control_tower_private.context_revision(dt.tenant_id,dt.id)
    left join public.trip_routes tr on tr.trip_id=dt.id and tr.tenant_id=dt.tenant_id and tr.provider='osrm'
    cross join lateral (
      select coalesce(jsonb_agg(to_jsonb(s) order by s.sequence,s.id),'[]'::jsonb) items from (
        select s.id,s.stop_order sequence,s.destination client_name,s.status,
          s.planned_arrival_at,s.actual_arrival_at,s.actual_departure_at,s.latitude,s.longitude
        from public.dispatch_stops s where s.dispatch_trip_id=dt.id and s.tenant_id=dt.tenant_id
          and not (s.status=any(public.stop_terminal_statuses()))
      ) s
    ) pending
    cross join lateral (
      select coalesce(jsonb_agg(to_jsonb(s) order by s.sequence,s.id),'[]'::jsonb) items from (
        select s.id,s.stop_order sequence,s.destination client_name,s.status,
          s.planned_arrival_at,s.actual_arrival_at,s.actual_departure_at,s.latitude,s.longitude
        from public.dispatch_stops s where s.dispatch_trip_id=dt.id and s.tenant_id=dt.tenant_id
          and s.status=any(public.stop_terminal_statuses())
      ) s
    ) previous
    cross join lateral (
      select coalesce(jsonb_agg(to_jsonb(l) order by l.code,l.id),'[]'::jsonb) items from (
        select lo.id,lo.load_number code,lo.total_weight_kg total_weight,lo.status,
          (select count(distinct li.fiscal_document_id) from public.load_items li
            where li.load_id=lo.id and li.tenant_id=dt.tenant_id) documents_count
        from public.loads lo where lo.tenant_id=dt.tenant_id and exists (
          select 1 from public.dispatch_trip_loads dtl where dtl.dispatch_trip_id=dt.id
            and dtl.tenant_id=dt.tenant_id and dtl.load_id=lo.id)
      ) l
    ) ld
    where dt.tenant_id=_tenant_id and dt.status in ('planned','loading','dispatched','in_progress','in_transit')
  ) t;
  return _result;
end;
$function$;
-- Automatic alerts are current evaluations, not historical evidence. Keep their
-- rows for audit, but do not present a stale context as an active warning.
create or replace function public.get_open_trip_alerts(_tenant_id uuid)
returns setof public.trip_alerts language plpgsql stable security invoker set search_path=''
as $function$
declare _trips jsonb;
begin
 _trips:=public.get_active_trips_live(_tenant_id); -- Same explicit role/MFA + RLS checks.
 return query select a.* from public.trip_alerts a
 where a.tenant_id=_tenant_id and a.status='open' and
 (a.type not in ('off_route','no_signal','delayed','stopped') or
   (a.metadata->>'context_revision'=control_tower_private.context_revision(a.tenant_id,a.trip_id)
    and exists(select 1 from jsonb_array_elements(_trips) t where t->>'trip_id'=a.trip_id::text
      and (t->>'tracking_enabled')::boolean and t->>'trip_status' in ('in_transit','in_progress') and t->>'state'=a.type)))
 order by case a.severity when 'critical' then 1 when 'danger' then 2 when 'warning' then 3
   when 'info' then 4 when 'success' then 5 else 6 end,a.opened_at desc,a.id;
end;
$function$;
commit;
