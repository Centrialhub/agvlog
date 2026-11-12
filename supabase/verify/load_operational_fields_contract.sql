-- Isolated seven-user seed only. All synthetic load/command writes roll back.
begin;
set local statement_timeout='20s';
do $guard$ begin
 if (select count(*) from auth.users)<>7 or (select count(*) from auth.users where email like '%@agvlog-e2e.invalid')<>7 then
  raise exception 'isolated_seed_required';end if;
 if has_function_privilege('anon','public.apply_load_aggregate_command(jsonb)','execute') then raise exception 'anonymous_load_writer';end if;
end;$guard$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $exercise$
declare result jsonb;payload jsonb;load_id uuid;tenant constant uuid:='20000000-0000-4000-8000-000000000001';
begin
 result:=public.apply_load_aggregate_command(jsonb_build_object('schema_version',1,'action','create','tenant_id',tenant,'request_id',gen_random_uuid(),
  'changes',jsonb_build_object('load_number','QA-OPERATIONAL-'||gen_random_uuid()::text),'reason','Synthetic operational contract'));
 load_id:=(result->>'load_id')::uuid;
 payload:=jsonb_build_object('schema_version',1,'action','update','tenant_id',tenant,'request_id',gen_random_uuid(),
  'load_id',load_id,'expected_version',1,'reason','Synthetic operational correction',
  'changes',jsonb_build_object('actual_load_at','2026-11-10T09:00:00Z','gate_departure_at','2026-11-10T10:00:00Z',
   'arrival_at','2026-11-11T11:00:00Z','driver_type','Agregado QA','monitor_responsible','Operação QA','monitored',true));
 result:=public.apply_load_aggregate_command(payload);
 if result->>'version'<>'2' or result->'load'->>'monitored'<>'true' or result->'load'->>'driver_type'<>'Agregado QA'
  or result->'load'->>'status'<>'planned' or (result->'load'->>'total_weight_kg')::numeric<>0 then raise exception 'operational_update_failed';end if;
 if public.apply_load_aggregate_command(payload)->>'replayed'<>'true' then raise exception 'operational_replay_failed';end if;
 begin
  perform public.apply_load_aggregate_command(payload||jsonb_build_object('request_id',gen_random_uuid()));
  raise exception 'stale_operational_update_accepted';
 exception when serialization_failure then null;end;
 begin
  perform public.apply_load_aggregate_command(payload||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',2,'changes',jsonb_build_object('total_weight_kg',100)));
  raise exception 'note_total_update_accepted';
 exception when invalid_parameter_value then null;end;
 begin
  perform public.apply_load_aggregate_command(payload||jsonb_build_object('request_id',gen_random_uuid(),'tenant_id','20000000-0000-4000-8000-000000000002'));
  raise exception 'cross_tenant_update_accepted';
 exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
 begin
  perform public.apply_load_aggregate_command(payload||jsonb_build_object('request_id',gen_random_uuid(),'expected_version',2));
  raise exception 'driver_header_update_accepted';
 exception when insufficient_privilege then null;end;
end;$exercise$;
rollback;
