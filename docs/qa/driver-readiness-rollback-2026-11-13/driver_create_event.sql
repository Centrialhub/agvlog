CREATE OR REPLACE FUNCTION public.driver_create_event(_trip_id uuid, _event_type text, _payload jsonb DEFAULT '{}'::jsonb, _stop_id uuid DEFAULT NULL::uuid, _notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
