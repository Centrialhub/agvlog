-- Local candidate: deploy with the JWT-only routing Edge and recovery UI.
-- No provider calls, SSX activation or historical route backfill in this migration.
begin;
alter table public.trip_routes add column plan_revision text;
create table control_tower_private.route_calculations (
 tenant_id uuid not null, trip_id uuid not null, actor_id uuid not null, request_id uuid not null,
 attempt_id uuid not null, input_revision text not null, plan_revision text not null,
 coordinates jsonb not null, created_at timestamptz not null, lease_until timestamptz not null,
 result jsonb, payload_hash text,
 primary key(tenant_id,trip_id,actor_id,request_id)
);
alter table control_tower_private.route_calculations enable row level security;
revoke all on control_tower_private.route_calculations from public,anon,authenticated,service_role;
comment on table control_tower_private.route_calculations is 'Private routing request receipts. No provider secrets/raw payloads; retained for replay, not deleted on retry.';

create or replace function control_tower_private.route_plan_revision(_tenant_id uuid,_trip_id uuid)
returns text language sql stable security invoker set search_path=''
as $function$
 select md5(jsonb_build_object('trip',jsonb_build_array(t.id,t.vehicle_id,t.status in ('in_transit','in_progress'),t.actual_start_at),
 'stops',(select jsonb_agg(jsonb_build_array(s.id,s.stop_order,s.latitude,s.longitude) order by s.stop_order,s.id)
 from public.dispatch_stops s where s.tenant_id=t.tenant_id and s.dispatch_trip_id=t.id
 and not(s.status=any(public.stop_terminal_statuses()))))::text)
 from public.dispatch_trips t where t.tenant_id=_tenant_id and t.id=_trip_id;
$function$;

create or replace function control_tower_private.assert_route_actor(_tenant_id uuid)
returns void language plpgsql volatile security invoker set search_path=''
as $function$
declare _role public.app_role;
begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 select role into _role from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active;
 if _role is null or _role not in ('operator','owner','admin') then raise exception 'Forbidden' using errcode='42501';end if;
 if _role in ('owner','admin') and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'MFA required' using errcode='42501';end if;
end;
$function$;

-- The private definer owns only this serialized operation. No generic trip/stop
-- UPDATE privilege is granted to operators just to acquire consistency locks.
create or replace function control_tower_private.prepare_route(_tenant_id uuid,_trip_id uuid,_request_id uuid,_attempt_id uuid)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare t public.dispatch_trips%rowtype;p public.positions_last%rowtype;
 q control_tower_private.route_calculations%rowtype;c jsonb;_now timestamptz;_revision text;
begin
 perform control_tower_private.assert_route_actor(_tenant_id);
 if _request_id is null or _attempt_id is null then raise exception 'Request identity required' using errcode='22023';end if;
 select * into t from public.dispatch_trips where tenant_id=_tenant_id and id=_trip_id for update;
 if not found then raise exception 'Trip unavailable' using errcode='42501';end if;
 perform 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() for share nowait;
 perform control_tower_private.assert_route_actor(_tenant_id);
 select * into q from control_tower_private.route_calculations where tenant_id=_tenant_id and trip_id=_trip_id
 and actor_id=auth.uid() and request_id=_request_id;
 -- Replay is an acknowledgement, never a rewrite of a newer route.
 if q.result is not null then return jsonb_build_object('completed',true,'result',q.result);end if;
 if t.status not in ('planned','loading','dispatched','in_transit','in_progress') then
   raise exception 'Viagem encerrada ou indisponível para cálculo.' using errcode='PT409',hint='route_context_changed';end if;
 perform 1 from public.dispatch_stops where tenant_id=_tenant_id and dispatch_trip_id=_trip_id order by id for share nowait;
 select * into p from public.positions_last where tenant_id=_tenant_id and vehicle_id=t.vehicle_id for share nowait;
 perform 1 from public.trip_routes where tenant_id=_tenant_id and trip_id=_trip_id and provider='osrm' for share nowait;
 _now:=clock_timestamp();_revision:=control_tower_private.context_revision(_tenant_id,_trip_id);
 if q.request_id is not null then
   if t.status in ('in_transit','in_progress') and not coalesce(p.lat between -90 and 90 and p.lng between -180 and 180
     and p.captured_at>_now-interval '15 minutes' and p.captured_at<=_now,false) then
     raise exception 'A posição GPS expirou. Solicite uma nova rota.' using errcode='PT409',hint='route_context_changed';end if;
   if q.input_revision is distinct from _revision or q.created_at < _now-interval '2 minutes' then
     raise exception 'O contexto mudou ou o cálculo expirou. Solicite uma nova rota.' using errcode='PT409',hint='route_context_changed';end if;
   if q.lease_until>_now then raise exception 'Cálculo em andamento. Aguarde e consulte novamente.' using errcode='PT409',hint='route_in_progress';end if;
   update control_tower_private.route_calculations set attempt_id=_attempt_id,lease_until=_now+interval '30 seconds'
   where tenant_id=_tenant_id and trip_id=_trip_id and actor_id=auth.uid() and request_id=_request_id;
   return jsonb_build_object('completed',false,'coordinates',q.coordinates);
 end if;
 if exists(select 1 from public.dispatch_stops s where s.tenant_id=_tenant_id and s.dispatch_trip_id=_trip_id
   and not(s.status=any(public.stop_terminal_statuses())) and
   (s.latitude is null or s.longitude is null or not(s.latitude between -90 and 90 and s.longitude between -180 and 180))) then
   raise exception 'Todas as paradas pendentes precisam de coordenadas válidas.' using errcode='PT422';end if;
 select coalesce(jsonb_agg(jsonb_build_object('lat',s.latitude,'lng',s.longitude) order by s.stop_order,s.id),'[]'::jsonb) into c
 from public.dispatch_stops s where s.tenant_id=_tenant_id and s.dispatch_trip_id=_trip_id and not(s.status=any(public.stop_terminal_statuses()));
 if jsonb_array_length(c)=0 then raise exception 'Não há paradas pendentes para calcular.' using errcode='PT422';end if;
 if t.vehicle_id is not null and not exists(select 1 from public.vehicles where tenant_id=_tenant_id and id=t.vehicle_id) then
   raise exception 'Vehicle unavailable' using errcode='42501';end if;
 if p.vehicle_id is not null and p.lat between -90 and 90 and p.lng between -180 and 180
   and p.captured_at>_now-interval '15 minutes' and p.captured_at<=_now then
   c:=jsonb_build_array(jsonb_build_object('lat',p.lat,'lng',p.lng))||c;
 elsif t.status in ('in_transit','in_progress') then
   raise exception 'Viagem em trânsito exige uma posição GPS válida e recente.' using errcode='PT422';
 end if;
 if jsonb_array_length(c)<2 then raise exception 'São necessários origem e destino válidos.' using errcode='PT422';end if;
 insert into control_tower_private.route_calculations(tenant_id,trip_id,actor_id,request_id,attempt_id,input_revision,plan_revision,coordinates,created_at,lease_until)
 values(_tenant_id,_trip_id,auth.uid(),_request_id,_attempt_id,_revision,control_tower_private.route_plan_revision(_tenant_id,_trip_id),c,_now,_now+interval '30 seconds');
 return jsonb_build_object('completed',false,'coordinates',c);
end;
$function$;

create or replace function control_tower_private.commit_route(_tenant_id uuid,_trip_id uuid,_request_id uuid,_attempt_id uuid,_route jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare t public.dispatch_trips%rowtype;q control_tower_private.route_calculations%rowtype;
 _now timestamptz;_hash text;g jsonb;c jsonb;w jsonb;_first jsonb;_last jsonb;_distance double precision;_duration double precision;
 _id uuid;_result jsonb;_n integer;_index integer:=0;_len double precision:=0;_previous jsonb;
begin
 perform control_tower_private.assert_route_actor(_tenant_id);
 select * into t from public.dispatch_trips where tenant_id=_tenant_id and id=_trip_id for update;
 if not found then raise exception 'Trip unavailable' using errcode='42501';end if;
 perform 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() for share nowait;
 perform control_tower_private.assert_route_actor(_tenant_id);
 select * into q from control_tower_private.route_calculations where tenant_id=_tenant_id and trip_id=_trip_id
 and actor_id=auth.uid() and request_id=_request_id;
 if q.request_id is null then raise exception 'Cálculo não preparado.' using errcode='PT409',hint='route_context_changed';end if;
 _hash:=md5(_route::text);
 if q.result is not null then
   if q.payload_hash is distinct from _hash then raise exception 'Request payload changed' using errcode='PT409',hint='route_payload_changed';end if;
   return q.result;
 end if;
 perform 1 from public.dispatch_stops where tenant_id=_tenant_id and dispatch_trip_id=_trip_id order by id for share nowait;
 perform 1 from public.positions_last where tenant_id=_tenant_id and vehicle_id=t.vehicle_id for share nowait;
 perform 1 from public.trip_routes where tenant_id=_tenant_id and trip_id=_trip_id and provider='osrm' for update nowait;
 _now:=clock_timestamp();
 if q.attempt_id is distinct from _attempt_id or q.lease_until<=_now or q.created_at<_now-interval '2 minutes'
   or t.status not in ('planned','loading','dispatched','in_transit','in_progress')
   or q.input_revision is distinct from control_tower_private.context_revision(_tenant_id,_trip_id) then
   raise exception 'O contexto mudou ou o cálculo expirou. Nenhuma rota foi gravada.' using errcode='PT409',hint='route_context_changed';end if;
 if t.status in ('in_transit','in_progress') and not exists(select 1 from public.positions_last where tenant_id=_tenant_id and vehicle_id=t.vehicle_id
   and captured_at>_now-interval '15 minutes' and captured_at<=_now and lat between -90 and 90 and lng between -180 and 180) then
   raise exception 'A posição GPS expirou durante o cálculo.' using errcode='PT409',hint='route_context_changed';end if;
 g:=_route->'geometry';
 if jsonb_typeof(_route->'distance_meters') is distinct from 'number' or jsonb_typeof(_route->'duration_seconds') is distinct from 'number'
   or jsonb_typeof(_route->'waypoints') is distinct from 'array' or g->>'type' is distinct from 'LineString'
   or jsonb_typeof(g->'coordinates') is distinct from 'array' then raise exception 'Invalid routing result' using errcode='22023';end if;
 _distance:=(_route->>'distance_meters')::double precision;_duration:=(_route->>'duration_seconds')::double precision;
 if not(_distance>=0 and _distance<'Infinity'::double precision and _duration>=0 and _duration<'Infinity'::double precision)
   or jsonb_array_length(g->'coordinates') not between 2 and 100000 or octet_length(_route::text)>8000000 then
   raise exception 'Invalid routing metrics or geometry size' using errcode='22023';end if;
 -- Validate each point even for direct RPC calls. An authorized operator submits
 -- route geometry; this is not cryptographic attestation of an OSRM response.
 perform control_tower_private.route_distance_m(0,0,g);
 if exists(select 1 from jsonb_array_elements(g->'coordinates') point where jsonb_array_length(point)<>2) then
   raise exception 'Route requires two-dimensional coordinates' using errcode='22023';end if;
 _n:=jsonb_array_length(q.coordinates);
 if jsonb_array_length(_route->'waypoints')<>_n then raise exception 'Missing routing waypoints' using errcode='22023';end if;
 for c in select value from jsonb_array_elements(q.coordinates) loop
   w:=_route->'waypoints'->_index->'location';
   if jsonb_typeof(w) is distinct from 'array' then raise exception 'Invalid waypoint' using errcode='22023';end if;
   if jsonb_array_length(w)<>2 or jsonb_typeof(w->0)<>'number' or jsonb_typeof(w->1)<>'number' then raise exception 'Invalid waypoint' using errcode='22023';end if;
   if not((w->>1)::double precision between -90 and 90 and (w->>0)::double precision between -180 and 180)
     or control_tower_private.distance_m((c->>'lat')::double precision,(c->>'lng')::double precision,(w->>1)::double precision,(w->>0)::double precision)>200
     or control_tower_private.route_distance_m((w->>1)::double precision,(w->>0)::double precision,g)>200 then
     raise exception 'Route does not include every requested waypoint' using errcode='22023';end if;
   _index:=_index+1;
 end loop;
 _first:=q.coordinates->0;_last:=q.coordinates->(_n-1);
 if control_tower_private.distance_m((_first->>'lat')::double precision,(_first->>'lng')::double precision,(g->'coordinates'->0->>1)::double precision,(g->'coordinates'->0->>0)::double precision)>200
   or control_tower_private.distance_m((_last->>'lat')::double precision,(_last->>'lng')::double precision,(g->'coordinates'->-1->>1)::double precision,(g->'coordinates'->-1->>0)::double precision)>200 then
   raise exception 'Route endpoints do not match request' using errcode='22023';end if;
 for c in select value from jsonb_array_elements(g->'coordinates') loop
   if _previous is not null then _len:=_len+control_tower_private.distance_m((_previous->>1)::double precision,(_previous->>0)::double precision,(c->>1)::double precision,(c->>0)::double precision);end if;
   _previous:=c;
 end loop;
 if _distance+greatest(100,_len*0.05)<_len or (_distance>0 and _duration<=0) then raise exception 'Routing metrics contradict geometry' using errcode='22023';end if;
 -- The real trip_routes trigger marks settlements outdated and logs an event.
 -- Fail fast on a financial writer's lock rather than invert its lock order.
 perform 1 from public.driver_settlements where tenant_id=_tenant_id and dispatch_trip_id=_trip_id order by id for update nowait;
 insert into public.trip_routes(tenant_id,trip_id,provider,geometry_geojson,distance_meters,duration_seconds,origin_lat,origin_lng,destination_lat,destination_lng,waypoints,calculated_at,updated_at,plan_revision)
 values(_tenant_id,_trip_id,'osrm',g,_distance,_duration,(_first->>'lat')::double precision,(_first->>'lng')::double precision,
   (_last->>'lat')::double precision,(_last->>'lng')::double precision,_route->'waypoints',_now,_now,q.plan_revision)
 on conflict(trip_id,provider) do update set geometry_geojson=excluded.geometry_geojson,distance_meters=excluded.distance_meters,duration_seconds=excluded.duration_seconds,
 origin_lat=excluded.origin_lat,origin_lng=excluded.origin_lng,destination_lat=excluded.destination_lat,destination_lng=excluded.destination_lng,
 waypoints=excluded.waypoints,calculated_at=excluded.calculated_at,updated_at=excluded.updated_at,plan_revision=excluded.plan_revision
 where public.trip_routes.tenant_id=_tenant_id returning id into _id;
 if _id is null then raise exception 'Route tenant mismatch' using errcode='42501';end if;
 _result:=jsonb_build_object('ok',true,'trip_id',_trip_id,'request_id',_request_id,'route_id',_id,'calculated_at',_now,
   'distance_meters',_distance,'duration_seconds',_duration,'waypoint_count',_n);
 update control_tower_private.route_calculations set result=_result,payload_hash=_hash
 where tenant_id=_tenant_id and trip_id=_trip_id and actor_id=auth.uid() and request_id=_request_id;
 return _result;
end;
$function$;

create or replace function public.prepare_trip_route_v1(_tenant_id uuid,_trip_id uuid,_request_id uuid,_attempt_id uuid)
returns jsonb language sql volatile security invoker set search_path=''
as $function$ select control_tower_private.prepare_route(_tenant_id,_trip_id,_request_id,_attempt_id); $function$;
create or replace function public.commit_trip_route_v1(_tenant_id uuid,_trip_id uuid,_request_id uuid,_attempt_id uuid,_route jsonb)
returns jsonb language sql volatile security invoker set search_path=''
as $function$ select control_tower_private.commit_route(_tenant_id,_trip_id,_request_id,_attempt_id,_route); $function$;

revoke all on function control_tower_private.route_plan_revision(uuid,uuid),control_tower_private.assert_route_actor(uuid),
 control_tower_private.prepare_route(uuid,uuid,uuid,uuid),control_tower_private.commit_route(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function control_tower_private.route_plan_revision(uuid,uuid),control_tower_private.prepare_route(uuid,uuid,uuid,uuid),
 control_tower_private.commit_route(uuid,uuid,uuid,uuid,jsonb) to authenticated;
revoke all on function public.prepare_trip_route_v1(uuid,uuid,uuid,uuid),public.commit_trip_route_v1(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.prepare_trip_route_v1(uuid,uuid,uuid,uuid),public.commit_trip_route_v1(uuid,uuid,uuid,uuid,jsonb) to authenticated;
revoke insert,update,delete,truncate,references,trigger on public.trip_routes from public,anon,authenticated;
-- Only routes tied to the current plan may be shown/evaluated. Legacy routes remain stored, not silently certified.
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
 select * into r from public.trip_routes where tenant_id=_tenant_id and trip_id=t.id and provider='osrm' and plan_revision=control_tower_private.route_plan_revision(_tenant_id,t.id) for share nowait;
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
    left join public.trip_routes tr on tr.trip_id=dt.id and tr.tenant_id=dt.tenant_id and tr.provider='osrm' and tr.plan_revision=control_tower_private.route_plan_revision(dt.tenant_id,dt.id)
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
commit;
