-- "Nenhuma específica" is an explicit trip-level scope. The earlier hardening
-- removed stop/client/fiscal-document associations, but still copied the
-- trip's load_id. Keep the occurrence entirely unscoped until the driver
-- selects a stop; explicit-stop behavior and the public contract stay intact.
-- Remote ledger version: 20260831232156.

do $occurrence_scope_preflight$
declare
  v_rpc_oid oid := pg_catalog.to_regprocedure(
    'public.driver_create_operational_occurrence(uuid,text,text,text,uuid,uuid)'
  );
  v_rpc_hash text;
begin
  if v_rpc_oid is null then
    raise exception 'Occurrence scope preflight failed: RPC is missing';
  end if;

  select pg_catalog.md5(pg_catalog.replace(
    pg_catalog.pg_get_functiondef(v_rpc_oid), pg_catalog.chr(13), ''
  )) into v_rpc_hash;

  if v_rpc_hash not in (
    'adb0ddae0597c0a0e3bd0b888b310214',
    'f1845e654aa8179eae511af85119a3e8'
  ) then
    raise exception 'Occurrence scope preflight failed: RPC hash changed (%)', v_rpc_hash;
  end if;

  if pg_catalog.has_function_privilege('anon', v_rpc_oid, 'execute')
    or not pg_catalog.has_function_privilege('authenticated', v_rpc_oid, 'execute')
    or not pg_catalog.has_function_privilege('service_role', v_rpc_oid, 'execute') then
    raise exception 'Occurrence scope preflight failed: RPC ACL changed';
  end if;
end;
$occurrence_scope_preflight$;

do $repair_historical_unscoped_occurrence$
declare
  v_event public.operational_events%rowtype;
  v_event_id constant uuid := '0cff2aa3-2aca-431d-ad7d-26367b6f48c2';
  v_expected_load_id constant uuid := '585c92b4-cad8-468b-a2b0-8c08c2dcd849';
  v_request_id constant text := '20260831225210';
begin
  select event.*
    into v_event
  from public.operational_events as event
  where event.id = v_event_id
  for update;

  -- Fresh/staging databases do not contain the production incident.
  if not found then
    return;
  end if;

  if v_event.tenant_id is distinct from '6e874e6e-5bca-486d-9928-bef0646989c4'::uuid
    or v_event.vehicle_id is distinct from '8c80a14e-f5f2-48b5-b0e0-e80b1d7daf4c'::uuid
    or v_event.driver_id is distinct from 'b0b8068e-b8bc-4f17-8a74-9701dcd8cc28'::uuid
    or v_event.dispatch_trip_id is distinct from '1efc5b8d-9dfc-426a-8c3b-c6def66b9afe'::uuid
    or v_event.dispatch_stop_id is not null
    or v_event.fiscal_document_id is not null
    or v_event.client_id is not null
    or v_event.event_type is distinct from 'other'
    or v_event.severity is distinct from 'medium'
    or v_event.public_status is distinct from 'reported_by_driver'
    or v_event.created_by is distinct from '87873f27-3602-4f5c-8a27-191355c6e326'::uuid
    or v_event.payload is distinct from '{}'::jsonb
    or pg_catalog.md5(coalesce(v_event.description, '')) <> '17d4bc0884d69d4b581c8d84890cb84b'
    or v_event.visible_to_client is distinct from false
    or v_event.client_action_required is distinct from false then
    raise exception 'Historical occurrence precondition failed; refusing load-scope repair'
      using errcode = 'P0001';
  end if;

  if v_event.load_id is null then
    if not exists (
      select 1
      from public.entity_audit_log as audit
      where audit.entity_type = 'operational_event'
        and audit.entity_id = v_event_id
        and audit.action = 'repair_driver_occurrence_load_scope'
        and audit.request_id = v_request_id
        and audit.source = 'driver_occurrence_load_scope_repair'
        and audit.old_data = jsonb_build_object('load_id', v_expected_load_id)
        and audit.new_data = jsonb_build_object('load_id', null)
    ) then
      raise exception 'Historical occurrence is already unscoped without the expected audit record'
        using errcode = 'P0001';
    end if;
    return;
  end if;

  if v_event.load_id is distinct from v_expected_load_id then
    raise exception 'Historical occurrence load changed; refusing load-scope repair'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.entity_audit_log as audit
    where audit.entity_type = 'operational_event'
      and audit.entity_id = v_event_id
      and audit.request_id = v_request_id
  ) then
    raise exception 'Historical occurrence audit already exists before repair'
      using errcode = 'P0001';
  end if;

  insert into public.entity_audit_log(
    tenant_id, entity_type, entity_id, action, old_data, new_data,
    actor_role, source, request_id, created_at
  ) values (
    v_event.tenant_id,
    'operational_event',
    v_event.id,
    'repair_driver_occurrence_load_scope',
    jsonb_build_object('load_id', v_event.load_id),
    jsonb_build_object('load_id', null),
    'system',
    'driver_occurrence_load_scope_repair',
    v_request_id,
    statement_timestamp()
  );

  update public.operational_events
  set load_id = null,
      updated_at = statement_timestamp()
  where id = v_event_id
    and load_id = v_expected_load_id;

  if not found then
    raise exception 'Historical occurrence changed while applying load-scope repair'
      using errcode = '40001';
  end if;
end;
$repair_historical_unscoped_occurrence$;

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

    -- A trip-level report must not inherit a load merely because the selected
    -- trip currently carries one. This keeps the empty UI selection empty.
    v_load := null;
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
  'Creates an internal driver occurrence. NULL stop means trip scope without stop, client, load, or fiscal-document associations.';
