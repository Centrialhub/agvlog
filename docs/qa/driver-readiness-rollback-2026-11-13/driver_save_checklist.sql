CREATE OR REPLACE FUNCTION public.driver_save_checklist(_trip_id uuid, _kind text, _payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
