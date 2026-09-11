-- Durable command receipts for driver actions first captured without a network
-- connection. The existing domain RPCs remain authoritative; this wrapper only
-- gives them one request identity and an atomic replay receipt.

create table public.driver_operational_command_receipts (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  command text not null check (command in ('arrival','departure','journey_event','checklist','occurrence')),
  trip_id uuid not null references public.dispatch_trips(id) on delete restrict,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{32}$'),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, actor_id, request_id)
);

create index driver_operational_command_receipts_trip_idx
  on public.driver_operational_command_receipts(tenant_id, trip_id, created_at desc);

alter table public.driver_operational_command_receipts enable row level security;
revoke all on table public.driver_operational_command_receipts
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.driver_operational_command_receipts
  to service_role;

create or replace function public.driver_apply_offline_command_v1(
  _tenant_id uuid,
  _request_id uuid,
  _command text,
  _payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_trip_id uuid;
  v_entity_id uuid;
  v_payload_hash text;
  v_existing public.driver_operational_command_receipts%rowtype;
  v_result jsonb;
  v_stop_id uuid;
  v_event_payload jsonb;
  v_previous_receipt_entity uuid;
begin
  if v_actor is null or _tenant_id is null
    or private.request_tenant_id() is distinct from _tenant_id then
    raise exception 'Comando offline fora da sessão ativa' using errcode = '42501';
  end if;
  if _request_id is null then
    raise exception 'Identificador do comando offline é obrigatório' using errcode = '22023';
  end if;
  if _command is null or _command not in ('arrival','departure','journey_event','checklist','occurrence') then
    raise exception 'Comando offline inválido' using errcode = '22023';
  end if;
  if _payload is null or jsonb_typeof(_payload) <> 'object'
    or pg_catalog.octet_length(_payload::text) > 131072 then
    raise exception 'Dados do comando offline são inválidos' using errcode = '22023';
  end if;

  begin
    v_trip_id := nullif(_payload ->> 'trip_id','')::uuid;
  exception when invalid_text_representation then
    raise exception 'Viagem do comando offline é inválida' using errcode = '22023';
  end;
  if v_trip_id is null then
    raise exception 'Viagem do comando offline é obrigatória' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.dispatch_trips trip
    join public.drivers driver
      on driver.id = trip.driver_id and driver.tenant_id = trip.tenant_id
    where trip.id = v_trip_id and trip.tenant_id = _tenant_id
      and driver.user_id = v_actor and driver.active
  ) then
    raise exception 'Viagem não pertence ao motorista desta sessão' using errcode = '42501';
  end if;

  v_payload_hash := md5(_payload::text);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(_tenant_id::text || ':' || v_actor::text || ':' || _request_id::text, 0)
  );

  select * into v_existing
  from public.driver_operational_command_receipts receipt
  where receipt.tenant_id = _tenant_id and receipt.actor_id = v_actor
    and receipt.request_id = _request_id;
  if found then
    if v_existing.command is distinct from _command
      or v_existing.trip_id is distinct from v_trip_id
      or v_existing.payload_hash is distinct from v_payload_hash then
      raise exception 'Identificador offline reutilizado para outro comando' using errcode = '23505';
    end if;
    return v_existing.result || jsonb_build_object('replayed',true);
  end if;

  if _command in ('arrival','departure') then
    begin
      v_stop_id := nullif(_payload ->> 'stop_id','')::uuid;
    exception when invalid_text_representation then
      raise exception 'Parada do comando offline é inválida' using errcode = '22023';
    end;
    if v_stop_id is null or not exists (
      select 1 from public.dispatch_stops stop
      where stop.id = v_stop_id and stop.dispatch_trip_id = v_trip_id and stop.tenant_id = _tenant_id
    ) then
      raise exception 'Parada não pertence à viagem informada' using errcode = '42501';
    end if;
  end if;

  case _command
    when 'arrival' then
      v_entity_id := public.driver_mark_arrival(
        v_stop_id,
        (_payload ->> 'latitude')::double precision,
        (_payload ->> 'longitude')::double precision,
        (_payload ->> 'accuracy_m')::double precision
      );
    when 'departure' then
      v_entity_id := public.driver_register_departure(
        v_stop_id,
        nullif(btrim(_payload ->> 'notes'),'')
      );
    when 'journey_event' then
      if jsonb_typeof(coalesce(_payload -> 'event_payload','{}'::jsonb)) <> 'object' then
        raise exception 'Dados do evento de jornada são inválidos' using errcode = '22023';
      end if;
      v_event_payload := coalesce(_payload -> 'event_payload','{}'::jsonb)
        || jsonb_build_object('client_event_id',_request_id::text);
      if nullif(v_event_payload ->> 'expected_previous_request_id','') is not null then
        select (receipt.result ->> 'entity_id')::uuid
          into strict v_previous_receipt_entity
        from public.driver_operational_command_receipts receipt
        where receipt.tenant_id = _tenant_id and receipt.actor_id = v_actor
          and receipt.request_id = (v_event_payload ->> 'expected_previous_request_id')::uuid
          and receipt.command = 'journey_event' and receipt.trip_id = v_trip_id;
        v_event_payload := (coalesce(_payload -> 'event_payload','{}'::jsonb)
          - 'expected_previous_request_id')
          || jsonb_build_object(
            'client_event_id',_request_id::text,
            'expected_previous_event_id',v_previous_receipt_entity
          );
      end if;
      v_entity_id := public.driver_create_event(
        v_trip_id,
        _payload ->> 'event_type',
        v_event_payload,
        null,
        null
      );
    when 'checklist' then
      if jsonb_typeof(_payload -> 'checklist_payload') <> 'object' then
        raise exception 'Dados do checklist são inválidos' using errcode = '22023';
      end if;
      v_event_payload := _payload -> 'checklist_payload';
      if nullif(v_event_payload ->> 'expected_boundary_request_id','') is not null then
        select (receipt.result ->> 'entity_id')::uuid
          into strict v_previous_receipt_entity
        from public.driver_operational_command_receipts receipt
        where receipt.tenant_id = _tenant_id and receipt.actor_id = v_actor
          and receipt.request_id = (v_event_payload ->> 'expected_boundary_request_id')::uuid
          and receipt.command = 'journey_event' and receipt.trip_id = v_trip_id;
        v_event_payload := (v_event_payload - 'expected_boundary_request_id')
          || jsonb_build_object('expected_boundary_id',v_previous_receipt_entity);
      end if;
      v_entity_id := public.driver_save_checklist(
        v_trip_id,
        _payload ->> 'kind',
        v_event_payload
      );
    when 'occurrence' then
      begin
        v_stop_id := nullif(_payload ->> 'stop_id','')::uuid;
      exception when invalid_text_representation then
        raise exception 'Parada da ocorrência é inválida' using errcode = '22023';
      end;
      v_entity_id := public.driver_create_operational_occurrence(
        v_trip_id,
        _payload ->> 'event_type',
        _payload ->> 'description',
        _payload ->> 'severity',
        v_stop_id,
        case when nullif(_payload ->> 'client_id','') is null then null
          else (_payload ->> 'client_id')::uuid end
      );
  end case;

  v_result := jsonb_build_object(
    'version',1,
    'confirmed',true,
    'replayed',false,
    'tenant_id',_tenant_id,
    'actor_id',v_actor,
    'request_id',_request_id,
    'command',_command,
    'trip_id',v_trip_id,
    'entity_id',v_entity_id
  );

  insert into public.driver_operational_command_receipts(
    tenant_id,actor_id,request_id,command,trip_id,payload_hash,result
  ) values (
    _tenant_id,v_actor,_request_id,_command,v_trip_id,v_payload_hash,v_result
  );
  return v_result;
end;
$function$;

revoke all on function public.driver_apply_offline_command_v1(uuid,uuid,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.driver_apply_offline_command_v1(uuid,uuid,text,jsonb)
  to authenticated, service_role;

comment on function public.driver_apply_offline_command_v1(uuid,uuid,text,jsonb) is
  'Replays arrival, departure, journey, checklist and occurrence commands exactly once per active tenant, actor and request.';
