-- Local candidate: ship with the Control Tower frontend and mandatory MFA release.
-- No integration activation, telemetry ingestion or historical data mutation.
begin;

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

create or replace function public.get_open_trip_alerts(_tenant_id uuid)
returns setof public.trip_alerts language plpgsql stable security invoker set search_path = ''
as $function$
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  if coalesce(auth.jwt()->>'aal','aal1') <> 'aal2' and
    (public.has_tenant_role(_tenant_id,'owner') or public.has_tenant_role(_tenant_id,'admin')) then
    raise exception 'MFA required' using errcode = '42501';
  end if;
  return query select a.* from public.trip_alerts a
    where a.tenant_id=_tenant_id and a.status='open'
    order by case a.severity when 'critical' then 1 when 'danger' then 2 when 'warning' then 3
      when 'info' then 4 when 'success' then 5 else 6 end,a.opened_at desc,a.id;
end;
$function$;

revoke all on function public.get_active_trips_live(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_open_trip_alerts(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_active_trips_live(uuid) to authenticated;
grant execute on function public.get_open_trip_alerts(uuid) to authenticated;
comment on function public.get_active_trips_live(uuid) is 'Control Tower: RLS invoker, explicit tenant/role/MFA, canonical transit and load links; SSX stays disabled unless explicitly enabled.';
comment on function public.get_open_trip_alerts(uuid) is 'Control Tower: RLS invoker with explicit tenant/role/MFA; read-only, never closes manual alerts.';
commit;
