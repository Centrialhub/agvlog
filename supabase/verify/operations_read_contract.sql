-- Isolated seven-user seed only. Actual SQL under authenticated role, rollback.
begin;
set local statement_timeout='30s';
do $guard$
begin
 if (select count(*) from auth.users)<>7 or
    (select count(*) from auth.users where email like '%@agvlog-e2e.invalid')<>7 then
  raise exception 'Isolated synthetic seed required';
 end if;
end;$guard$;
set local role authenticated;
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000002';
set local request.jwt.claims='{"role":"authenticated","aal":"aal1","sub":"10000000-0000-4000-8000-000000000002","active_tenant_id":"20000000-0000-4000-8000-000000000001"}';
do $contract$
declare s jsonb;t jsonb;r jsonb;
begin
 s:=public.operations_dashboard_summary_v1('20000000-0000-4000-8000-000000000001');
 if s->'pending_orders' is null or jsonb_typeof(s->'orders_by_status')<>'array' then raise exception 'summary_invalid';end if;
 t:=public.get_control_tower_snapshot_v1('20000000-0000-4000-8000-000000000001');
 if not(t ?& array['alert_limit','alert_total','alerts_truncated','trip_total','truncated']) then raise exception 'snapshot_invalid';end if;
 for r in select value from jsonb_array_elements(t->'trips') loop
  if not(r ?& array['previous_stops_total','previous_stops_truncated','pending_stops_total','pending_stops_truncated','loads_total','loads_truncated']) then raise exception 'trip_contract_invalid';end if;
 end loop;
 begin
  perform public.operations_dashboard_summary_v1('20000000-0000-4000-8000-000000000002');
  raise exception 'cross_tenant_summary_allowed';
 exception when insufficient_privilege then null;end;
 begin
  perform public.get_control_tower_snapshot_v1('20000000-0000-4000-8000-000000000002');
  raise exception 'cross_tenant_tower_allowed';
 exception when insufficient_privilege then null;end;
end;$contract$;
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000003';
set local request.jwt.claims='{"role":"authenticated","aal":"aal1","sub":"10000000-0000-4000-8000-000000000003","active_tenant_id":"20000000-0000-4000-8000-000000000001"}';
do $driver_denied$
begin
 begin
  perform public.operations_dashboard_summary_v1('20000000-0000-4000-8000-000000000001');
  raise exception 'driver_summary_allowed';
 exception when insufficient_privilege then null;end;
end;$driver_denied$;
reset role;
do $acl$
begin
 if has_function_privilege('anon','public.operations_dashboard_summary_v1(uuid)','EXECUTE') then raise exception 'anonymous_summary_allowed';end if;
end;$acl$;
rollback;
