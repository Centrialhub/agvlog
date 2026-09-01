-- Compatible two-argument API. Physical departure is not delivery confirmation.
-- Preflight and bounded locks protect against deploying over an unknown contract.
set local lock_timeout = '3s';
set local statement_timeout = '20s';
do $preflight$
begin
  if md5(replace(
        pg_get_functiondef('public.driver_register_departure(uuid,text)'::regprocedure),
        chr(13),
        ''
      ))
      is distinct from '5cc34d5bc716417299f3ab437e75a2f6' then
    raise exception 'driver_register_departure changed; recapture contract before deploying';
  end if;
end;
$preflight$;

create or replace function public.driver_register_departure(_stop_id uuid,_notes text default null)
returns uuid language plpgsql security definer set search_path = ''
as $function$
declare
  v_stop public.dispatch_stops%rowtype;
  v_trip public.dispatch_trips%rowtype;
  v_existing public.dispatch_events%rowtype;
  v_notes text := nullif(btrim(_notes),'');
  v_departure_at timestamptz;
  v_event uuid;
begin
  if auth.uid() is null then raise exception 'Não autenticado' using errcode='42501'; end if;
  if length(v_notes)>2000 then raise exception 'Observação de saída muito longa' using errcode='22023'; end if;
  select * into v_stop from public.dispatch_stops where id=_stop_id;
  if not found then raise exception 'Parada não encontrada' using errcode='P0002'; end if;
  perform public._assert_driver_owns_trip(v_stop.dispatch_trip_id);

  -- Discovery is unlocked. Acquire trip first, then revalidate ownership/stop.
  select * into v_trip from public.dispatch_trips
    where id=v_stop.dispatch_trip_id and tenant_id=v_stop.tenant_id for update;
  if not found then raise exception 'Parada fora da viagem atribuída' using errcode='42501'; end if;
  perform public._assert_driver_owns_trip(v_trip.id);
  select * into v_stop from public.dispatch_stops where id=_stop_id
    and dispatch_trip_id=v_trip.id and tenant_id=v_trip.tenant_id for update;
  if not found then raise exception 'Parada reatribuída; atualize a viagem' using errcode='40001'; end if;

  select * into v_existing from public.dispatch_events
    where tenant_id=v_trip.tenant_id and dispatch_trip_id=v_trip.id
      and dispatch_stop_id=v_stop.id and event_type='departure'
    order by event_at,id limit 1;
  if v_stop.actual_departure_at is not null then
    if v_existing.id is null then
      raise exception 'Saída já registrada por outro fluxo; consulte o histórico da entrega' using errcode='23514';
    end if;
    if nullif(btrim(v_existing.notes),'') is distinct from v_notes then
      raise exception 'Saída já registrada com outra observação; registre uma nova ocorrência' using errcode='23505';
    end if;
    return v_existing.id;
  elsif v_existing.id is not null then
    raise exception 'Evento de saída sem horário na parada; solicite revisão à operação' using errcode='23514';
  end if;

  if v_trip.status is null or v_trip.status not in('in_transit','in_progress') or v_trip.actual_start_at is null then
    raise exception 'Inicie a viagem antes de registrar a saída' using errcode='23514';
  end if;
  if v_stop.status is null or v_stop.status not in('arrived','servicing') or v_stop.actual_arrival_at is null then
    raise exception 'Registre a chegada antes da saída; a parada deve estar em atendimento' using errcode='23514';
  end if;
  v_departure_at := clock_timestamp();
  if v_stop.actual_arrival_at>v_departure_at or v_trip.actual_start_at>v_stop.actual_arrival_at then
    raise exception 'Horários da viagem/parada inconsistentes; solicite revisão à operação' using errcode='23514';
  end if;
  update public.dispatch_stops set actual_departure_at=v_departure_at,updated_at=v_departure_at where id=v_stop.id;
  insert into public.dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,payload,notes,created_by,event_at)
    values(v_trip.tenant_id,v_trip.id,v_stop.id,'departure',
      jsonb_build_object('source','driver_app','schema_version',2,'departure_at',v_departure_at),v_notes,auth.uid(),v_departure_at)
    returning id into v_event;
  perform public._log_entity_audit(v_trip.tenant_id,'dispatch_stop',v_stop.id,'departure_by_driver',
    jsonb_build_object('actual_departure_at',v_stop.actual_departure_at),
    jsonb_build_object('actual_departure_at',v_departure_at,'event_id',v_event),'driver_app');
  return v_event;
end;
$function$;
revoke all on function public.driver_register_departure(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.driver_register_departure(uuid,text) to authenticated,service_role;
comment on function public.driver_register_departure(uuid,text) is
  'Assigned driver physical departure: trip-first locks, arrival required, idempotent, no implicit delivery completion.';
