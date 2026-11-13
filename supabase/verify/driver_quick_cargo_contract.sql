begin;
set local statement_timeout='30s';
do $guard$ begin
 if (select count(*) from auth.users)<>7 or (select count(*) from auth.users where email like '%@agvlog-e2e.invalid')<>7 then raise exception 'isolated_seed_required';end if;
end;$guard$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","active_tenant_id":"20000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers','{"x-agvlog-tenant-id":"20000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
do $quick$
declare tenant constant uuid:='20000000-0000-4000-8000-000000000001';trip constant uuid:='80000000-0000-4000-8000-000000000001';
 request uuid:=gen_random_uuid();payload jsonb;result jsonb;again jsonb;started jsonb;
begin
 perform public.driver_save_checklist(trip,'pre','{"schema_version":2,"checklist_model":"vehicle_readiness_v1","checked_items":[0,1,2,3,4,5],"total_items":6,"answers":[true,false,true,true,true,true],"expected_checklist_id":null,"expected_boundary_id":null}'::jsonb);
 perform public.driver_update_trip_cargo_v1(tenant,trip,gen_random_uuid(),'accept','{"vehicle_id":"50000000-0000-4000-8000-000000000001"}'::jsonb);
 select jsonb_build_object('confirm_all_documents',true,'expected_updated_at',updated_at) into payload
 from public.trip_cargo_controls where tenant_id=tenant and dispatch_trip_id=trip;
 result:=public.driver_update_trip_cargo_v1(tenant,trip,request,'quick_confirm',payload);
 again:=public.driver_update_trip_cargo_v1(tenant,trip,request,'quick_confirm',payload);
 if result is distinct from again or result->>'status'<>'ready_to_depart' then raise exception 'quick_replay_failed';end if;
 begin
  perform public.driver_update_trip_cargo_v1(tenant,trip,gen_random_uuid(),'quick_confirm',payload);
  raise exception 'quick_stale_accepted';
 exception when serialization_failure then null;end;
 perform public.driver_update_trip_cargo_v1(tenant,trip,gen_random_uuid(),'mark_departed','{}'::jsonb);
 started:=public.driver_start_trip(trip);
 if started->>'status'<>'in_transit' or started->>'trip_id'<>trip::text then raise exception 'quick_start_failed';end if;
end;$quick$;
reset role;
do $verify$ begin
 if exists(select 1 from public.trip_cargo_document_checks where not driver_confirmed)
  or not exists(select 1 from public.trip_cargo_document_checks) then raise exception 'quick_notes_missing';end if;
 if exists(select 1 from public.trip_cargo_controls where vehicle_checked or tie_down_confirmed or seal_not_applicable_reason is not null)
  or exists(select 1 from public.trip_cargo_evidence) or exists(select 1 from public.trip_cargo_seals)
  or exists(select 1 from public.trip_cargo_load_checks where confirmed_weight_kg is not null or confirmed_at is not null)
  then raise exception 'quick_fabricated_evidence';end if;
 if not exists(select 1 from public.dispatch_trips where id='80000000-0000-4000-8000-000000000001' and actual_start_at is not null and status='in_transit') then raise exception 'quick_trip_not_started';end if;
end;$verify$;
rollback;
