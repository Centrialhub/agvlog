-- Disposable seven-user CI seed only. No real deliveries; always rolls back.
begin;
set local statement_timeout='20s';
do $$begin
 if (select count(*) from auth.users)<>7 or
  (select count(*) from auth.users where email like '%@agvlog-e2e.invalid')<>7 then
  raise exception 'isolated_seed_required';end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select set_config('request.headers','{"x-agvlog-tenant-id":"20000000-0000-4000-8000-000000000001"}',true);
update public.dispatch_trips set status='in_transit',actual_start_at=now()
 where id='80000000-0000-4000-8000-000000000001';
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
