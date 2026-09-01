-- Additive phase: install the GPS-aware overload while preserving the legacy
-- one-argument RPC until the matching frontend has been published and smoked.
-- Remote ledger version: 20260831232458.
do $arrival_additive_preflight$
declare
  v_legacy_oid oid := pg_catalog.to_regprocedure('public.driver_mark_arrival(uuid)');
  v_legacy_hash text;
begin
  if v_legacy_oid is null then
    raise exception 'Arrival additive preflight failed: legacy RPC is missing';
  end if;

  select pg_catalog.md5(pg_catalog.replace(pg_catalog.pg_get_functiondef(v_legacy_oid), pg_catalog.chr(13), ''))
    into v_legacy_hash;
  if v_legacy_hash <> '71506404e6bafbaeb3dc17a3e2530a1c' then
    raise exception 'Arrival additive preflight failed: legacy RPC hash changed (%)', v_legacy_hash;
  end if;

  if pg_catalog.has_function_privilege('anon', v_legacy_oid, 'execute')
    or not pg_catalog.has_function_privilege('authenticated', v_legacy_oid, 'execute')
    or not pg_catalog.has_function_privilege('service_role', v_legacy_oid, 'execute') then
    raise exception 'Arrival additive preflight failed: legacy RPC ACL changed';
  end if;

  if pg_catalog.to_regprocedure(
    'public.driver_mark_arrival(uuid,double precision,double precision,double precision)'
  ) is not null then
    raise exception 'Arrival additive preflight failed: GPS RPC already exists';
  end if;
end;
$arrival_additive_preflight$;

create function public.driver_mark_arrival(
  _stop_id uuid,
  _latitude double precision,
  _longitude double precision,
  _accuracy_m double precision
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_stop public.dispatch_stops%rowtype;
  v_trip public.dispatch_trips%rowtype;
  v_event_id uuid;
  v_distance_m double precision;
  v_max_distance_m constant double precision := 500;
  v_max_accuracy_m constant double precision := 150;
begin
  if auth.uid() is null then
    raise exception 'Não autenticado' using errcode = '42501';
  end if;

  if _latitude is null or _latitude not between -90 and 90
    or _longitude is null or _longitude not between -180 and 180 then
    raise exception 'Localização inválida' using errcode = '22023';
  end if;

  if _accuracy_m is null or _accuracy_m < 0 or _accuracy_m > v_max_accuracy_m then
    raise exception 'Precisão do GPS insuficiente. Aguarde um sinal melhor e tente novamente.'
      using errcode = '22023';
  end if;

  select stop.*
    into v_stop
  from public.dispatch_stops as stop
  where stop.id = _stop_id;

  if v_stop.id is null then
    raise exception 'Parada não encontrada' using errcode = 'P0002';
  end if;

  perform public._assert_driver_owns_trip(v_stop.dispatch_trip_id);

  select trip.*
    into v_trip
  from public.dispatch_trips as trip
  where trip.id = v_stop.dispatch_trip_id
    and trip.tenant_id = v_stop.tenant_id
  for update;

  if v_trip.id is null or not exists (
    select 1
    from public.drivers as driver
    where driver.id = v_trip.driver_id
      and driver.tenant_id = v_trip.tenant_id
      and driver.user_id = auth.uid()
      and driver.active
  ) then
    raise exception 'Acesso negado à parada' using errcode = '42501';
  end if;

  select stop.* into v_stop
  from public.dispatch_stops as stop
  where stop.id = _stop_id and stop.dispatch_trip_id = v_trip.id
    and stop.tenant_id = v_trip.tenant_id
  for update;
  if not found then
    raise exception 'Parada reatribuída; atualize a viagem' using errcode = '40001';
  end if;

  if v_trip.status is null or v_trip.status not in ('in_transit', 'in_progress')
    or v_trip.actual_start_at is null then
    raise exception 'Inicie a viagem antes de registrar a chegada' using errcode = '23514';
  end if;

  if v_stop.status = 'arrived' and v_stop.actual_arrival_at is not null then
    select event.id
      into v_event_id
    from public.dispatch_events as event
    where event.dispatch_stop_id = v_stop.id
      and event.tenant_id = v_trip.tenant_id
      and event.dispatch_trip_id = v_trip.id
      and event.created_by = auth.uid()
      and event.event_type = 'arrival'
    order by event.event_at desc
    limit 1;

    if v_event_id is not null then
      return v_event_id;
    end if;
  end if;

  if v_stop.status = any(public.stop_terminal_statuses()) then
    raise exception 'Parada já encerrada' using errcode = '23514';
  end if;

  if v_stop.status is null or v_stop.status not in ('pending', 'planned', 'arriving') then
    raise exception 'Parada não está aguardando chegada' using errcode = '23514';
  end if;

  if v_stop.latitude is null or v_stop.longitude is null then
    raise exception 'Parada sem coordenadas. Solicite a correção à operação.'
      using errcode = '23514';
  end if;

  v_distance_m := extensions.st_distance(
    extensions.st_setsrid(
      extensions.st_makepoint(_longitude, _latitude),
      4326
    )::extensions.geography,
    extensions.st_setsrid(
      extensions.st_makepoint(v_stop.longitude, v_stop.latitude),
      4326
    )::extensions.geography
  );

  if v_distance_m > v_max_distance_m + _accuracy_m then
    raise exception 'Você está fora do raio permitido para esta parada (% m)', round(v_distance_m)
      using errcode = '23514';
  end if;

  update public.dispatch_stops
  set status = 'arrived',
      actual_arrival_at = coalesce(actual_arrival_at, statement_timestamp()),
      updated_at = statement_timestamp()
  where id = v_stop.id;

  insert into public.dispatch_events(
    tenant_id,
    dispatch_trip_id,
    dispatch_stop_id,
    event_type,
    payload,
    created_by
  ) values (
    v_stop.tenant_id,
    v_stop.dispatch_trip_id,
    v_stop.id,
    'arrival',
    jsonb_build_object(
      'source', 'driver_app',
      'latitude', _latitude,
      'longitude', _longitude,
      'accuracy_m', _accuracy_m,
      'distance_to_stop_m', round(v_distance_m),
      'geofence_radius_m', v_max_distance_m,
      'geofence_verified', true
    ),
    auth.uid()
  )
  returning id into v_event_id;

  return v_event_id;
end;
$function$;

revoke all privileges
  on function public.driver_mark_arrival(uuid, double precision, double precision, double precision)
  from public, anon, authenticated, service_role;
grant execute
  on function public.driver_mark_arrival(uuid, double precision, double precision, double precision)
  to authenticated;

comment on function public.driver_mark_arrival(uuid, double precision, double precision, double precision) is
  'Records an assigned driver arrival only after GPS accuracy and a 500 m stop-radius check. The legacy overload remains during the additive rollout phase.';
