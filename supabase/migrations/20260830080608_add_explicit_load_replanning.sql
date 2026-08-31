-- LOCAL CANDIDATE: explicit pre-departure transfer of composition AND stop assignments.
-- Keeps cancelled empty stops as history; never manufactures arrival or delivery.
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
declare c record;
begin
  for c in select * from(values
    ('public._load_is_locked(uuid)','a15b8a40dfd93a05479f8cc0b04db3eb'),
    ('public.recalc_load_totals()','7dc12046ecada4d2f04bb2942a92493d'),
    ('public.delete_load_if_empty(uuid)','d724afa8cce7714aae6c4deedf00e7a3'),
    ('public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])','7ac9704abb7f610328b22b1e9f129d99'),
    ('public.guard_trip_load_link_graph()','020ab0928aa3b624f2cdbb2f10eee329'),
    ('public._derive_driver_delivery_result(uuid,uuid)','f9c85c43e7813e316467b95fb09b5963'),
    ('public.is_tenant_operator_or_admin(uuid)','682f66029dc9bb798f9f329b4e8f95aa')
  ) expected(signature,hash) loop
    if md5(replace(pg_get_functiondef(to_regprocedure(c.signature)),E'\r\n',E'\n')) is distinct from c.hash then
      raise exception 'Replanning dependency changed: %',c.signature;
    end if;
  end loop;
  if to_regprocedure('public.get_load_replanning_context(uuid,uuid,uuid)') is not null
    or to_regprocedure('public.replan_load_items(jsonb)') is not null
    or to_regprocedure('public._load_replanning_snapshot(uuid,uuid[])') is not null
    or to_regprocedure('public._assert_load_replanning_graph(uuid,uuid[])') is not null
    or exists(select 1 from information_schema.columns where table_schema='public' and table_name='idempotency_keys' and column_name='response_body') then
    raise exception 'Replanning object already exists; inspect before applying';
  end if;
  if not exists(select 1 from pg_class where oid='public.idempotency_keys'::regclass and relrowsecurity)
    or exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polcmd<>'r')
    or not exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polname='agvlog_select_authenticated'
    and md5(replace(pg_get_expr(polqual,polrelid),E'\r\n',E'\n'))='a5e2fc2cb8bbeb71640ea0bc13d8b3a8') then
    raise exception 'Replanning requires scoped request cache';
  end if;
end;
$preflight$;
alter table public.idempotency_keys add column response_body jsonb;

create function public._load_replanning_snapshot(_tenant_id uuid,_load_ids uuid[])
returns jsonb language sql stable security invoker set search_path=''
as $fn$
  with roots as (
    select l.trip_id id from public.loads l where l.id=any(_load_ids) and l.tenant_id=_tenant_id and l.trip_id is not null
    union select x.dispatch_trip_id from public.dispatch_trip_loads x join public.dispatch_trips t on t.id=x.dispatch_trip_id
      where x.load_id=any(_load_ids) and t.status is distinct from 'cancelled'
    union select t.id from public.dispatch_trips t where t.load_id=any(_load_ids) and t.status is distinct from 'cancelled'
  ), graph_loads as (
    select unnest(_load_ids) id union select x.load_id from public.dispatch_trip_loads x where x.dispatch_trip_id in(select id from roots)
  ), stop_rows as (
    select s.* from public.dispatch_stops s where s.dispatch_trip_id in(select id from roots) and s.tenant_id=_tenant_id
  ), item_rows as (
    select i.id,i.tenant_id,i.load_id,i.fiscal_document_id,i.quantity,i.pallet_count,i.weight_kg,i.volume_m3,i.updated_at
      from public.load_items i where i.load_id in(select id from graph_loads) and i.tenant_id=_tenant_id
  ), doc_ids as (
    select fiscal_document_id id from item_rows where fiscal_document_id is not null
    union select d.fiscal_document_id from public.dispatch_stop_documents d where d.dispatch_stop_id in(select id from stop_rows)
  )
  select jsonb_build_object(
    'loads',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from (
      select id,tenant_id,trip_id,status,on_hold,load_number,destination,driver_id,vehicle_id,updated_at
      from public.loads where id in(select id from graph_loads) and tenant_id=_tenant_id) l),'[]'::jsonb),
    'trips',coalesce((select jsonb_agg(to_jsonb(t) order by id) from (
      select id,tenant_id,load_id,driver_id,vehicle_id,status,actual_start_at,actual_end_at,updated_at
      from public.dispatch_trips where id in(select id from roots) and tenant_id=_tenant_id) t),'[]'::jsonb),
    'links',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.dispatch_trip_loads x
      where x.dispatch_trip_id in(select id from roots)),'[]'::jsonb),
    'stops',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from stop_rows s),'[]'::jsonb),
    'stop_documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public.dispatch_stop_documents d
      where d.dispatch_stop_id in(select id from stop_rows)),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from item_rows i),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from (
      select id,tenant_id,load_id,document_type,status,deleted_at from public.fiscal_documents
      where id in(select id from doc_ids) and tenant_id=_tenant_id) d),'[]'::jsonb));
$fn$;
revoke all on function public._load_replanning_snapshot(uuid,uuid[]) from public,anon,authenticated,service_role;

create function public._assert_load_replanning_graph(_tenant_id uuid,_load_ids uuid[])
returns void language plpgsql security invoker set search_path=''
as $fn$
declare v_roots uuid[];v_loads uuid[];v_count int;
begin
  select count(*) into v_count from public.loads where id=any(_load_ids) and tenant_id=_tenant_id;
  if v_count<>cardinality(_load_ids) then raise exception 'load_ownership_mismatch' using errcode='23514';end if;
  select coalesce(array_agg(id),array[]::uuid[]) into v_roots from (
    select trip_id id from public.loads where id=any(_load_ids) and trip_id is not null
    union select x.dispatch_trip_id from public.dispatch_trip_loads x join public.dispatch_trips t on t.id=x.dispatch_trip_id
      where x.load_id=any(_load_ids) and t.status is distinct from 'cancelled'
    union select id from public.dispatch_trips where load_id=any(_load_ids) and status is distinct from 'cancelled'
  ) roots;
  if exists(select 1 from public.dispatch_trips where id=any(v_roots)
    and (tenant_id is distinct from _tenant_id or status is distinct from 'planned' or actual_start_at is not null or actual_end_at is not null))
    or exists(select 1 from public.loads where id=any(_load_ids) and (coalesce(on_hold,false)
      or status is null or status not in('planned','assembling','ready','loading','loaded','divergent'))) then
    raise exception 'load_locked' using errcode='23514';
  end if;
  if exists(select 1 from public.dispatch_trip_loads x left join public.loads l on l.id=x.load_id
    where x.dispatch_trip_id=any(v_roots) and (x.tenant_id is distinct from _tenant_id or l.tenant_id is distinct from _tenant_id
      or l.trip_id is distinct from x.dispatch_trip_id))
    or exists(select 1 from public.loads l where l.id=any(_load_ids) and l.trip_id is not null and not exists(
      select 1 from public.dispatch_trip_loads x where x.load_id=l.id and x.dispatch_trip_id=l.trip_id and x.tenant_id=_tenant_id)) then
    raise exception 'composition_trip_graph_mismatch' using errcode='23514';
  end if;
  select array_agg(distinct id) into v_loads from (
    select unnest(_load_ids) id union select load_id from public.dispatch_trip_loads where dispatch_trip_id=any(v_roots)
  ) all_loads;
  if exists(select 1 from public.load_items i left join public.fiscal_documents d on d.id=i.fiscal_document_id
    left join public.loads l on l.id=i.load_id where i.load_id=any(v_loads)
      and (i.tenant_id is distinct from _tenant_id or l.tenant_id is distinct from _tenant_id
        or (i.fiscal_document_id is not null and (d.tenant_id is distinct from _tenant_id or d.load_id is distinct from i.load_id
          or d.document_type is distinct from 'inbound' or d.deleted_at is not null or d.status='deleted')))) then
    raise exception 'composition_document_mismatch' using errcode='23514';
  end if;
  if exists(select 1 from public.load_items i join public.dispatch_trip_loads x on x.load_id=i.load_id
    where x.dispatch_trip_id=any(v_roots) and (i.fiscal_document_id is null or (select count(*) from public.dispatch_stop_documents d
      join public.dispatch_stops s on s.id=d.dispatch_stop_id where d.fiscal_document_id=i.fiscal_document_id
        and d.tenant_id=_tenant_id and d.load_id=i.load_id and s.dispatch_trip_id=x.dispatch_trip_id)<>1)) then
    raise exception 'composition_stop_coverage_mismatch' using errcode='23514';
  end if;
  if exists(select 1 from public.dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
    left join public.fiscal_documents f on f.id=d.fiscal_document_id where s.dispatch_trip_id=any(v_roots)
      and (d.tenant_id is distinct from _tenant_id or s.tenant_id is distinct from _tenant_id or f.tenant_id is distinct from _tenant_id
        or d.load_id is distinct from f.load_id or not exists(select 1 from public.load_items i
          join public.dispatch_trip_loads x on x.load_id=i.load_id where i.fiscal_document_id=f.id and i.load_id=d.load_id
            and x.dispatch_trip_id=s.dispatch_trip_id)))
    or exists(select 1 from public.dispatch_stops s where s.dispatch_trip_id=any(v_roots)
      and (s.tenant_id is distinct from _tenant_id or s.actual_arrival_at is not null or s.actual_departure_at is not null
        or s.status is null or s.status not in('pending','cancelled')
        or (s.status='pending' and not exists(select 1 from public.dispatch_stop_documents where dispatch_stop_id=s.id))
        or (s.status='cancelled' and exists(select 1 from public.dispatch_stop_documents where dispatch_stop_id=s.id)))) then
    raise exception 'composition_stop_graph_mismatch' using errcode='23514';
  end if;
  if exists(select 1 from public.dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
    where d.fiscal_document_id in(select fiscal_document_id from public.load_items where load_id=any(v_loads))
      and not(s.dispatch_trip_id=any(v_roots))) then
    raise exception 'composition_stop_graph_mismatch' using errcode='23514';
  end if;
end;
$fn$;
revoke all on function public._assert_load_replanning_graph(uuid,uuid[]) from public,anon,authenticated,service_role;

create function public.get_load_replanning_context(_tenant_id uuid,_source_load_id uuid,_target_load_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
declare v_snapshot jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'not_authorized' using errcode='42501';end if;
  if _source_load_id is null or _target_load_id is null or _source_load_id=_target_load_id then
    raise exception 'invalid_composition_request' using errcode='22023';end if;
  perform public._assert_load_replanning_graph(_tenant_id,array[_source_load_id,_target_load_id]);
  v_snapshot:=public._load_replanning_snapshot(_tenant_id,array[_source_load_id,_target_load_id]);
  return v_snapshot||jsonb_build_object('revision',encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex'));
end;
$fn$;
revoke all on function public.get_load_replanning_context(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_load_replanning_context(uuid,uuid,uuid) to authenticated;

create function public.replan_load_items(_payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_source uuid;v_target uuid;v_request uuid;v_items uuid[];v_docs uuid[];v_expected_docs uuid[];
  v_roots uuid[];v_loads uuid[];v_stops uuid[];v_source_trip uuid;v_target_trip uuid;v_target_stop uuid;v_client uuid;
  v_before jsonb;v_after jsonb;v_result jsonb;v_cached public.idempotency_keys%rowtype;
  v_hash text;v_key text;v_reason text;v_mode text;v_destination text;v_lat numeric;v_lng numeric;v_count int;
  v_retired uuid[]:=array[]::uuid[];v_cancelled uuid[]:=array[]::uuid[];v_remaining uuid[];
begin
  if v_actor is null then raise exception 'not_authorized' using errcode='42501';end if;
  if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'invalid_replanning_request' using errcode='22023';end if;
  v_tenant:=(_payload->>'tenant_id')::uuid;
  if not coalesce(public.is_tenant_operator_or_admin(v_tenant),false) then raise exception 'not_authorized' using errcode='42501';end if;
  v_source:=(_payload->>'source_load_id')::uuid;v_target:=(_payload->>'target_load_id')::uuid;v_request:=(_payload->>'request_id')::uuid;
  v_reason:=nullif(btrim(_payload->>'reason'),'');
  if v_source is null or v_target is null or v_source=v_target or v_request is null or v_reason is null or length(v_reason)>2000
    or jsonb_typeof(_payload->'item_ids') is distinct from 'array' or jsonb_typeof(_payload->'target_stop') is distinct from 'object'
    or jsonb_typeof(_payload->'expected_document_ids') is distinct from 'array'
    or (_payload->>'revision') is null then raise exception 'invalid_replanning_request' using errcode='22023';end if;
  select array_agg(value::uuid order by value) into v_items from jsonb_array_elements_text(_payload->'item_ids');
  if coalesce(cardinality(v_items),0)=0 or cardinality(v_items)<>(select count(distinct id) from unnest(v_items) ids(id)) then
    raise exception 'invalid_composition_request' using errcode='22023';end if;
  v_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
  v_key:='replan_load_items:'||v_actor::text||':'||v_request::text;
  perform pg_advisory_xact_lock(hashtext('replan_load_items'),hashtext(v_tenant::text||':'||v_key));
  perform tenant_id from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active
    and role::text in('owner','admin','operator') for share nowait;
  if not found then raise exception 'not_authorized' using errcode='42501';end if;
  select * into v_cached from public.idempotency_keys where tenant_id=v_tenant and key_value=v_key;
  if found then
    if v_cached.operation is distinct from 'replan_load_items' or v_cached.payload_hash is distinct from v_hash then
      raise exception 'replanning_idempotency_mismatch' using errcode='22023';end if;
    if v_cached.response_body is null or v_cached.response_body->>'request_id' is distinct from v_request::text then
      raise exception 'replanning_replay_requires_reconciliation' using errcode='23514';end if;
    return v_cached.response_body;
  end if;
  perform public._assert_load_replanning_graph(v_tenant,array[v_source,v_target]);
  v_before:=public._load_replanning_snapshot(v_tenant,array[v_source,v_target]);
  select coalesce(array_agg((x->>'id')::uuid order by x->>'id'),array[]::uuid[]) into v_roots from jsonb_array_elements(v_before->'trips') x;
  select array_agg((x->>'id')::uuid order by x->>'id') into v_loads from jsonb_array_elements(v_before->'loads') x;
  select coalesce(array_agg((x->>'id')::uuid order by x->>'id'),array[]::uuid[]) into v_stops from jsonb_array_elements(v_before->'stops') x;
  -- Same parent order as delivery. Child-first legacy writers conflict promptly.
  perform id from public.dispatch_trips where id=any(v_roots) order by id for update nowait;
  perform id from public.dispatch_trip_loads where dispatch_trip_id=any(v_roots) order by load_id,id for update nowait;
  perform id from public.loads where id=any(v_loads) order by id for update nowait;
  perform id from public.dispatch_stops where id=any(v_stops) order by id for update nowait;
  perform id from public.dispatch_stop_documents where dispatch_stop_id=any(v_stops) order by id for update nowait;
  perform id from public.fiscal_documents where id in(select (x->>'id')::uuid from jsonb_array_elements(v_before->'documents') x)
    order by id for update nowait;
  perform id from public.load_items where load_id=any(v_loads) order by id for update nowait;
  if public._load_replanning_snapshot(v_tenant,array[v_source,v_target]) is distinct from v_before then
    raise exception 'composition_concurrent_change' using errcode='40001';end if;
  if encode(sha256(convert_to(v_before::text,'UTF8')),'hex') is distinct from _payload->>'revision' then
    raise exception 'replanning_revision_changed' using errcode='40001';end if;
  perform public._assert_load_replanning_graph(v_tenant,array[v_source,v_target]);
  select trip_id into v_source_trip from public.loads where id=v_source;
  select trip_id into v_target_trip from public.loads where id=v_target;
  select count(*),coalesce(array_agg(distinct fiscal_document_id order by fiscal_document_id)
    filter(where fiscal_document_id is not null),array[]::uuid[]) into v_count,v_docs
    from public.load_items where id=any(v_items) and load_id=v_source and tenant_id=v_tenant;
  if v_count<>cardinality(v_items) then raise exception 'composition_items_changed' using errcode='23514';end if;
  select coalesce(array_agg(value::uuid order by value::uuid),array[]::uuid[]) into v_expected_docs
    from jsonb_array_elements_text(_payload->'expected_document_ids');
  if v_expected_docs is distinct from v_docs then raise exception 'composition_items_changed' using errcode='23514';end if;
  if exists(select 1 from public.load_items where fiscal_document_id=any(v_docs) and not(id=any(v_items))) then
    raise exception 'composition_document_split_not_allowed' using errcode='23514';end if;
  if v_target_trip is not null and exists(select 1 from public.load_items where id=any(v_items) and fiscal_document_id is null) then
    raise exception 'manual_stop_assignment_required' using errcode='23514';end if;
  perform id from public.proof_of_delivery where fiscal_document_id=any(v_docs) order by id for update nowait;
  if exists(select 1 from public.proof_of_delivery where fiscal_document_id=any(v_docs)
    and (status in('uploaded','validated') or storage_path is not null or photo_url is not null or signature_url is not null or received_at is not null)) then
    raise exception 'replanning_has_delivery_evidence' using errcode='23514';end if;
  if exists(select 1 from public.fiscal_documents where id=any(v_docs) and (status in('delivered','returned','refused','failed','cancelled','partial_delivery')
    or cte_emitted_at is not null or cte_emitted_outbound_id is not null or nfse_emitted_at is not null)) then
    raise exception 'replanning_requires_fiscal_review' using errcode='23514';end if;
  v_mode:=_payload->'target_stop'->>'mode';
  if v_target_trip is null then
    if v_mode is distinct from 'unassigned' then raise exception 'replanning_target_unassigned' using errcode='22023';end if;
  elsif v_mode='existing' then
    v_target_stop:=(_payload->'target_stop'->>'stop_id')::uuid;
    if not exists(select 1 from public.dispatch_stops where id=v_target_stop and tenant_id=v_tenant
      and dispatch_trip_id=v_target_trip and status='pending' and actual_arrival_at is null and actual_departure_at is null) then
      raise exception 'invalid_replanning_target_stop' using errcode='23514';end if;
  elsif v_mode='new' then
    v_destination:=nullif(btrim(_payload->'target_stop'->>'destination'),'');
    v_client:=nullif(_payload->'target_stop'->>'client_id','')::uuid;
    v_lat:=(_payload->'target_stop'->>'latitude')::numeric;v_lng:=(_payload->'target_stop'->>'longitude')::numeric;
    if v_destination is null or v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
      raise exception 'replanning_destination_and_coordinates_required' using errcode='22023';end if;
    if v_client is not null then
      perform id from public.clients where id=v_client and tenant_id=v_tenant and active for share nowait;
      if not found then raise exception 'invalid_client_for_tenant' using errcode='23514';end if;
    end if;
    insert into public.dispatch_stops(tenant_id,dispatch_trip_id,stop_order,destination,client_id,status,latitude,longitude,notes)
      select v_tenant,v_target_trip,coalesce(max(stop_order),0)+1,v_destination,v_client,'pending',v_lat,v_lng,v_reason
        from public.dispatch_stops where dispatch_trip_id=v_target_trip returning id into v_target_stop;
  else raise exception 'explicit_replanning_target_required' using errcode='22023';end if;

  update public.load_items set load_id=v_target,updated_at=clock_timestamp() where id=any(v_items);
  if v_target_stop is not null then
    update public.dispatch_stop_documents set dispatch_stop_id=v_target_stop,load_id=v_target
      where fiscal_document_id=any(v_docs) and dispatch_stop_id=any(v_stops);
    insert into public.dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id,load_id)
      select v_tenant,v_target_stop,d,v_target from unnest(v_docs) d where not exists(
        select 1 from public.dispatch_stop_documents where fiscal_document_id=d and dispatch_stop_id=v_target_stop);
  else
    delete from public.dispatch_stop_documents where fiscal_document_id=any(v_docs) and dispatch_stop_id=any(v_stops);
  end if;
  -- Preserve stop IDs and references from messages/occurrences; cancellation is
  -- planning history, not a fabricated delivery, arrival or physical departure.
  with retired as(update public.dispatch_stops s set status='cancelled',updated_at=clock_timestamp(),
    notes=concat_ws(E'\n',nullif(s.notes,''),'Replanejamento: '||v_reason)
    where s.id=any(v_stops) and s.status='pending' and not exists(select 1 from public.dispatch_stop_documents where dispatch_stop_id=s.id)
    returning id) select coalesce(array_agg(id order by id),array[]::uuid[]) into v_retired from retired;
  if v_source_trip is not null and not exists(select 1 from public.load_items where load_id=v_source) then
    delete from public.dispatch_trip_loads where dispatch_trip_id=v_source_trip and load_id=v_source;
    if not exists(select 1 from public.dispatch_trip_loads where dispatch_trip_id=v_source_trip) then
      update public.dispatch_trips set status='cancelled',updated_at=clock_timestamp() where id=v_source_trip;
      v_cancelled:=array[v_source_trip];
    end if;
  end if;
  perform public.delete_load_if_empty(v_source);
  select array_agg(id) into v_remaining from public.loads where id in(v_source,v_target);
  perform public._assert_load_replanning_graph(v_tenant,v_remaining);
  v_after:=public._load_replanning_snapshot(v_tenant,v_remaining);
  v_result:=jsonb_build_object('request_id',v_request,'moved',cardinality(v_items),'source_load_id',v_source,'target_load_id',v_target,
    'document_ids',v_docs,'target_stop_id',v_target_stop,'source_removed',not exists(select 1 from public.loads where id=v_source),
    'retired_stop_ids',v_retired,'cancelled_trip_ids',v_cancelled);
  perform public._log_entity_audit(v_tenant,'load',v_source,'replan_items_out',v_before,
    jsonb_build_object('graph',v_after,'result',v_result,'reason',v_reason),'explicit_replanning');
  perform public._log_entity_audit(v_tenant,'load',v_target,'replan_items_in',null,
    jsonb_build_object('result',v_result,'reason',v_reason),'explicit_replanning');
  insert into public.idempotency_keys(tenant_id,key_value,operation,idempotency_key,payload_hash,result_id,response_body)
    values(v_tenant,v_key,'replan_load_items',v_request::text,v_hash,v_request,v_result);
  return v_result;
exception when lock_not_available then
  raise exception 'composition_concurrent_change' using errcode='40001',hint='Atualize o replanejamento antes de confirmar novamente.';
end;
$fn$;
revoke all on function public.replan_load_items(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.replan_load_items(jsonb) to authenticated;

-- Cancelled, empty, never-arrived stops are retained planning history, not cargo outcomes.
create or replace function public._derive_driver_delivery_result(p_tenant_id uuid,p_trip_id uuid)
returns void language plpgsql security invoker set search_path = ''
as $fn$
declare v_trip public.dispatch_trips%rowtype; v_load public.loads%rowtype; v_count integer;
  v_statuses text[]; v_result text; v_all_terminal boolean; v_missing boolean := false;
begin
  select * into v_trip from public._lock_delivery_trip_graph(p_tenant_id,p_trip_id);
  if v_trip.actual_start_at is null or v_trip.status is null or v_trip.status not in('in_transit','in_progress','completed') then
    raise exception 'Viagem sem início válido para concluir entregas' using errcode='23514';
  end if;
  select count(*) into v_count from public.dispatch_trip_loads where dispatch_trip_id=p_trip_id and tenant_id=p_tenant_id;
  select coalesce(bool_and(coalesce(status in('completed','delivered','cancelled','skipped','refused','returned','partial_delivery','failed'),false)),false)
    into v_all_terminal from public.dispatch_stops where dispatch_trip_id=p_trip_id and tenant_id=p_tenant_id;
  if v_count=0 then raise exception 'Viagem sem cargas vinculadas' using errcode='23514'; end if;
  -- A single-load trip unambiguously owns its stops. Shared trips require explicit document allocations.
  if v_count>1 and v_all_terminal and exists(select 1 from public.dispatch_stops s
    where s.dispatch_trip_id=p_trip_id and not (s.status='cancelled' and s.actual_arrival_at is null and s.actual_departure_at is null and not exists(select 1 from public.dispatch_stop_documents retired where retired.dispatch_stop_id=s.id)) and not exists(select 1 from public.dispatch_stop_documents d
      join public.fiscal_documents f on f.id=d.fiscal_document_id
      where d.dispatch_stop_id=s.id and coalesce(d.load_id,f.load_id) is not null)) then
    raise exception 'Parada sem carga identificada; revise os vínculos antes de concluir' using errcode='23514';
  end if;
  for v_load in select l.* from public.loads l join public.dispatch_trip_loads tl on tl.load_id=l.id
    where tl.dispatch_trip_id=p_trip_id and tl.tenant_id=p_tenant_id order by l.id loop
    -- A partial stop can fully deliver one document/load and return another.
    -- Use document outcomes for that stop, not its aggregate label for every load.
    select array_agg(case when s.status='partial_delivery' then (
      select public._delivery_result_from_statuses(array_agg(f.status))
      from public.dispatch_stop_documents d join public.fiscal_documents f on f.id=d.fiscal_document_id
      where d.dispatch_stop_id=s.id and d.tenant_id=p_tenant_id
        and (v_count=1 or coalesce(d.load_id,f.load_id)=v_load.id)
    ) else s.status end) into v_statuses from public.dispatch_stops s
    where s.dispatch_trip_id=p_trip_id and s.tenant_id=p_tenant_id and not (s.status='cancelled' and s.actual_arrival_at is null and s.actual_departure_at is null and not exists(select 1 from public.dispatch_stop_documents retired where retired.dispatch_stop_id=s.id)) and (v_count=1 or exists(
      select 1 from public.dispatch_stop_documents d join public.fiscal_documents f on f.id=d.fiscal_document_id
      where d.dispatch_stop_id=s.id and d.tenant_id=p_tenant_id and coalesce(d.load_id,f.load_id)=v_load.id));
    v_result := public._delivery_result_from_statuses(v_statuses);
    if coalesce(cardinality(v_statuses),0)=0 or (v_all_terminal and v_result is null) then v_missing:=true; end if;
    if v_result is not null and v_load.status is distinct from v_result then
      if v_load.status in('delivered','cancelled','returned','refused','partial_delivery','failed') then
        raise exception 'Carga possui resultado final divergente; solicite revisão' using errcode='23514';
      end if;
      update public.loads set status=v_result,updated_at=clock_timestamp() where id=v_load.id and tenant_id=p_tenant_id;
      perform public._log_entity_audit(p_tenant_id,'load',v_load.id,'status_change',
        jsonb_build_object('status',v_load.status),jsonb_build_object('status',v_result,'trip_id',p_trip_id),'delivery_outcome');
    end if;
  end loop;
  if v_all_terminal then
    if v_missing then raise exception 'Carga sem parada identificada; revise os vínculos antes de concluir' using errcode='23514'; end if;
    if v_trip.actual_start_at is null then raise exception 'Viagem sem início registrado' using errcode='23514'; end if;
    update public.dispatch_trips set status='completed',actual_end_at=coalesce(actual_end_at,clock_timestamp()),updated_at=clock_timestamp()
      where id=p_trip_id and tenant_id=p_tenant_id and status<>'completed';
  end if;
end;
$fn$;
revoke all on function public._derive_driver_delivery_result(uuid,uuid) from public,anon,authenticated,service_role;

-- Retain the load identity referenced by occurrences or delivery evidence.
create or replace function public.delete_load_if_empty(v_load_id uuid)
returns void language plpgsql security definer set search_path=''
as $function$
declare v_tenant_id uuid;
begin
  if v_load_id is null then return;end if;
  select tenant_id into v_tenant_id from public.loads where id=v_load_id for update nowait;
  if not found then return;end if;
  -- Documents are not the whole composition. Never delete remaining manual cargo.
  if exists(select 1 from public.operational_events where load_id=v_load_id)
    or exists(select 1 from public.proof_of_delivery where load_id=v_load_id)
    or exists(select 1 from public.load_items where load_id=v_load_id)
    or exists(select 1 from public.fiscal_documents where load_id=v_load_id and deleted_at is null and status is distinct from 'deleted') then
    return;
  end if;
  perform public.delete_load_safely(v_tenant_id,v_load_id);
exception when others then
  -- Preserve the legacy best-effort cleanup contract. Integrity/lock rejection
  -- leaves the empty load intact; it must never turn into a forced delete.
  return;
end;
$function$;
revoke all on function public.delete_load_if_empty(uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_load_if_empty(uuid) to service_role;
