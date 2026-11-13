-- Seven-user isolated seed only; every fixture/event/receipt is rolled back.
begin;
set local statement_timeout='30s';
do $guard$
begin
 if (select count(*) from auth.users)<>7 or (select count(*) from auth.users where email like '%@agvlog-e2e.invalid')<>7 then raise exception 'isolated_seed_required';end if;
 if has_function_privilege('anon','public.driver_save_checklist(uuid,text,jsonb)','execute')
  or has_function_privilege('authenticated','private.driver_pre_checklist_complete_v2(jsonb)','execute') then raise exception 'readiness_acl_changed';end if;
end;$guard$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","active_tenant_id":"20000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers','{"x-agvlog-tenant-id":"20000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
do $readiness$
declare request uuid:=gen_random_uuid();result jsonb;again jsonb;event_id uuid;payload jsonb;
 trip constant uuid:='80000000-0000-4000-8000-000000000001';tenant constant uuid:='20000000-0000-4000-8000-000000000001';
begin
 payload:=jsonb_build_object('trip_id',trip,'kind','pre','checklist_payload',jsonb_build_object('schema_version',2,
  'checklist_model','vehicle_readiness_v1','checked_items','[0,1,2,3,4,5]'::jsonb,'total_items',6,
  'answers','[true,false,true,true,true,true]'::jsonb,'has_vehicle_issues',false,'expected_checklist_id',null,'expected_boundary_id',null));
 result:=public.driver_apply_offline_command_v1(tenant,request,'checklist',payload);
 again:=public.driver_apply_offline_command_v1(tenant,request,'checklist',payload);
 if again->'replayed' is distinct from 'true'::jsonb or result->>'entity_id' is distinct from again->>'entity_id' then raise exception 'readiness_replay_failed';end if;
 event_id:=(result->>'entity_id')::uuid;
 if not exists(select 1 from public.dispatch_events event where event.id=event_id and event.payload->'answers'='[true,false,true,true,true,true]'::jsonb
  and event.payload->'has_vehicle_issues'='true'::jsonb and event.payload->'checked_items'='[0,1,2,3,4,5]'::jsonb) then raise exception 'readiness_answers_not_preserved';end if;
 if exists(select 1 from public.dispatch_events where dispatch_trip_id=trip and event_type='start_shift') then raise exception 'checklist_started_shift';end if;
 begin
  perform public.driver_apply_offline_command_v1(tenant,gen_random_uuid(),'checklist',payload);
  raise exception 'stale_readiness_accepted';
 exception when serialization_failure then null;end;
 perform public.driver_create_event(trip,'start_shift','{}'::jsonb);
 perform public.driver_update_trip_cargo_v1(tenant,trip,gen_random_uuid(),'accept',jsonb_build_object('vehicle_id','50000000-0000-4000-8000-000000000001'));
end;$readiness$;
reset role;
-- Fixture represents a cargo already checked; the full proof workflow is exercised by the cargo SQL suite.
update public.trip_cargo_controls set status='ready_to_depart',vehicle_checked=true,tie_down_confirmed=true,
 seal_not_applicable_reason='Synthetic vehicle without seal mount' where dispatch_trip_id='80000000-0000-4000-8000-000000000001';
set local role authenticated;
select public.driver_update_trip_cargo_v1('20000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001',gen_random_uuid(),'mark_departed','{}'::jsonb);
reset role;
do $verify$ begin
 if not exists(select 1 from public.trip_cargo_controls where dispatch_trip_id='80000000-0000-4000-8000-000000000001' and status='departed') then raise exception 'readiness_departure_failed';end if;
end;$verify$;
rollback;
