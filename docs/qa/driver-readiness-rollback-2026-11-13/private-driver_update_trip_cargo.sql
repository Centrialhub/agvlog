CREATE OR REPLACE FUNCTION private.driver_update_trip_cargo(_tenant_id uuid, _trip_id uuid, _request_id uuid, _action text, _payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET extra_float_digits TO '3'
AS $function$
declare v_trip public.dispatch_trips%rowtype;v_control public.trip_cargo_controls%rowtype;v_existing public.trip_cargo_commands%rowtype;
  v_hash text;v_result jsonb;v_item jsonb;v_load public.trip_cargo_load_checks%rowtype;v_kind text;v_description text;
  v_weight numeric;v_expected numeric;v_weight_audit jsonb:='[]'::jsonb;
begin
  if _request_id is null or _action is null or jsonb_typeof(coalesce(_payload,'{}'::jsonb))<>'object'
    or pg_catalog.octet_length(coalesce(_payload,'{}'::jsonb)::text)>262144 then
    raise exception 'invalid_trip_cargo_command' using errcode='22023';end if;
  v_trip:=private.require_trip_cargo_actor(_tenant_id,_trip_id,false);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('trip_cargo:'||_tenant_id::text||':'||_trip_id::text,0));
  v_hash:=md5(_action||':'||coalesce(_payload,'{}'::jsonb)::text);
  select * into v_existing from public.trip_cargo_commands where request_id=_request_id;
  if found then
    if v_existing.tenant_id<>_tenant_id or v_existing.actor_id<>auth.uid() or v_existing.action<>_action or v_existing.payload_hash<>v_hash then
      raise exception 'trip_cargo_request_conflict' using errcode='23505';end if;
    return v_existing.result;
  end if;
  select * into v_control from public.trip_cargo_controls where tenant_id=_tenant_id and dispatch_trip_id=_trip_id for update;
  if not found then
    if _action<>'accept' then raise exception 'trip_cargo_acceptance_required' using errcode='23514';end if;
    if v_trip.vehicle_id is null or (_payload->>'vehicle_id') is distinct from v_trip.vehicle_id::text then
      raise exception 'trip_cargo_vehicle_mismatch' using errcode='23514';end if;
    if v_trip.status not in('planned','loading','dispatched') then raise exception 'trip_cargo_acceptance_closed' using errcode='23514';end if;
    insert into public.trip_cargo_controls(tenant_id,dispatch_trip_id,driver_id,vehicle_id,status,accepted_at,accepted_by)
      values(_tenant_id,_trip_id,v_trip.driver_id,v_trip.vehicle_id,'accepted',clock_timestamp(),auth.uid()) returning * into v_control;
    perform private.sync_trip_cargo_expected(v_control.id);
  elsif v_control.driver_id<>v_trip.driver_id or v_control.vehicle_id<>v_trip.vehicle_id then
    raise exception 'trip_cargo_assignment_changed' using errcode='23514';
  elsif _action='accept' and v_control.status='pending_acceptance' then
    update public.trip_cargo_controls set status='accepted',accepted_at=clock_timestamp(),accepted_by=auth.uid(),updated_at=clock_timestamp()
      where id=v_control.id returning * into v_control;
  elsif _action='start_loading' then
    if v_control.status not in('accepted','loading') then raise exception 'trip_cargo_invalid_state' using errcode='23514';end if;
    update public.trip_cargo_controls set status='loading',loading_started_at=coalesce(loading_started_at,clock_timestamp()),
      loading_started_by=coalesce(loading_started_by,auth.uid()),updated_at=clock_timestamp() where id=v_control.id returning * into v_control;
  elsif _action='confirm_cargo' then
    if v_control.status not in('accepted','loading','ready_to_depart') then raise exception 'trip_cargo_invalid_state' using errcode='23514';end if;
    if jsonb_typeof(_payload->'loads')<>'array' or jsonb_array_length(_payload->'loads')<>(select count(*) from public.trip_cargo_load_checks where control_id=v_control.id)
      or not coalesce((_payload->>'vehicle_checked')::boolean,false) or not coalesce((_payload->>'tie_down_confirmed')::boolean,false) then
      raise exception 'trip_cargo_confirmation_incomplete' using errcode='23514';end if;
    update public.trip_cargo_document_checks set driver_confirmed=false,confirmed_at=null,confirmed_by=null,updated_at=clock_timestamp() where control_id=v_control.id;
    update public.trip_cargo_load_checks set confirmed_volume_count=null,confirmed_pallet_count=null,
      confirmed_weight_kg=null,confirmed_at=null,confirmed_by=null,updated_at=clock_timestamp() where control_id=v_control.id;
    for v_item in select value from jsonb_array_elements(_payload->'documents') loop
      update public.trip_cargo_document_checks set driver_confirmed=true,confirmed_at=clock_timestamp(),confirmed_by=auth.uid(),updated_at=clock_timestamp()
      where control_id=v_control.id and id=(v_item#>>'{}')::uuid;
      if not found then raise exception 'trip_cargo_document_outside_trip' using errcode='23514';end if;
    end loop;
    if exists(select 1 from public.trip_cargo_document_checks where control_id=v_control.id and not driver_confirmed) then
      raise exception 'trip_cargo_documents_incomplete' using errcode='23514';end if;
    for v_item in select value from jsonb_array_elements(_payload->'loads') loop
      select * into v_load from public.trip_cargo_load_checks where control_id=v_control.id and load_id=(v_item->>'load_id')::uuid for update;
      if not found or v_item->'volume_count' is null or v_item->'pallet_count' is null or v_item->'weight_kg' is null
        or (v_item->>'volume_count')::numeric<0 or (v_item->>'pallet_count')::integer<0 or (v_item->>'weight_kg')::numeric<0 then
        raise exception 'trip_cargo_load_confirmation_invalid' using errcode='22023';end if;
      -- Manual confirmations have centesimal precision. Preserve the raw source snapshot.
      if jsonb_typeof(v_item->'weight_kg') is distinct from 'number' then
        raise exception 'trip_cargo_weight_invalid' using errcode='22023';end if;
      v_weight:=(v_item->>'weight_kg')::numeric;
      if v_weight<0 or v_weight::text in('NaN','Infinity','-Infinity')
        or v_weight*100>9007199254740991 then
        raise exception 'trip_cargo_weight_invalid' using errcode='22023';end if;
      if v_weight<>pg_catalog.round(v_weight,2) then
        raise exception 'trip_cargo_weight_precision_required' using errcode='22023';end if;
      if v_weight<>v_weight::double precision::text::numeric then
        raise exception 'trip_cargo_weight_invalid' using errcode='22023';end if;
      if coalesce(v_load.expected_weight_kg,0)::text in('NaN','Infinity','-Infinity') then
        raise exception 'trip_cargo_expected_weight_invalid' using errcode='22023';end if;
      -- Match String(Number(source)) before decimal half-up. Float output is scoped to this function.
      begin
        v_expected:=coalesce(v_load.expected_weight_kg,0)::double precision::text::numeric;
      exception when numeric_value_out_of_range then
        if coalesce(v_load.expected_weight_kg,0)>=0 and coalesce(v_load.expected_weight_kg,0)<1e-308 then v_expected:=0;
        else raise exception 'trip_cargo_expected_weight_invalid' using errcode='22023';end if;
      end;
      if v_expected<0 or pg_catalog.round(v_expected,2)*100>9007199254740991 then
        raise exception 'trip_cargo_expected_weight_invalid' using errcode='22023';end if;
      v_weight_audit:=v_weight_audit||jsonb_build_array(jsonb_build_object(
        'load_id',v_load.load_id,'expected_raw_kg',v_load.expected_weight_kg::text,
        'expected_received_decimal_kg',v_expected::text,'expected_rounded_kg',pg_catalog.round(v_expected,2)::text,
        'confirmed_input_kg',v_item->>'weight_kg','confirmed_kg',pg_catalog.round(v_weight,2)::text,
        'expected_rounded',coalesce(v_load.expected_weight_kg,0)<>pg_catalog.round(v_expected,2)));
      update public.trip_cargo_load_checks set confirmed_volume_count=(v_item->>'volume_count')::numeric,
        confirmed_pallet_count=(v_item->>'pallet_count')::integer,confirmed_weight_kg=pg_catalog.round(v_weight,2),
        confirmed_at=clock_timestamp(),confirmed_by=auth.uid(),updated_at=clock_timestamp() where id=v_load.id;
      if coalesce(v_load.expected_volume_count,0)<>(v_item->>'volume_count')::numeric then
        insert into public.trip_cargo_divergences(tenant_id,control_id,load_id,divergence_kind,description,expected_value,observed_value,reported_by)
          values(_tenant_id,v_control.id,v_load.load_id,'volume','Quantidade de volumes divergente da carga planejada',v_load.expected_volume_count::text,v_item->>'volume_count',auth.uid());end if;
      if coalesce(v_load.expected_pallet_count,0)<>(v_item->>'pallet_count')::integer then
        insert into public.trip_cargo_divergences(tenant_id,control_id,load_id,divergence_kind,description,expected_value,observed_value,reported_by)
          values(_tenant_id,v_control.id,v_load.load_id,'pallet','Quantidade de pallets divergente da carga planejada',v_load.expected_pallet_count::text,v_item->>'pallet_count',auth.uid());end if;
      if abs(pg_catalog.round(v_expected,2)-v_weight)>1 then
        insert into public.trip_cargo_divergences(tenant_id,control_id,load_id,divergence_kind,description,expected_value,observed_value,reported_by)
          values(_tenant_id,v_control.id,v_load.load_id,'weight','Peso divergente da carga planejada',v_load.expected_weight_kg::text,v_item->>'weight_kg',auth.uid());end if;
    end loop;
    if exists(select 1 from public.trip_cargo_load_checks where control_id=v_control.id and confirmed_at is null) then
      raise exception 'trip_cargo_loads_incomplete' using errcode='23514';end if;
    if jsonb_typeof(coalesce(_payload->'divergences','[]'::jsonb))<>'array' then raise exception 'trip_cargo_divergences_invalid' using errcode='22023';end if;
    for v_item in select value from jsonb_array_elements(coalesce(_payload->'divergences','[]'::jsonb)) loop
      v_kind:=v_item->>'kind';v_description:=btrim(v_item->>'description');
      if v_kind not in('document','seal','damage','shortage','surplus','other') or length(v_description)<5 then
        raise exception 'trip_cargo_divergence_invalid' using errcode='22023';end if;
      insert into public.trip_cargo_divergences(tenant_id,control_id,load_id,divergence_kind,description,observed_value,reported_by)
        values(_tenant_id,v_control.id,nullif(v_item->>'load_id','')::uuid,v_kind,v_description,nullif(v_item->>'observed_value',''),auth.uid());
    end loop;
    if jsonb_typeof(coalesce(_payload->'seals','[]'::jsonb))<>'array' then raise exception 'trip_cargo_seals_invalid' using errcode='22023';end if;
    for v_item in select value from jsonb_array_elements(coalesce(_payload->'seals','[]'::jsonb)) loop
      insert into public.trip_cargo_seals(tenant_id,control_id,seal_number,installed_by)
        values(_tenant_id,v_control.id,btrim(v_item#>>'{}'),auth.uid()) on conflict(control_id,seal_number) do nothing;
    end loop;
    if not exists(select 1 from public.trip_cargo_seals where control_id=v_control.id)
      and length(btrim(coalesce(_payload->>'seal_not_applicable_reason','')))<5 then
      raise exception 'trip_cargo_seal_confirmation_required' using errcode='23514';end if;
    if jsonb_typeof(coalesce(_payload->'evidence','[]'::jsonb))<>'array' then raise exception 'trip_cargo_evidence_invalid' using errcode='22023';end if;
    for v_item in select value from jsonb_array_elements(coalesce(_payload->'evidence','[]'::jsonb)) loop
      if v_item->>'kind' not in('loading','tie_down','seal','damage','shortage','surplus','other')
        or (v_item->>'path') not like _tenant_id::text||'/trip-cargo/'||_trip_id::text||'/%' then
        raise exception 'trip_cargo_evidence_invalid' using errcode='22023';end if;
      insert into public.trip_cargo_evidence(tenant_id,control_id,evidence_kind,storage_path,created_by)
        values(_tenant_id,v_control.id,v_item->>'kind',v_item->>'path',auth.uid()) on conflict(control_id,storage_path) do nothing;
    end loop;
    if not exists(select 1 from public.trip_cargo_evidence where control_id=v_control.id and evidence_kind='loading')
      or not exists(select 1 from public.trip_cargo_evidence where control_id=v_control.id and evidence_kind='tie_down') then
      raise exception 'trip_cargo_loading_photos_required' using errcode='23514';end if;
    if exists(select 1 from public.trip_cargo_divergences divergence where divergence.control_id=v_control.id
      and divergence.status='pending' and divergence.divergence_kind in('damage','shortage','surplus')
      and not exists(select 1 from public.trip_cargo_evidence proof where proof.control_id=v_control.id
        and proof.evidence_kind=divergence.divergence_kind)) then
      raise exception 'trip_cargo_divergence_photo_required' using errcode='23514';end if;
    update public.trip_cargo_controls set vehicle_checked=true,tie_down_confirmed=true,
      seal_not_applicable_reason=nullif(btrim(_payload->>'seal_not_applicable_reason'),''),
      cargo_confirmed_at=clock_timestamp(),cargo_confirmed_by=auth.uid(),
      status=case when exists(select 1 from public.trip_cargo_divergences where control_id=v_control.id and status in('pending','rejected')) then 'loading' else 'ready_to_depart' end,
      updated_at=clock_timestamp() where id=v_control.id returning * into v_control;
  elsif _action='mark_departed' then
    if v_control.status not in('ready_to_depart','departed') then raise exception 'trip_cargo_departure_blocked' using errcode='23514';end if;
    if not exists(select 1 from public.dispatch_events event where event.tenant_id=_tenant_id
      and event.dispatch_trip_id=_trip_id and event.created_by=auth.uid() and event.event_type='checklist_pre'
      and jsonb_typeof(event.payload->'checked_items')='array' and jsonb_array_length(event.payload->'checked_items')=8
      and event.event_at>coalesce((select max(boundary.event_at) from public.dispatch_events boundary
        where boundary.tenant_id=_tenant_id and boundary.created_by=auth.uid() and boundary.event_type='end_shift'),'-infinity'::timestamptz)) then
      raise exception 'trip_cargo_pre_checklist_required' using errcode='23514';end if;
    update public.trip_cargo_controls set status='departed',departed_at=coalesce(departed_at,clock_timestamp()),
      departed_by=coalesce(departed_by,auth.uid()),updated_at=clock_timestamp() where id=v_control.id returning * into v_control;
  elsif _action='mark_returned' then
    if v_control.status not in('departed','returned') then raise exception 'trip_cargo_return_blocked' using errcode='23514';end if;
    if exists(select 1 from public.dispatch_stops stop where stop.tenant_id=_tenant_id and stop.dispatch_trip_id=_trip_id
      and stop.status not in('delivered','completed','partial_delivery','returned','refused','failed','cancelled','skipped')) then
      raise exception 'trip_cargo_stops_pending' using errcode='23514';end if;
    if not exists(select 1 from public.dispatch_events event where event.tenant_id=_tenant_id
      and event.dispatch_trip_id=_trip_id and event.created_by=auth.uid() and event.event_type='checklist_post'
      and jsonb_typeof(event.payload->'checked_items')='array' and jsonb_array_length(event.payload->'checked_items')=5
      and event.event_at>coalesce((select max(boundary.event_at) from public.dispatch_events boundary
        where boundary.tenant_id=_tenant_id and boundary.created_by=auth.uid() and boundary.event_type='start_shift'),'-infinity'::timestamptz)) then
      raise exception 'trip_cargo_post_checklist_required' using errcode='23514';end if;
    update public.trip_cargo_controls set status='returned',returned_at=coalesce(returned_at,clock_timestamp()),
      returned_by=coalesce(returned_by,auth.uid()),updated_at=clock_timestamp() where id=v_control.id returning * into v_control;
  else
    raise exception 'trip_cargo_action_invalid' using errcode='22023';
  end if;
  v_result:=jsonb_build_object('version',1,'confirmed',true,'request_id',_request_id,'trip_id',_trip_id,
    'control_id',v_control.id,'status',v_control.status,'updated_at',v_control.updated_at);
  insert into public.trip_cargo_commands(request_id,tenant_id,control_id,actor_id,action,payload_hash,result)
    values(_request_id,_tenant_id,v_control.id,auth.uid(),_action,v_hash,v_result);
  perform public._log_entity_audit(_tenant_id,'trip_cargo_control',v_control.id,_action,null,
    case when _action='confirm_cargo' then v_result||jsonb_build_object('weight_precision',
      jsonb_build_object('unit','kg','decimal_places',2,'rounding','decimal_half_up','loads',v_weight_audit))
    else v_result end,'driver_app');
  return v_result;
end;$function$
