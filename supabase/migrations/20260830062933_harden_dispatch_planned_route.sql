-- Candidate only: requires the reviewed trip/load graph guards first.
-- Preserves the JSON -> UUID API used by both operational planning screens.
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
begin
  if md5(replace(pg_get_functiondef(to_regprocedure('public.dispatch_planned_route(jsonb)')),E'\r\n',E'\n'))
    is distinct from '2ad186be84b9aca809f36302a3135be3' then raise exception 'Planning legacy contract changed';end if;
  if md5(replace(pg_get_functiondef(to_regprocedure('public.is_tenant_operator_or_admin(uuid)')),E'\r\n',E'\n'))
    is distinct from '682f66029dc9bb798f9f329b4e8f95aa' then raise exception 'Planning authorization contract changed';end if;
  if md5(replace(pg_get_functiondef(to_regprocedure('public.guard_trip_load_link_graph()')),E'\r\n',E'\n'))
    is distinct from '020ab0928aa3b624f2cdbb2f10eee329'
    or not exists(select 1 from pg_trigger where tgrelid='public.dispatch_trip_loads'::regclass
      and tgname='guard_trip_load_link_graph' and tgtype=31 and tgenabled='O'
      and tgfoid=to_regprocedure('public.guard_trip_load_link_graph()')) then
    raise exception 'Planning requires trip/load graph hardening';
  end if;
  if not exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass
    and polname='agvlog_select_authenticated'
    and md5(replace(pg_get_expr(polqual,polrelid),E'\r\n',E'\n'))='a5e2fc2cb8bbeb71640ea0bc13d8b3a8') then
    raise exception 'Planning requires scoped idempotency RLS';
  end if;
  if has_function_privilege('anon','public.dispatch_planned_route(jsonb)','execute')
    or not has_function_privilege('authenticated','public.dispatch_planned_route(jsonb)','execute')
    or not has_function_privilege('service_role','public.dispatch_planned_route(jsonb)','execute') then
    raise exception 'Planning legacy privileges changed';
  end if;
end;
$preflight$;

create or replace function public.dispatch_planned_route(_payload jsonb)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare
  v_actor uuid:=auth.uid();v_tenant uuid;v_vehicle uuid;v_driver uuid;v_draft uuid;v_start timestamptz;
  v_load_ids uuid[];v_doc_ids uuid[];v_requested uuid[]:=array[]::uuid[];v_stop_docs uuid[];v_stop_loads uuid[];v_actual_loads uuid[];
  v_stop jsonb;v_stop_id uuid;v_trip uuid;v_order int:=0;v_client uuid;v_count int;
  v_key text;v_key_value text;v_hash text;v_existing public.idempotency_keys%rowtype;
  v_lat numeric;v_lng numeric;v_arrival timestamptz;v_departure timestamptz;v_minutes int;v_risk text;
begin
  if v_actor is null then raise exception 'not_authorized' using errcode='42501';end if;
  if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'invalid_dispatch_payload' using errcode='22023';end if;
  v_tenant:=nullif(_payload->>'tenant_id','')::uuid;
  if v_tenant is null or not coalesce(public.is_tenant_operator_or_admin(v_tenant),false) then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  if jsonb_typeof(_payload->'load_ids') is distinct from 'array' or jsonb_typeof(_payload->'stops') is distinct from 'array' then
    raise exception 'dispatch_arrays_required' using errcode='22023';
  end if;
  select array_agg(value::uuid) into v_load_ids from jsonb_array_elements_text(_payload->'load_ids');
  if coalesce(cardinality(v_load_ids),0)=0 or jsonb_array_length(_payload->'stops')=0
    or cardinality(v_load_ids)<>(select count(distinct x) from unnest(v_load_ids) x) then
    raise exception 'dispatch_loads_and_stops_required_without_duplicates' using errcode='22023';
  end if;
  v_hash:=encode(sha256(convert_to((_payload-'idempotency_key')::text,'UTF8')),'hex');
  v_key:=coalesce(nullif(btrim(_payload->>'idempotency_key'),''),'legacy:'||v_hash);
  if length(v_key)>200 then raise exception 'invalid_dispatch_idempotency_key' using errcode='22023';end if;
  v_key_value:='dispatch_planned_route:'||v_actor::text||':'||v_key;
  -- No graph lock is retained while waiting for an identical request. Different
  -- keys still serialize/conflict on the actual load rows and graph guards.
  perform pg_advisory_xact_lock(hashtext('dispatch_planned_route'),hashtext(v_tenant::text||':'||v_key_value));
  perform tenant_id from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor
    and active and role::text in('owner','admin','operator') for share nowait;
  if not found then raise exception 'not_authorized' using errcode='42501';end if;
  select * into v_existing from public.idempotency_keys where tenant_id=v_tenant and key_value=v_key_value;
  if found then
    if v_existing.operation is distinct from 'dispatch_planned_route' or v_existing.payload_hash is distinct from v_hash then
      raise exception 'dispatch_idempotency_mismatch' using errcode='22023';
    end if;
    if not exists(select 1 from public.dispatch_trips where id=v_existing.result_id and tenant_id=v_tenant) then
      raise exception 'dispatch_replay_requires_reconciliation' using errcode='23514';
    end if;
    return v_existing.result_id;
  end if;

  v_vehicle:=nullif(_payload->>'vehicle_id','')::uuid;v_driver:=nullif(_payload->>'driver_id','')::uuid;
  v_draft:=nullif(_payload->>'planning_draft_id','')::uuid;v_start:=nullif(_payload->>'planned_start_at','')::timestamptz;
  if v_start is null or not isfinite(v_start) then raise exception 'planned_start_required' using errcode='22023';end if;
  perform id from public.vehicles where id=v_vehicle and tenant_id=v_tenant and active for share nowait;
  if not found then raise exception 'invalid_vehicle_for_tenant' using errcode='23514';end if;
  perform id from public.drivers where id=v_driver and tenant_id=v_tenant and active for share nowait;
  if not found then raise exception 'invalid_driver_for_tenant' using errcode='23514';end if;
  if v_draft is not null then
    perform id from public.route_planning_drafts where id=v_draft and tenant_id=v_tenant and status='draft' for update nowait;
    if not found then raise exception 'invalid_planning_draft' using errcode='23514';end if;
  end if;
  -- A new route accepts only unassigned loads. NOWAIT also protects against
  -- child-first legacy composition writers; do not form a reverse wait cycle.
  perform id from public.loads where id=any(v_load_ids) and tenant_id=v_tenant order by id for update nowait;
  get diagnostics v_count=row_count;
  if v_count<>cardinality(v_load_ids) then raise exception 'load_ownership_mismatch' using errcode='23514';end if;
  if exists(select 1 from public.loads where id=any(v_load_ids) and
    (trip_id is not null or coalesce(on_hold,false) or status is null or status not in('planned','assembling','ready','loading','loaded')))
    or exists(select 1 from public.dispatch_trip_loads l join public.dispatch_trips t on t.id=l.dispatch_trip_id
      where l.load_id=any(v_load_ids) and t.status is distinct from 'completed' and t.status is distinct from 'cancelled') then
    raise exception 'load_not_eligible_for_dispatch' using errcode='23514';
  end if;
  perform id from public.load_items where load_id=any(v_load_ids) order by load_id,id for update nowait;
  if exists(select 1 from public.load_items where load_id=any(v_load_ids) and tenant_id is distinct from v_tenant) then
    raise exception 'load_item_ownership_mismatch' using errcode='23514';
  end if;
  if exists(select 1 from public.loads l where l.id=any(v_load_ids) and not exists(
    select 1 from public.load_items i where i.load_id=l.id and i.fiscal_document_id is not null))
    or exists(select 1 from public.load_items where load_id=any(v_load_ids) and fiscal_document_id is null) then
    -- Manual cargo needs its own canonical stop/proof flow; do not silently
    -- create a route that the current document-based driver API cannot close.
    raise exception 'dispatch_requires_documented_items' using errcode='23514';
  end if;
  select array_agg(distinct fiscal_document_id order by fiscal_document_id) into v_doc_ids
    from public.load_items where load_id=any(v_load_ids);
  perform id from public.fiscal_documents where id=any(v_doc_ids) order by id for update nowait;
  if exists(select 1 from unnest(v_doc_ids) wanted(id) left join public.fiscal_documents f on f.id=wanted.id
    where f.id is null or f.tenant_id is distinct from v_tenant or f.document_type is distinct from 'inbound') then
    raise exception 'invalid_dispatch_document' using errcode='23514';
  end if;
  if exists(select 1 from public.load_items where fiscal_document_id=any(v_doc_ids)
      group by fiscal_document_id having count(distinct load_id)<>1 or bool_or(tenant_id is distinct from v_tenant))
    or exists(select 1 from public.fiscal_documents f join public.load_items i on i.fiscal_document_id=f.id
      where f.id=any(v_doc_ids) and f.load_id is distinct from i.load_id) then
    raise exception 'dispatch_document_load_mismatch' using errcode='23514';
  end if;
  if exists(select 1 from public.dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
    join public.dispatch_trips t on t.id=s.dispatch_trip_id where d.fiscal_document_id=any(v_doc_ids)
      and t.status is distinct from 'completed' and t.status is distinct from 'cancelled') then
    raise exception 'document_already_planned' using errcode='23514';
  end if;

  for v_stop in select value from jsonb_array_elements(_payload->'stops') loop
    if jsonb_typeof(v_stop) is distinct from 'object' or nullif(btrim(v_stop->>'destination'),'') is null
      or jsonb_typeof(v_stop->'fiscal_document_ids') is distinct from 'array' then
      raise exception 'invalid_dispatch_stop' using errcode='22023';
    end if;
    select array_agg(value::uuid) into v_stop_docs from jsonb_array_elements_text(v_stop->'fiscal_document_ids');
    if coalesce(cardinality(v_stop_docs),0)=0 then raise exception 'dispatch_stop_documents_required' using errcode='23514';end if;
    v_requested:=v_requested||v_stop_docs;
    v_client:=nullif(v_stop->>'client_id','')::uuid;
    if v_client is not null then
      perform id from public.clients where id=v_client and tenant_id=v_tenant and active for share nowait;
      if not found then raise exception 'invalid_client_for_tenant' using errcode='23514';end if;
      if exists(select 1 from public.fiscal_documents where id=any(v_stop_docs) and client_id is not null and client_id<>v_client) then
        raise exception 'dispatch_stop_client_mismatch' using errcode='23514';
      end if;
    end if;
    select array_agg(distinct load_id order by load_id) into v_actual_loads from public.load_items where fiscal_document_id=any(v_stop_docs);
    if v_stop?'load_ids' then
      if jsonb_typeof(v_stop->'load_ids') is distinct from 'array' then raise exception 'invalid_stop_load_ids' using errcode='22023';end if;
      select array_agg(value::uuid order by value::uuid) into v_stop_loads from jsonb_array_elements_text(v_stop->'load_ids');
      if v_stop_loads is distinct from v_actual_loads then raise exception 'dispatch_stop_load_mismatch' using errcode='23514';end if;
    end if;
    v_lat:=nullif(v_stop->>'latitude','')::numeric;v_lng:=nullif(v_stop->>'longitude','')::numeric;
    v_arrival:=nullif(v_stop->>'planned_arrival_at','')::timestamptz;v_departure:=nullif(v_stop->>'estimated_departure_at','')::timestamptz;
    v_minutes:=coalesce((v_stop->>'service_time_minutes')::int,20);v_risk:=coalesce(v_stop->>'risk_level','normal');
    if (v_lat is null) is distinct from (v_lng is null) or v_lat not between -90 and 90 or v_lng not between -180 and 180
      or v_minutes<0 or v_risk not in('normal','warning','critical')
      or (v_arrival is not null and not isfinite(v_arrival)) or (v_departure is not null and not isfinite(v_departure))
      or (v_arrival is not null and v_departure<v_arrival) then
      raise exception 'invalid_dispatch_stop_schedule_or_location' using errcode='22023';
    end if;
  end loop;
  if cardinality(v_requested)<>(select count(distinct d) from unnest(v_requested) d) then
    raise exception 'duplicate_dispatch_documents' using errcode='23514';
  end if;
  if (select array_agg(d order by d) from unnest(v_requested) d) is distinct from v_doc_ids then
    raise exception 'dispatch_document_coverage_mismatch' using errcode='23514';
  end if;

  insert into public.dispatch_trips(tenant_id,vehicle_id,driver_id,load_id,status,planned_start_at,notes,created_by)
    values(v_tenant,v_vehicle,v_driver,v_load_ids[1],'planned',v_start,coalesce(_payload->>'route_name','Rota planejada'),v_actor)
    returning id into v_trip;
  insert into public.dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id)
    select v_tenant,v_trip,id from unnest(v_load_ids) id order by id;
  insert into public.load_status_history(tenant_id,load_id,field_name,old_value,new_value,reason,created_by)
    select v_tenant,id,'status',status,'loading','dispatch_planned_route',v_actor from public.loads
    where id=any(v_load_ids) and status in('planned','assembling','ready');
  update public.loads set trip_id=v_trip,vehicle_id=v_vehicle,driver_id=v_driver,
    status=case when status='loaded' then 'loaded' else 'loading' end,updated_at=clock_timestamp()
    where id=any(v_load_ids) and tenant_id=v_tenant;
  for v_stop in select value from jsonb_array_elements(_payload->'stops') loop
    v_order:=v_order+1;
    insert into public.dispatch_stops(tenant_id,dispatch_trip_id,stop_order,destination,client_id,planned_arrival_at,
      estimated_departure_at,service_time_minutes,delivery_window_start,delivery_window_end,risk_level,risk_reason,notes,status,latitude,longitude)
    values(v_tenant,v_trip,v_order,v_stop->>'destination',nullif(v_stop->>'client_id','')::uuid,
      nullif(v_stop->>'planned_arrival_at','')::timestamptz,nullif(v_stop->>'estimated_departure_at','')::timestamptz,
      coalesce((v_stop->>'service_time_minutes')::int,20),nullif(v_stop->>'delivery_window_start','')::time,
      nullif(v_stop->>'delivery_window_end','')::time,coalesce(v_stop->>'risk_level','normal'),v_stop->>'risk_reason',
      v_stop->>'notes','pending',nullif(v_stop->>'latitude','')::numeric,nullif(v_stop->>'longitude','')::numeric)
    returning id into v_stop_id;
    insert into public.dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id,load_id)
      select distinct v_tenant,v_stop_id,i.fiscal_document_id,i.load_id from public.load_items i
      where i.fiscal_document_id in(select value::uuid from jsonb_array_elements_text(v_stop->'fiscal_document_ids'));
  end loop;
  if v_draft is not null then update public.route_planning_drafts set status='dispatched',converted_load_id=v_load_ids[1],updated_at=clock_timestamp()
    where id=v_draft and tenant_id=v_tenant;end if;
  perform public._log_entity_audit(v_tenant,'dispatch_trip',v_trip,'plan_dispatch',null,
    jsonb_build_object('load_ids',v_load_ids,'stop_count',v_order,'idempotency_key',v_key,'actor_id',v_actor),'dispatch_planned_route');
  insert into public.idempotency_keys(tenant_id,key_value,operation,idempotency_key,payload_hash,result_id)
    values(v_tenant,v_key_value,'dispatch_planned_route',v_key,v_hash,v_trip);
  return v_trip;
exception when lock_not_available then
  raise exception 'dispatch_concurrent_change' using errcode='40001',hint='Atualize o planejamento e repita a mesma solicitação completa.';
end;
$function$;
revoke all on function public.dispatch_planned_route(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dispatch_planned_route(jsonb) to authenticated,service_role;
