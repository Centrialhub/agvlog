-- Disposable seven-user CI seed only. No real deliveries; always rolls back.
begin;
set local statement_timeout='20s';
do $$begin
 if (select count(*) from auth.users)<>7 or
  (select count(*) from auth.users where email like '%@agvlog-e2e.invalid')<>7 then
  raise exception 'isolated_seed_required';end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","active_tenant_id":"20000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers','{"x-agvlog-tenant-id":"20000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
do $start$ declare t constant uuid:='80000000-0000-4000-8000-000000000001';payload jsonb;begin
 perform public.driver_save_checklist(t,'pre','{"schema_version":2,"checklist_model":"vehicle_readiness_v1","checked_items":[0,1,2,3,4,5],"total_items":6,"answers":[true,true,true,true,true,true],"expected_checklist_id":null,"expected_boundary_id":null}'::jsonb);
 perform public.driver_update_trip_cargo_v1('20000000-0000-4000-8000-000000000001',t,gen_random_uuid(),'accept','{"vehicle_id":"50000000-0000-4000-8000-000000000001"}'::jsonb);
 select jsonb_build_object('confirm_all_documents',true,'expected_updated_at',updated_at) into payload from public.trip_cargo_controls where dispatch_trip_id=t;
 perform public.driver_update_trip_cargo_v1('20000000-0000-4000-8000-000000000001',t,gen_random_uuid(),'quick_confirm',payload);
 perform public.driver_update_trip_cargo_v1('20000000-0000-4000-8000-000000000001',t,gen_random_uuid(),'mark_departed','{}'::jsonb);
 perform public.driver_start_trip(t);
end;$start$;
reset role;
update public.dispatch_stops set status='pending',actual_arrival_at=null,latitude=null,longitude=null
 where id='82000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$declare s constant uuid:='82000000-0000-4000-8000-000000000001';a uuid;b uuid;p jsonb;
begin
 begin
  perform public.driver_mark_arrival(s,-15.802,-43.313,151);
  raise exception 'invalid_gps_accepted';
 exception when invalid_parameter_value then null;end;
 a:=public.driver_mark_arrival(s,-15.802,-43.313,20);
 b:=public.driver_mark_arrival(s,-15.802,-43.313,20);
 if a is distinct from b then raise exception 'arrival_replay_not_idempotent';end if;
 select payload into p from public.dispatch_events where id=a;
 if p->>'location_verification'<>'driver_gps_unverified_destination'
  or p->'geofence_verified' is distinct from 'false'::jsonb then
  raise exception 'unmapped_arrival_not_audited';end if;
 if not exists(select 1 from public.dispatch_stops where id=s and status='arrived'
  and actual_arrival_at is not null and latitude is null and longitude is null) then
  raise exception 'arrival_missing_or_destination_fabricated';end if;
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
 begin
  perform public.driver_mark_arrival(s,-15.802,-43.313,20);
  raise exception 'non_driver_arrival_accepted';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.dispatch_stops set status='pending',actual_arrival_at=null,latitude=-15.802,longitude=-43.313
 where id='82000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
set local role authenticated;
do $$begin
 begin
  perform public.driver_mark_arrival('82000000-0000-4000-8000-000000000001',-20,-47,20);
  raise exception 'mapped_geofence_bypassed';
 exception when check_violation then null;end;
end $$;
rollback;
