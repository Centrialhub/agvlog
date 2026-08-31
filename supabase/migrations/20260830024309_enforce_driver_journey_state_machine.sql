-- Published as 20260830024309; preserve the existing operational API contracts.
-- Preserve current operational statuses; harden the helper's search_path and
-- fail closed for a missing status without widening the driver authorization.
create or replace function public._assert_driver_owns_trip(_trip_id uuid)
returns table(driver_id uuid, tenant_id uuid, status text)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_trip public.dispatch_trips%rowtype;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select trip.*
    into v_trip
  from public.dispatch_trips as trip
  where trip.id = _trip_id;

  if v_trip.id is null then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.drivers as driver
    where driver.id = v_trip.driver_id
      and driver.user_id = auth.uid()
      and driver.tenant_id = v_trip.tenant_id
      and driver.active
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if v_trip.status is null or v_trip.status not in (
    'planned', 'loading', 'dispatched', 'in_transit', 'in_progress', 'completed'
  ) then
    raise exception 'trip_not_active' using errcode = '22023';
  end if;

  driver_id := v_trip.driver_id;
  tenant_id := v_trip.tenant_id;
  status := v_trip.status;
  return next;
end;
$function$;

revoke all privileges on function public._assert_driver_owns_trip(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public._assert_driver_owns_trip(uuid) to service_role;

create index if not exists dispatch_events_journey_timeline_idx
  on public.dispatch_events (dispatch_trip_id, event_at desc, created_at desc)
  where event_type in ('start_shift', 'lunch', 'rest', 'overnight', 'resume', 'end_shift');

-- A shift belongs to the authenticated driver/person within a tenant, not to
-- one trip. Serialize its writers even when two devices select different trips.
create index if not exists dispatch_events_personal_journey_idx
  on public.dispatch_events (tenant_id, created_by, event_at desc, created_at desc, id desc)
  where event_type in ('start_shift','lunch','rest','overnight','resume','end_shift','checklist_pre','checklist_post');

create or replace function public._lock_driver_journey_trip(_trip_id uuid)
returns public.dispatch_trips
language plpgsql security definer set search_path = ''
as $function$
declare v_trip public.dispatch_trips%rowtype;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode = '42501'; end if;
  select * into v_trip from public.dispatch_trips where id = _trip_id;
  if not found then raise exception 'Viagem não encontrada' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.drivers d where d.id = v_trip.driver_id
    and d.tenant_id = v_trip.tenant_id and d.user_id = auth.uid() and d.active) then
    raise exception 'Acesso negado à viagem' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'driver_journey:' || v_trip.tenant_id::text || ':' || auth.uid()::text, 0));
  -- Revalidate ownership after waiting for the lock; assignment may have changed.
  select t.* into v_trip from public.dispatch_trips t join public.drivers d
    on d.id = t.driver_id and d.tenant_id = t.tenant_id
  where t.id = _trip_id and d.user_id = auth.uid() and d.active for share of t;
  if not found then raise exception 'Acesso negado à viagem' using errcode = '42501'; end if;
  if v_trip.status is null or v_trip.status not in
    ('planned','loading','dispatched','in_transit','in_progress','completed') then
    raise exception 'Viagem cancelada ou indisponível' using errcode = '23514';
  end if;
  return v_trip;
end;
$function$;
revoke all on function public._lock_driver_journey_trip(uuid) from public, anon, authenticated, service_role;

create or replace function public.driver_get_journey_context(_tenant_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $function$
declare v_events jsonb; v_start jsonb; v_end jsonb;
begin
  if auth.uid() is null or not exists (select 1 from public.drivers d
    where d.tenant_id = _tenant_id and d.user_id = auth.uid() and d.active) then
    raise exception 'Acesso negado à jornada' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.event_at,e.created_at,e.id),'[]'::jsonb)
  into v_events from (
    select id,dispatch_trip_id,event_type,event_at,created_at from public.dispatch_events
    where tenant_id = _tenant_id and created_by = auth.uid()
      and event_type in ('start_shift','lunch','rest','overnight','resume','end_shift')
    order by event_at desc,created_at desc,id desc limit 100
  ) e;
  select jsonb_build_object('id',id,'event_at',event_at,'dispatch_trip_id',dispatch_trip_id)
    into v_start from public.dispatch_events
    where tenant_id = _tenant_id and created_by = auth.uid() and event_type = 'start_shift'
    order by event_at desc,created_at desc,id desc limit 1;
  select jsonb_build_object('id',id,'event_at',event_at,'dispatch_trip_id',dispatch_trip_id)
    into v_end from public.dispatch_events
    where tenant_id = _tenant_id and created_by = auth.uid() and event_type = 'end_shift'
    order by event_at desc,created_at desc,id desc limit 1;
  return jsonb_build_object('events',v_events,'last_start',v_start,'last_end',v_end);
end;
$function$;
revoke all on function public.driver_get_journey_context(uuid) from public, anon, authenticated, service_role;
grant execute on function public.driver_get_journey_context(uuid) to authenticated;

create or replace function public.driver_create_event(
  _trip_id uuid,
  _event_type text,
  _payload jsonb default '{}'::jsonb,
  _stop_id uuid default null,
  _notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_trip public.dispatch_trips%rowtype;
  v_event_id uuid;
  v_previous_event text;
  v_previous_event_at timestamptz;
  v_previous_event_id uuid;
  v_latest_personal_at timestamptz;
  v_shift_start_id uuid;
  v_checklist_after timestamptz;
  v_existing public.dispatch_events%rowtype;
  v_request_id text;
  v_checklist_payload jsonb;
  v_expected_items integer;
  v_checked_items integer;
  v_is_journey boolean;
begin
  select * into v_trip from public._lock_driver_journey_trip(_trip_id);

  if _event_type is null or length(trim(_event_type)) = 0 or length(_event_type) > 80 then
    raise exception 'Tipo de evento inválido' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'Dados do evento devem ser um objeto' using errcode = '22023';
  end if;

  if pg_catalog.octet_length(coalesce(_payload, '{}'::jsonb)::text) > 131072 then
    raise exception 'Dados do evento excedem o limite permitido' using errcode = '22023';
  end if;

  if length(coalesce(_notes, '')) > 2000 then
    raise exception 'Observação excede o limite permitido' using errcode = '22023';
  end if;

  if _stop_id is not null and not exists (
    select 1
    from public.dispatch_stops as stop
    where stop.id = _stop_id
      and stop.dispatch_trip_id = v_trip.id
      and stop.tenant_id = v_trip.tenant_id
  ) then
    raise exception 'Parada não pertence à viagem' using errcode = '42501';
  end if;

  v_is_journey := _event_type in (
    'start_shift', 'lunch', 'rest', 'overnight', 'resume', 'end_shift'
  );

  if not v_is_journey
    and _event_type <> 'operational_note'
    and _event_type !~ '^info_[a-z0-9_]{1,64}$' then
    raise exception 'Tipo de evento não permitido no aplicativo do motorista'
      using errcode = '22023';
  end if;

  if v_is_journey then
    if _stop_id is not null then
      raise exception 'Evento de jornada não pode ser vinculado a uma parada'
        using errcode = '22023';
    end if;

    v_request_id := _payload ->> 'client_event_id';
    if v_request_id is not null then
      if v_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'Identificador do evento inválido' using errcode = '22023';
      end if;
      select * into v_existing from public.dispatch_events e
      where e.tenant_id = v_trip.tenant_id and e.created_by = auth.uid()
        and e.event_type in ('start_shift','lunch','rest','overnight','resume','end_shift')
        and e.payload ->> 'client_event_id' = v_request_id
      order by e.event_at,e.created_at,e.id limit 1;
      if found then
        if v_existing.event_type <> _event_type or v_existing.dispatch_trip_id <> _trip_id
          or v_existing.notes is distinct from nullif(trim(_notes),'')
          or (v_existing.payload - array['journey_previous_event','journey_previous_event_id','journey_driver_id'])
            is distinct from (coalesce(_payload,'{}'::jsonb) - array['journey_previous_event','journey_previous_event_id','journey_driver_id']) then
          raise exception 'Identificador reutilizado para outro evento' using errcode = '23505';
        end if;
        return v_existing.id;
      end if;
    end if;

    select event.event_type, event.event_at, event.id
      into v_previous_event, v_previous_event_at, v_previous_event_id
    from public.dispatch_events as event
    where event.tenant_id = v_trip.tenant_id and event.created_by = auth.uid()
      and event.event_type in (
        'start_shift', 'lunch', 'rest', 'overnight', 'resume', 'end_shift'
      )
    order by event.event_at desc, event.created_at desc, event.id desc
    limit 1;

    if coalesce(_payload,'{}'::jsonb) ? 'expected_previous_event_id'
      and (_payload ->> 'expected_previous_event_id') is distinct from v_previous_event_id::text then
      raise exception 'A jornada mudou em outro dispositivo. Atualize antes de registrar.' using errcode = '40001';
    end if;

    if not coalesce((
      ((v_previous_event is null or v_previous_event = 'end_shift') and _event_type = 'start_shift')
      or (v_previous_event in ('start_shift', 'resume')
          and _event_type in ('lunch', 'rest', 'overnight', 'end_shift'))
      or (v_previous_event in ('lunch', 'rest', 'overnight') and _event_type = 'resume')
    ), false) then
      raise exception 'Sequência de jornada inválida após %', coalesce(v_previous_event, 'nenhum evento')
        using errcode = '23514';
    end if;

    if _event_type = 'start_shift' and v_trip.status = 'completed' then
      raise exception 'Selecione uma viagem ativa para iniciar outro turno' using errcode = '23514';
    end if;

    select event.id, event.event_at into v_shift_start_id, v_checklist_after
    from public.dispatch_events event
    where event.tenant_id = v_trip.tenant_id and event.created_by = auth.uid()
      and event.event_type = case when _event_type = 'start_shift' then 'end_shift' else 'start_shift' end
    order by event.event_at desc,event.created_at desc,event.id desc limit 1;

    if _event_type in ('start_shift', 'end_shift') then
      v_expected_items := case _event_type when 'start_shift' then 8 else 5 end;

      select event.payload
        into v_checklist_payload
      from public.dispatch_events as event
      where event.dispatch_trip_id = v_trip.id
        and event.tenant_id = v_trip.tenant_id and event.created_by = auth.uid()
        and (v_checklist_after is null or event.event_at > v_checklist_after)
        and event.event_type = case
          when _event_type = 'start_shift' then 'checklist_pre'
          else 'checklist_post'
        end
      order by event.event_at desc, event.created_at desc, event.id desc
      limit 1;

      if jsonb_typeof(v_checklist_payload -> 'checked_items') = 'array'
        and jsonb_array_length(v_checklist_payload -> 'checked_items') = v_expected_items then
        select count(distinct item.value)
          into v_checked_items
        from jsonb_array_elements(v_checklist_payload -> 'checked_items') as item(value)
        where case when jsonb_typeof(item.value) = 'number' and item.value::text ~ '^[0-7]$'
          then item.value::text::integer between 0 and v_expected_items - 1
          else false end;
      else
        v_checked_items := 0;
      end if;

      if coalesce(v_checked_items, 0) <> v_expected_items then
        raise exception '% obrigatório antes deste evento',
          case _event_type
            when 'start_shift' then 'Checklist pré-viagem'
            else 'Checklist pós-viagem'
          end
          using errcode = '23514';
      end if;
      if _event_type = 'end_shift' and v_checklist_after is null then
        raise exception 'Início do turno não localizado. Solicite revisão à operação.' using errcode = '23514';
      end if;
    end if;
  end if;

  select max(event_at) into v_latest_personal_at from public.dispatch_events
  where tenant_id = v_trip.tenant_id and created_by = auth.uid()
    and event_type in ('start_shift','lunch','rest','overnight','resume','end_shift','checklist_pre','checklist_post');

  insert into public.dispatch_events(
    tenant_id,
    dispatch_trip_id,
    dispatch_stop_id,
    event_type,
    payload,
    notes,
    created_by,
    event_at
  ) values (
    v_trip.tenant_id,
    v_trip.id,
    _stop_id,
    _event_type,
    coalesce(_payload, '{}'::jsonb) || case
      when v_is_journey then jsonb_build_object('journey_previous_event', v_previous_event,
        'journey_previous_event_id',v_previous_event_id,'journey_driver_id',v_trip.driver_id)
      else '{}'::jsonb
    end,
    nullif(trim(_notes), ''),
    auth.uid(),
    greatest(clock_timestamp(), v_latest_personal_at + interval '1 microsecond')
  )
  returning id into v_event_id;

  return v_event_id;
end;
$function$;

revoke all privileges
  on function public.driver_create_event(uuid, text, jsonb, uuid, text)
  from public, anon, authenticated, service_role;
grant execute
  on function public.driver_create_event(uuid, text, jsonb, uuid, text)
  to authenticated, service_role;

comment on function public.driver_create_event(uuid, text, jsonb, uuid, text) is
  'Creates allowlisted driver events and enforces the journey state machine atomically.';

create or replace function public.driver_save_checklist(_trip_id uuid, _kind text, _payload jsonb)
returns uuid
language plpgsql security definer set search_path = ''
as $function$
declare
  v_trip public.dispatch_trips%rowtype; v_total integer; v_type text;
  v_checked jsonb; v_count integer; v_unique integer; v_id uuid;
  v_last_id uuid; v_after timestamptz; v_last_at timestamptz; v_boundary_id uuid;
begin
  select * into v_trip from public._lock_driver_journey_trip(_trip_id);
  if _kind is null or _kind not in ('pre','post') then raise exception 'invalid_kind' using errcode = '22023'; end if;
  v_total := case _kind when 'pre' then 8 else 5 end;
  v_type := 'checklist_' || _kind;
  if _payload is null or jsonb_typeof(_payload) <> 'object'
    or jsonb_typeof(_payload -> 'checked_items') is distinct from 'array'
    or pg_catalog.octet_length(_payload::text) > 131072 then
    raise exception 'Checklist inválido' using errcode = '22023';
  end if;
  if _payload ? 'total_items' and _payload -> 'total_items' is distinct from to_jsonb(v_total) then
    raise exception 'Quantidade de itens inválida' using errcode = '22023';
  end if;
  select count(*),count(distinct value),coalesce(jsonb_agg(value order by value),'[]'::jsonb)
  into v_count,v_unique,v_checked from jsonb_array_elements(_payload -> 'checked_items') item
  where case when jsonb_typeof(value) = 'number' and value::text ~ '^[0-7]$'
    then value::text::integer between 0 and v_total - 1 else false end;
  if v_count <> jsonb_array_length(_payload -> 'checked_items') or v_count <> v_unique then
    raise exception 'Itens inválidos ou duplicados no checklist' using errcode = '22023';
  end if;

  select id,event_at into v_boundary_id,v_after from public.dispatch_events
  where tenant_id = v_trip.tenant_id and created_by = auth.uid()
    and event_type = case _kind when 'pre' then 'end_shift' else 'start_shift' end
  order by event_at desc,created_at desc,id desc limit 1;
  if _payload ? 'expected_boundary_id'
    and (_payload ->> 'expected_boundary_id') is distinct from v_boundary_id::text then
    raise exception 'O turno mudou. Atualize o checklist antes de salvar.' using errcode = '40001';
  end if;
  select id into v_last_id from public.dispatch_events
  where tenant_id = v_trip.tenant_id and created_by = auth.uid()
    and dispatch_trip_id = _trip_id and event_type = v_type
    and (v_after is null or event_at > v_after)
  order by event_at desc,created_at desc,id desc limit 1;
  if _payload ? 'expected_checklist_id'
    and (_payload ->> 'expected_checklist_id') is distinct from v_last_id::text then
    raise exception 'Checklist alterado em outro dispositivo. Atualize antes de salvar.' using errcode = '40001';
  end if;
  select max(event_at) into v_last_at from public.dispatch_events
  where tenant_id = v_trip.tenant_id and created_by = auth.uid()
    and event_type in ('start_shift','lunch','rest','overnight','resume','end_shift','checklist_pre','checklist_post');
  insert into public.dispatch_events(tenant_id,dispatch_trip_id,event_type,payload,created_by,event_at)
  values(v_trip.tenant_id,_trip_id,v_type,
    _payload || jsonb_build_object('checked_items',v_checked,'total_items',v_total,'journey_driver_id',v_trip.driver_id),
    auth.uid(),greatest(clock_timestamp(),v_last_at + interval '1 microsecond')) returning id into v_id;
  return v_id;
end;
$function$;
revoke all on function public.driver_save_checklist(uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.driver_save_checklist(uuid,text,jsonb) to authenticated, service_role;
