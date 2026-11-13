set local lock_timeout='5s';
set local statement_timeout='60s';
do $patch$
declare definition text;source_hash text;
begin
 select pg_get_functiondef(oid),md5(prosrc) into definition,source_hash
 from pg_proc where oid='private.driver_update_trip_cargo(uuid,uuid,uuid,text,jsonb)'::regprocedure;
 if position('_action=''quick_confirm''' in definition)>0 then
   raise exception 'quick_cargo_already_present';
 end if;
 if source_hash<>'839353a24ef5a3303f7ab6ab6b380831' then raise exception 'quick_cargo_source_changed';end if;
 definition:=replace(definition,$old$  elsif _action='confirm_cargo' then$old$,$new$  elsif _action='quick_confirm' then
    if v_control.status not in('accepted','loading','ready_to_depart')
      or v_trip.status not in('planned','loading','dispatched') then
      raise exception 'trip_cargo_invalid_state' using errcode='23514';end if;
    if (_payload->>'expected_updated_at')::timestamptz is distinct from v_control.updated_at then
      raise exception 'trip_cargo_refresh_required' using errcode='40001';end if;
    if _payload->'confirm_all_documents' is distinct from 'true'::jsonb then
      raise exception 'trip_cargo_confirmation_incomplete' using errcode='22023';end if;
    perform 1 from public.dispatch_trips where id=_trip_id and tenant_id=_tenant_id for update;
    v_trip:=private.require_trip_cargo_actor(_tenant_id,_trip_id,false);
    if v_trip.status not in('planned','loading','dispatched') then
      raise exception 'trip_cargo_invalid_state' using errcode='23514';end if;
    if v_control.driver_id<>v_trip.driver_id or v_control.vehicle_id<>v_trip.vehicle_id then
      raise exception 'trip_cargo_assignment_changed' using errcode='23514';end if;
    perform 1 from public.dispatch_trip_loads where dispatch_trip_id=_trip_id order by load_id,id for update;
    perform private.sync_trip_cargo_expected(v_control.id);
    if (select coalesce(array_agg(load_id order by load_id),array[]::uuid[]) from public.trip_cargo_load_checks where control_id=v_control.id)
      is distinct from (select coalesce(array_agg(load_id order by load_id),array[]::uuid[]) from public.dispatch_trip_loads
        where dispatch_trip_id=_trip_id and tenant_id=_tenant_id) then
      raise exception 'trip_cargo_refresh_required' using errcode='40001';end if;
    if not exists(select 1 from public.trip_cargo_document_checks where control_id=v_control.id)
      or not exists(select 1 from public.trip_cargo_load_checks where control_id=v_control.id) then
      raise exception 'trip_cargo_documents_missing' using errcode='23514';end if;
    update public.trip_cargo_document_checks set driver_confirmed=true,confirmed_at=clock_timestamp(),
      confirmed_by=auth.uid(),updated_at=clock_timestamp() where control_id=v_control.id;
    -- Explicit bulk document conference. Do not fabricate physical measurements, safety checks or evidence.
    update public.trip_cargo_controls set cargo_confirmed_at=clock_timestamp(),cargo_confirmed_by=auth.uid(),
      status='ready_to_depart',updated_at=clock_timestamp() where id=v_control.id returning * into v_control;
  elsif _action='confirm_cargo' then$new$);
 definition:=replace(definition,$old$  insert into public.trip_cargo_commands(request_id,tenant_id,control_id,actor_id,action,payload_hash,result)$old$,$new$  if _action='quick_confirm' then
    v_result:=v_result||jsonb_build_object('confirmation_mode','quick','physical_checks_required',false,
      'documents_confirmed',(select count(*) from public.trip_cargo_document_checks where control_id=v_control.id),
      'document_check_ids',(select jsonb_agg(id order by id) from public.trip_cargo_document_checks where control_id=v_control.id));
  end if;
  insert into public.trip_cargo_commands(request_id,tenant_id,control_id,actor_id,action,payload_hash,result)$new$);
 execute definition;
end;
$patch$;
