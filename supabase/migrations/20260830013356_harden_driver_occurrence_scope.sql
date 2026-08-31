-- Applied to production as 20260830013356. Driver occurrences are internal until an operator explicitly
-- publishes them. A NULL stop is an intentional trip-level occurrence and
-- must never be expanded to the first pending stop.

create or replace function public.driver_create_operational_occurrence(
  _trip_id uuid,
  _event_type text,
  _description text,
  _severity text default 'medium'::text,
  _stop_id uuid default null::uuid,
  _client_id uuid default null::uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_driver uuid;
  v_tenant uuid;
  v_load uuid;
  v_vehicle uuid;
  v_client uuid;
  v_stop_client uuid;
  v_fd uuid;
  v_fd_client uuid;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Motorista não autenticado' using errcode = '42501';
  end if;

  if _trip_id is null then
    raise exception 'Viagem obrigatória' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(_event_type, '')), '') is null then
    raise exception 'Tipo da ocorrência obrigatório' using errcode = '22023';
  end if;

  if coalesce(_severity, '') not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Severidade inválida' using errcode = '22023';
  end if;

  select
    driver.id,
    trip.tenant_id,
    coalesce(
      trip.load_id,
      (
        select trip_load.load_id
        from public.dispatch_trip_loads trip_load
        where trip_load.dispatch_trip_id = trip.id
          and trip_load.tenant_id = trip.tenant_id
        order by trip_load.created_at, trip_load.id
        limit 1
      )
    ),
    trip.vehicle_id
  into v_driver, v_tenant, v_load, v_vehicle
  from public.dispatch_trips trip
  join public.drivers driver
    on driver.id = trip.driver_id
   and driver.tenant_id = trip.tenant_id
   and driver.user_id = auth.uid()
   and driver.active = true
  where trip.id = _trip_id
    and trip.status in (
      'planned', 'loading', 'dispatched', 'in_transit',
      'in_progress', 'en_route', 'arrived'
    )
  for share of trip;

  if v_driver is null then
    raise exception 'Viagem não pertence ao motorista ou não está ativa'
      using errcode = '42501';
  end if;

  if _stop_id is null then
    if _client_id is not null then
      raise exception 'Cliente exige uma parada explícita' using errcode = '22023';
    end if;
  else
    select stop.client_id
    into v_stop_client
    from public.dispatch_stops stop
    where stop.id = _stop_id
      and stop.dispatch_trip_id = _trip_id
      and stop.tenant_id = v_tenant;

    if not found then
      raise exception 'Parada não pertence à viagem do motorista'
        using errcode = '42501';
    end if;

    -- A stop can contain multiple fiscal documents. Do not choose an arbitrary
    -- invoice; associate one only when the stop has exactly one document.
    select
      case when count(*) = 1 then (array_agg(fiscal_document.id))[1] end,
      case when count(distinct fiscal_document.client_id) = 1
        then (array_agg(fiscal_document.client_id) filter (where fiscal_document.client_id is not null))[1] end
    into v_fd, v_fd_client
    from public.dispatch_stop_documents stop_document
    join public.fiscal_documents fiscal_document
      on fiscal_document.id = stop_document.fiscal_document_id
     and fiscal_document.tenant_id = stop_document.tenant_id
    where stop_document.dispatch_stop_id = _stop_id
      and stop_document.tenant_id = v_tenant;

    v_client := coalesce(v_stop_client, v_fd_client);

    if _client_id is not null and _client_id is distinct from v_client then
      raise exception 'Cliente não pertence à parada informada'
        using errcode = '42501';
    end if;
  end if;

  insert into public.dispatch_events(
    tenant_id, dispatch_trip_id, dispatch_stop_id, event_type,
    payload, notes, created_by
  ) values (
    v_tenant, _trip_id, _stop_id, 'occurrence',
    jsonb_build_object(
      'source', 'driver_app',
      'severity', _severity,
      'kind', _event_type,
      'scope', case when _stop_id is null then 'trip' else 'stop' end
    ),
    _description, auth.uid()
  );

  insert into public.operational_events(
    tenant_id, client_id, load_id, vehicle_id, driver_id,
    dispatch_trip_id, dispatch_stop_id, fiscal_document_id,
    event_type, severity, description,
    visible_to_client, client_action_required, public_status,
    payload, created_by
  ) values (
    v_tenant, v_client, v_load, v_vehicle, v_driver,
    _trip_id, _stop_id, v_fd,
    _event_type, _severity, _description,
    false, false, 'reported_by_driver',
    jsonb_build_object(
      'source', 'driver_app',
      'scope', case when _stop_id is null then 'trip' else 'stop' end
    ),
    auth.uid()
  ) returning id into v_id;

  return v_id;
end;
$function$;

revoke all privileges on function public.driver_create_operational_occurrence(
  uuid, text, text, text, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.driver_create_operational_occurrence(
  uuid, text, text, text, uuid, uuid
) to authenticated, service_role;

comment on function public.driver_create_operational_occurrence(
  uuid, text, text, text, uuid, uuid
) is
  'Creates an internal driver occurrence. NULL stop means trip scope and never infers client or fiscal document.';
