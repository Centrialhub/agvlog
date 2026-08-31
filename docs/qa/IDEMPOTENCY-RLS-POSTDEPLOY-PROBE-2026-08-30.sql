-- Bounded production QA. Uses existing tenants/operator identity, only inserts
-- synthetic idempotency rows, returns counts/booleans, and always rolls back.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $probe$
declare
  v_actor uuid;v_tenant uuid;v_other uuid;v_trip uuid;v_driver uuid;v_vehicle uuid;v_load uuid;
  v_visible int;v_foreign int;v_unsigned int;v_service int;v_anon_denied boolean:=false;
  v_first uuid;v_second uuid;v_payload_hash text;v_before text;v_after text;
begin
  if exists(select 1 from pg_trigger where tgrelid='public.idempotency_keys'::regclass and not tgisinternal)
    or exists(select 1 from public.idempotency_keys where key_value like 'qa-rls-20260830-post-%') then
    raise exception 'Unexpected idempotency QA target state';
  end if;
  select m.user_id,m.tenant_id,t.id into v_actor,v_tenant,v_other
  from public.tenant_memberships m join public.profiles p on p.id=m.user_id
  join public.tenants t on t.id<>m.tenant_id
  where m.active and m.role::text in('owner','admin','operator')
    and not exists(select 1 from public.tenant_memberships x where x.user_id=m.user_id and x.tenant_id=t.id and x.active)
    and exists(select 1 from public.dispatch_trips dt where dt.tenant_id=m.tenant_id)
    and exists(select 1 from public.loads l where l.tenant_id=m.tenant_id)
  order by m.tenant_id,m.user_id limit 1;
  if v_actor is null then raise exception 'No isolated operator identity available';end if;
  select id,driver_id,vehicle_id into v_trip,v_driver,v_vehicle from public.dispatch_trips where tenant_id=v_tenant order by id limit 1;
  select id into v_load from public.loads where tenant_id=v_tenant order by id limit 1;
  select md5(jsonb_build_object(
    'trips',(select jsonb_agg(to_jsonb(t) order by id) from public.dispatch_trips t where tenant_id=v_tenant),
    'loads',(select jsonb_agg(to_jsonb(l) order by id) from public.loads l where tenant_id=v_tenant),
    'events',(select jsonb_agg(to_jsonb(e) order by id) from public.dispatch_events e where tenant_id=v_tenant))::text) into v_before;
  insert into public.idempotency_keys(tenant_id,key_value) values
    (v_tenant,'qa-rls-20260830-post-own'),(v_other,'qa-rls-20260830-post-foreign');
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  execute 'set local role authenticated';
  select count(*),count(*) filter(where tenant_id=v_other) into v_visible,v_foreign
    from public.idempotency_keys where key_value like 'qa-rls-20260830-post-%';
  if v_visible<>1 or v_foreign<>0 then raise exception 'Idempotency tenant isolation failed';end if;
  perform set_config('request.jwt.claim.sub','',true);
  select count(*) into v_unsigned from public.idempotency_keys where key_value like 'qa-rls-20260830-post-%';
  if v_unsigned<>0 then raise exception 'Unsigned identity was allowed';end if;
  execute 'reset role';
  begin
    execute 'set local role anon';
    perform 1 from public.idempotency_keys limit 1;
  exception when insufficient_privilege then v_anon_denied:=true;
  end;
  execute 'reset role';
  if not v_anon_denied then raise exception 'Anonymous SELECT was not denied';end if;
  execute 'set local role service_role';
  select count(*) into v_service from public.idempotency_keys where key_value like 'qa-rls-20260830-post-%';
  execute 'reset role';
  if v_service<>2 then raise exception 'Backend service access changed';end if;

  -- Exercise the real planner's cached replay only. No trip/load/stop is created
  -- or changed: the synthetic cache points to an already existing trip.
  v_payload_hash:=md5(jsonb_build_object('driver_id',v_driver,'vehicle_id',v_vehicle,
    'route_name','QA replay only','load_ids',array[v_load],'stops','[]'::jsonb)::text);
  insert into public.idempotency_keys(tenant_id,key_value,operation,idempotency_key,payload_hash,result_id)
    values(v_tenant,'qa-rls-20260830-post-replay','plan_dispatch_trip','qa-rls-20260830-post-replay',v_payload_hash,v_trip);
  perform set_config('request.jwt.claim.sub',v_actor::text,true);execute 'set local role authenticated';
  v_first:=public.plan_dispatch_trip_v3(v_tenant,'qa-rls-20260830-post-replay',v_driver,v_vehicle,'QA replay only',array[v_load],'[]');
  v_second:=public.plan_dispatch_trip_v3(v_tenant,'qa-rls-20260830-post-replay',v_driver,v_vehicle,'QA replay only',array[v_load],'[]');
  execute 'reset role';
  if v_first is distinct from v_trip or v_second is distinct from v_trip then raise exception 'Planner replay changed';end if;
  select md5(jsonb_build_object(
    'trips',(select jsonb_agg(to_jsonb(t) order by id) from public.dispatch_trips t where tenant_id=v_tenant),
    'loads',(select jsonb_agg(to_jsonb(l) order by id) from public.loads l where tenant_id=v_tenant),
    'events',(select jsonb_agg(to_jsonb(e) order by id) from public.dispatch_events e where tenant_id=v_tenant))::text) into v_after;
  if v_after is distinct from v_before then raise exception 'Business state changed during cached replay';end if;
  perform set_config('qa.idempotency_rls_probe',jsonb_build_object('verified_at',clock_timestamp(),
    'visible_own_synthetic_keys',v_visible,'visible_foreign_synthetic_keys',v_foreign,'unsigned_visible',v_unsigned,
    'anon_denied',v_anon_denied,'service_visible',v_service,'planner_replay_preserved',true,'business_state_unchanged',true)::text,true);
end;
$probe$;
select current_setting('qa.idempotency_rls_probe')::jsonb result;
rollback;
