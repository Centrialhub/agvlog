-- LOCAL CANDIDATE. Per-document operations and immutable attempt evidence.
-- Correction/redelivery cutover is a separate, unfinished part of this release.
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
begin
 if to_regclass('public.delivery_document_outcomes') is not null or to_regprocedure('public.record_operation_document_outcome(jsonb)') is not null then
  raise exception 'Operational document outcome objects already exist';end if;
 if to_regprocedure('public.save_load_item_preparation(jsonb)') is null
  or md5(replace(pg_get_functiondef('public._derive_driver_delivery_result(uuid,uuid)'::regprocedure),E'\r\n',E'\n'))<>'31a4a4ec4f9a00f7bf7df2f96ede223a'
  or md5(replace(pg_get_functiondef('public._lock_delivery_trip_graph(uuid,uuid)'::regprocedure),E'\r\n',E'\n'))<>'ffa8920db62358d266660d11685ed9c0'
  or md5(replace(pg_get_functiondef('public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)'::regprocedure),E'\r\n',E'\n'))<>'381e01547f4b7b67d1945018151ff3e2'
  or not has_function_privilege('authenticated','public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)','execute')
  or md5(replace(pg_get_functiondef('public._delivery_result_from_statuses(text[])'::regprocedure),E'\r\n',E'\n'))<>'be12c89528e9935bc76ce89dec420de7' then
  raise exception 'Operational document outcome dependencies changed';end if;
 if not exists(select 1 from pg_attribute where attrelid='public.idempotency_keys'::regclass and attname='response_body' and atttypid='jsonb'::regtype and not attnotnull and not atthasdef and not attisdropped)
  or not exists(select 1 from pg_class where oid='public.idempotency_keys'::regclass and relrowsecurity)
  or exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polcmd<>'r')
  or not exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polname='agvlog_select_authenticated'
   and md5(replace(pg_get_expr(polqual,polrelid),E'\r\n',E'\n'))='a5e2fc2cb8bbeb71640ea0bc13d8b3a8') then
  raise exception 'Operational document outcomes require protected response cache';end if;
end;
$preflight$;

create table public.delivery_document_outcomes(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 dispatch_trip_id uuid not null references public.dispatch_trips(id),dispatch_stop_id uuid not null references public.dispatch_stops(id),
 dispatch_stop_document_id uuid not null references public.dispatch_stop_documents(id),load_id uuid not null references public.loads(id),
 fiscal_document_id uuid not null references public.fiscal_documents(id),event_id uuid not null references public.dispatch_events(id),
 source text not null check(source in('driver','operation')),outcome text not null check(outcome in('delivered','partial_delivery','returned','refused','failed','cancelled','not_delivered')),
 occurred_at timestamptz not null,recorded_at timestamptz not null default clock_timestamp(),actor_id uuid not null,
 reason text,document_snapshot jsonb not null,items_snapshot jsonb not null,proof_snapshot jsonb not null,
 unique(event_id,fiscal_document_id)
);
create index delivery_document_outcomes_tenant_document_idx on public.delivery_document_outcomes(tenant_id,fiscal_document_id,recorded_at desc,id);
create index delivery_document_outcomes_stop_idx on public.delivery_document_outcomes(dispatch_stop_id);
create index delivery_document_outcomes_trip_idx on public.delivery_document_outcomes(dispatch_trip_id);
create index delivery_document_outcomes_load_idx on public.delivery_document_outcomes(load_id);
create index delivery_document_outcomes_allocation_idx on public.delivery_document_outcomes(dispatch_stop_document_id);
create index delivery_document_outcomes_document_idx on public.delivery_document_outcomes(fiscal_document_id,recorded_at desc);
alter table public.delivery_document_outcomes enable row level security;
revoke all on public.delivery_document_outcomes from public,anon,authenticated,service_role;
grant select on public.delivery_document_outcomes to authenticated,service_role;
create policy delivery_document_outcomes_operator_read on public.delivery_document_outcomes for select to authenticated
 using(auth.uid() is not null and public.is_tenant_operator_or_admin(tenant_id));

create function public._preserve_delivery_document_outcome() returns trigger language plpgsql security invoker set search_path=''
as $fn$ begin raise exception 'Delivery outcome history is append-only; record a correction' using errcode='55000';end; $fn$;
revoke all on function public._preserve_delivery_document_outcome() from public,anon,authenticated,service_role;
create trigger preserve_delivery_document_outcome before update or delete on public.delivery_document_outcomes
 for each row execute function public._preserve_delivery_document_outcome();

create function public._snapshot_delivery_document_outcome(_event uuid,_document uuid,_source text,_occurred timestamptz)
returns uuid language plpgsql security invoker set search_path=''
as $fn$
declare e public.dispatch_events%rowtype;d public.dispatch_stop_documents%rowtype;f public.fiscal_documents%rowtype;v_id uuid;
begin
 select * into strict e from public.dispatch_events where id=_event;
 select * into strict d from public.dispatch_stop_documents where dispatch_stop_id=e.dispatch_stop_id and fiscal_document_id=_document;
 select * into strict f from public.fiscal_documents where id=_document;
 d.load_id:=coalesce(d.load_id,f.load_id);
 if e.created_by is null or e.created_by is distinct from auth.uid() or e.tenant_id<>d.tenant_id or f.tenant_id<>d.tenant_id
  or d.load_id is null or d.load_id is distinct from f.load_id then raise exception 'Invalid delivery history graph' using errcode='23514';end if;
 insert into public.delivery_document_outcomes(tenant_id,dispatch_trip_id,dispatch_stop_id,dispatch_stop_document_id,load_id,
  fiscal_document_id,event_id,source,outcome,occurred_at,actor_id,reason,document_snapshot,items_snapshot,proof_snapshot)
 values(e.tenant_id,e.dispatch_trip_id,d.dispatch_stop_id,d.id,d.load_id,f.id,e.id,_source,f.status,_occurred,e.created_by,e.notes,
  jsonb_build_object('id',f.id,'load_id',f.load_id,'status',f.status,'invoice_number',f.invoice_number,'delivery_meta',f.delivery_meta),
  coalesce((select jsonb_agg(to_jsonb(li) order by li.id) from public.load_items li where li.load_id=d.load_id and li.fiscal_document_id=f.id),'[]'::jsonb),
  coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.proof_of_delivery p where p.fiscal_document_id=f.id
    and p.tenant_id=e.tenant_id and p.dispatch_stop_id=d.dispatch_stop_id),'[]'::jsonb)) returning id into v_id;
 return v_id;
end;
$fn$;
revoke all on function public._snapshot_delivery_document_outcome(uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;

-- Capture canonical driver confirmation in the same transaction, never by
-- replaying old events or inventing timestamps for historical data.
create function public._capture_driver_document_outcomes() returns trigger language plpgsql security invoker set search_path=''
as $fn$
declare v_doc uuid;
begin
 if new.payload->>'source'='driver_app' and new.payload ? 'delivery_result' and not(old.payload ? 'delivery_result')
  and new.event_type in('delivery_delivered','stop_partial_delivery','stop_returned','stop_refused','stop_failed','stop_skipped','stop_cancelled') then
  for v_doc in select fiscal_document_id from public.dispatch_stop_documents where dispatch_stop_id=new.dispatch_stop_id
    and (new.payload->'delivery_result'->'applied_document_ids') ? fiscal_document_id::text order by fiscal_document_id loop
   perform public._snapshot_delivery_document_outcome(new.id,v_doc,'driver',new.event_at);
  end loop;
 end if;
 return new;
end;
$fn$;
revoke all on function public._capture_driver_document_outcomes() from public,anon,authenticated,service_role;
create trigger capture_driver_document_outcomes after update of payload on public.dispatch_events
 for each row execute function public._capture_driver_document_outcomes();

-- A per-invoice non-delivery is terminal, like a skipped stop, while retaining
-- the invoice's explicit label. Mixed delivered/non-delivered is partial.
create or replace function public._delivery_result_from_statuses(_statuses text[])
returns text language plpgsql immutable set search_path=''
as $fn$
begin
 if coalesce(cardinality(_statuses),0)=0 or exists(select 1 from unnest(_statuses) s
  where s is null or s not in('delivered','completed','partial_delivery','returned','refused','failed','cancelled','skipped','not_delivered')) then return null;end if;
 if not exists(select 1 from unnest(_statuses) s where s not in('delivered','completed')) then return 'delivered';end if;
 if _statuses&&array['delivered','completed','partial_delivery'] then return 'partial_delivery';end if;
 if not exists(select 1 from unnest(_statuses) s where s<>'returned') then return 'returned';end if;
 if not exists(select 1 from unnest(_statuses) s where s<>'refused') then return 'refused';end if;
 if not exists(select 1 from unnest(_statuses) s where s<>'cancelled') then return 'cancelled';end if;
 return 'failed';
end;
$fn$;
revoke all on function public._delivery_result_from_statuses(text[]) from public,anon,authenticated,service_role;

create function public._operation_document_context(_tenant uuid,_load uuid,_document uuid)
returns jsonb language sql stable security invoker set search_path=''
as $fn$
 select jsonb_build_object('tenant_id',f.tenant_id,'load_id',l.id,'document_id',f.id,'document_status',f.status,
  'delivery_meta',f.delivery_meta,'trip_id',t.id,'trip_status',t.status,'actual_start_at',t.actual_start_at,
  'stops',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'destination',s.destination,
   'actual_arrival_at',s.actual_arrival_at,'actual_departure_at',s.actual_departure_at) order by s.id)
   from public.dispatch_stops s join public.dispatch_stop_documents d on d.dispatch_stop_id=s.id
   where d.fiscal_document_id=f.id and d.load_id=l.id and d.tenant_id=_tenant and s.dispatch_trip_id=t.id),'[]'::jsonb),
  'proofs',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'status',p.status,'updated_at',p.updated_at) order by p.id)
   from public.proof_of_delivery p where p.fiscal_document_id=f.id),'[]'::jsonb),
  'history',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'source',h.source,'outcome',h.outcome,
   'occurred_at',h.occurred_at,'recorded_at',h.recorded_at,'reason',h.reason) order by h.recorded_at,h.id)
   from public.delivery_document_outcomes h where h.fiscal_document_id=f.id and h.tenant_id=_tenant),'[]'::jsonb))
 from public.fiscal_documents f join public.loads l on l.id=f.load_id and l.tenant_id=f.tenant_id
 left join public.dispatch_trips t on t.id=l.trip_id and t.tenant_id=l.tenant_id
 where f.id=_document and f.tenant_id=_tenant and l.id=_load and f.document_type='inbound' and f.deleted_at is null;
$fn$;
revoke all on function public._operation_document_context(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.get_operation_document_context(_tenant_id uuid,_load_id uuid,_document_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_context jsonb;
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'not_authorized' using errcode='42501';end if;
 v_context:=public._operation_document_context(_tenant_id,_load_id,_document_id);
 if v_context is null then raise exception 'operation_document_not_found' using errcode='23514';end if;
 return v_context||jsonb_build_object('revision',encode(sha256(convert_to(v_context::text,'UTF8')),'hex'));
end;
$fn$;
revoke all on function public.get_operation_document_context(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_operation_document_context(uuid,uuid,uuid) to authenticated;

create function public.record_operation_document_outcome(_payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_tenant uuid;v_load uuid;v_doc uuid;v_stop uuid;v_request uuid;v_actor uuid:=auth.uid();v_trip uuid;
 v_outcome text;v_reason text;v_receiver text;v_time timestamptz;v_key text;v_hash text;v_context jsonb;v_result jsonb;
 v_cache public.idempotency_keys%rowtype;v_fd public.fiscal_documents%rowtype;v_s public.dispatch_stops%rowtype;
 v_event uuid;v_history uuid;v_pod uuid;v_stop_result text;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or octet_length(_payload::text)>16384 then raise exception 'invalid_operation_outcome' using errcode='22023';end if;
 if exists(select 1 from jsonb_each(_payload) p where p.key in('tenant_id','load_id','document_id','stop_id','request_id','occurred_at','outcome','reason','receiver_name','revision')
  and jsonb_typeof(p.value)<>'string') or coalesce(_payload->>'occurred_at','')!~*'(Z|[+-][0-9]{2}:[0-9]{2})$' then
  raise exception 'invalid_operation_outcome' using errcode='22023';end if;
 v_tenant:=(_payload->>'tenant_id')::uuid;v_load:=(_payload->>'load_id')::uuid;v_doc:=(_payload->>'document_id')::uuid;
 v_stop:=(_payload->>'stop_id')::uuid;v_request:=(_payload->>'request_id')::uuid;v_time:=(_payload->>'occurred_at')::timestamptz;
 v_outcome:=_payload->>'outcome';v_reason:=btrim(_payload->>'reason');v_receiver:=nullif(btrim(_payload->>'receiver_name'),'');
 if v_actor is null or not coalesce(public.is_tenant_operator_or_admin(v_tenant),false) then raise exception 'not_authorized' using errcode='42501';end if;
 if v_load is null or v_doc is null or v_stop is null or v_request is null or v_time is null or not isfinite(v_time)
  or v_outcome is null or v_outcome not in('delivered','returned','refused','failed','not_delivered')
  or coalesce(length(v_reason),0)<5 or length(v_reason)>2000
  or (v_outcome='delivered' and (coalesce(length(v_receiver),0)<2 or length(v_receiver)>160))
  or coalesce(_payload->>'revision','')!~'^[0-9a-f]{64}$' then raise exception 'invalid_operation_outcome' using errcode='22023';end if;
 v_key:='record_operation_document_outcome:'||v_actor::text||':'||v_request::text;
 v_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('record_operation_document_outcome'),hashtext(v_tenant::text||':'||v_key));
 perform tenant_id from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active and role::text in('owner','admin','operator') for share nowait;
 if not found then raise exception 'not_authorized' using errcode='42501';end if;
 select * into v_cache from public.idempotency_keys where tenant_id=v_tenant and key_value=v_key;
 if found then
  if v_cache.operation is distinct from 'record_operation_document_outcome' or v_cache.payload_hash is distinct from v_hash then raise exception 'operation_outcome_key_mismatch' using errcode='22023';end if;
  if v_cache.response_body->>'request_id' is distinct from v_request::text then raise exception 'operation_outcome_reconciliation_required' using errcode='23514';end if;
  return v_cache.response_body;
 end if;
 select trip_id into v_trip from public.loads where id=v_load and tenant_id=v_tenant;
 if v_trip is null then raise exception 'operation_outcome_requires_started_trip' using errcode='23514';end if;
 perform public._lock_delivery_trip_graph(v_tenant,v_trip);
 if not exists(select 1 from public.dispatch_trips where id=v_trip and actual_start_at is not null and status in('in_transit','in_progress')) then
  raise exception 'operation_outcome_requires_started_trip' using errcode='23514';end if;
 v_context:=public._operation_document_context(v_tenant,v_load,v_doc);
 if v_context is null or encode(sha256(convert_to(v_context::text,'UTF8')),'hex') is distinct from _payload->>'revision' then
  raise exception 'operation_outcome_context_changed' using errcode='40001';end if;
 select * into strict v_fd from public.fiscal_documents where id=v_doc and tenant_id=v_tenant;
 select * into v_s from public.dispatch_stops where id=v_stop and dispatch_trip_id=v_trip and tenant_id=v_tenant;
 if not found or not exists(select 1 from public.dispatch_stop_documents where dispatch_stop_id=v_stop and fiscal_document_id=v_doc and load_id=v_load and tenant_id=v_tenant) then
  raise exception 'operation_outcome_invalid_stop' using errcode='23514';end if;
 if v_s.actual_arrival_at is null or v_s.status is null or v_s.status=any(public.stop_terminal_statuses()) then
  raise exception 'operation_outcome_requires_arrival' using errcode='23514';end if;
 if v_time<v_s.actual_arrival_at or v_time>clock_timestamp()+interval '2 minutes' then raise exception 'operation_outcome_invalid_time' using errcode='22023';end if;
 if v_fd.status in('delivered','partial_delivery','returned','refused','failed','cancelled','not_delivered') then
  raise exception 'operation_outcome_requires_correction' using errcode='23514';end if;
 perform id from public.load_items where fiscal_document_id=v_doc order by id for share nowait;
 if not exists(select 1 from public.load_items where fiscal_document_id=v_doc and load_id=v_load and tenant_id=v_tenant)
  or exists(select 1 from public.load_items where fiscal_document_id=v_doc and (load_id<>v_load or tenant_id<>v_tenant)) then
  raise exception 'operation_outcome_invalid_items' using errcode='23514';end if;
 perform id from public.proof_of_delivery where fiscal_document_id=v_doc order by id for update nowait;
 if exists(select 1 from public.proof_of_delivery where fiscal_document_id=v_doc and (tenant_id<>v_tenant or status not in('pending','missing')
  or storage_path is not null or photo_url is not null or signature_url is not null or received_at is not null or metadata<>'{}'::jsonb
  or dispatch_stop_id is not null and dispatch_stop_id<>v_stop or dispatch_trip_id is not null and dispatch_trip_id<>v_trip)) then
  raise exception 'operation_outcome_proof_requires_review' using errcode='23514';end if;
 insert into public.dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,notes,payload,created_by,event_at)
  values(v_tenant,v_trip,v_stop,'operation_document_outcome',v_reason,jsonb_build_object('source','operation','document_id',v_doc,
   'outcome',v_outcome,'occurred_at',v_time,'request_id',v_request,'manual_attestation',true),v_actor,clock_timestamp()) returning id into v_event;
 if v_outcome='delivered' then
  insert into public.proof_of_delivery as p(tenant_id,fiscal_document_id,load_id,dispatch_trip_id,dispatch_stop_id,proof_type,status,receiver_name,metadata,created_by)
   values(v_tenant,v_doc,v_load,v_trip,v_stop,'manual_receipt','pending',v_receiver,
    jsonb_build_object('source','operation','manual_attestation',true,'attested_at',v_time,'event_id',v_event,'reason',v_reason),v_actor)
   on conflict(fiscal_document_id) do update set load_id=excluded.load_id,dispatch_trip_id=excluded.dispatch_trip_id,dispatch_stop_id=excluded.dispatch_stop_id,
    proof_type=excluded.proof_type,status='pending',receiver_name=excluded.receiver_name,metadata=excluded.metadata,created_by=excluded.created_by,updated_at=clock_timestamp()
   returning id into v_pod;
 end if;
 update public.fiscal_documents set status=v_outcome,delivery_meta=coalesce(delivery_meta,'{}'::jsonb)||jsonb_build_object(
  'ne',v_outcome<>'delivered','ne_reason',case when v_outcome<>'delivered' then v_reason else '' end,
  'delivery_at',case when v_outcome='delivered' then to_jsonb(v_time) else 'null'::jsonb end,
  'ne_at',case when v_outcome<>'delivered' then to_jsonb(v_time) else 'null'::jsonb end),updated_at=clock_timestamp() where id=v_doc;
 v_history:=public._snapshot_delivery_document_outcome(v_event,v_doc,'operation',v_time);
 perform public._log_entity_audit(v_tenant,'fiscal_document',v_doc,'operation_delivery_outcome',to_jsonb(v_fd),
  jsonb_build_object('status',v_outcome,'history_id',v_history,'event_id',v_event),'operation_document_outcome');
 select public._delivery_result_from_statuses(array_agg(case when f.status='not_delivered' then 'failed' else f.status end)) into v_stop_result
  from public.dispatch_stop_documents d join public.fiscal_documents f on f.id=d.fiscal_document_id where d.dispatch_stop_id=v_stop;
 if v_stop_result is not null then
  update public.dispatch_stops set status=v_stop_result,updated_at=clock_timestamp() where id=v_stop;
  -- Do not invent a departure time: document confirmation is not physical departure.
  perform public._derive_driver_delivery_result(v_tenant,v_trip);
 end if;
 v_result:=jsonb_build_object('request_id',v_request,'tenant_id',v_tenant,'load_id',v_load,'document_id',v_doc,'stop_id',v_stop,
  'outcome',v_outcome,'event_id',v_event,'history_id',v_history,'pod_id',v_pod,'proof_pending',v_outcome='delivered',
  'stop_status',(select status from public.dispatch_stops where id=v_stop),'trip_completed',(select status='completed' from public.dispatch_trips where id=v_trip));
 insert into public.idempotency_keys(tenant_id,key_value,operation,idempotency_key,payload_hash,result_id,response_body)
  values(v_tenant,v_key,'record_operation_document_outcome',v_request::text,v_hash,v_history,v_result);
 return v_result;
exception when lock_not_available then raise exception 'operation_outcome_concurrent_change' using errcode='40001';
end;
$fn$;
revoke all on function public.record_operation_document_outcome(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_operation_document_outcome(jsonb) to authenticated;

create or replace function public.driver_record_delivery_outcome(
  _stop_id uuid,_outcome text,_details jsonb default '{}'::jsonb,
  _client_event_id uuid default null,_expected_status text default null
)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare
  v_stop public.dispatch_stops%rowtype; v_trip public.dispatch_trips%rowtype;
  v_existing public.dispatch_events%rowtype; v_event uuid; v_occurrence uuid; v_pod uuid;
  v_pods uuid[] := array[]::uuid[]; v_docs uuid[]; v_loads uuid[];
  v_details jsonb; v_request jsonb; v_result jsonb; v_photos jsonb; v_items jsonb;
  v_notes text; v_receiver text; v_signature text; v_path text; v_prefix text;
  v_fd record; v_item record; v_quantity numeric; v_returned numeric := 0; v_total numeric;
  v_doc_total numeric; v_doc_returned numeric; v_doc_outcome text; v_single_load uuid;
  v_preserved uuid[]:=array[]::uuid[];v_applied uuid[]:=array[]::uuid[];v_stop_outcome text;
begin
  select * into v_stop from public._lock_driver_delivery_stop(_stop_id);
  select * into v_trip from public.dispatch_trips where id=v_stop.dispatch_trip_id;
  if _outcome is null or _outcome not in('delivered','partial_delivery','returned','refused','failed','skipped','cancelled') then
    raise exception 'Resultado de entrega inválido' using errcode='22023'; end if;
  if _details is null or jsonb_typeof(_details)<>'object' or octet_length(_details::text)>131072 then
    raise exception 'Dados de entrega inválidos' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(_details) x where x.key in('notes','return_reason','receiver_name','receiver_document','receiver_role','signature_path','event_label')
    and jsonb_typeof(x.value) not in('string','null')) then
    raise exception 'Campo de texto inválido' using errcode='22023'; end if;
  v_notes:=coalesce(nullif(btrim(_details->>'notes'),''),nullif(btrim(_details->>'return_reason'),''));
  v_receiver:=nullif(btrim(coalesce(_details->>'receiver_name','')),'');
  v_signature:=nullif(btrim(coalesce(_details->>'signature_path','')),'');
  v_photos:=coalesce(_details->'photo_paths','[]'::jsonb);
  v_items:=coalesce(_details->'returned_items','{}'::jsonb);
  if jsonb_typeof(v_photos)<>'array' or jsonb_array_length(v_photos)>5 or jsonb_typeof(v_items)<>'object'
    or length(coalesce(v_notes,''))>2000 or length(coalesce(v_receiver,''))>160
    or length(coalesce(_details->>'receiver_document',''))>80 or length(coalesce(_details->>'receiver_role',''))>80 then
    raise exception 'Dados de entrega inválidos' using errcode='22023'; end if;
  v_details:=_details || jsonb_build_object('notes',v_notes,'receiver_name',v_receiver,'signature_path',v_signature,
    'photo_paths',v_photos,'returned_items',v_items);
  v_request:=jsonb_build_object('outcome',_outcome,'details',v_details);
  -- Resolve a lost response before checking files again: a committed result is immutable.
  select * into v_existing from public.dispatch_events
    where tenant_id=v_stop.tenant_id and created_by=auth.uid()
      and event_type in('delivery_note','delivery_delivered','stop_partial_delivery','stop_returned','stop_refused','stop_failed','stop_skipped','stop_cancelled')
      and ((_client_event_id is not null and payload->>'client_event_id'=_client_event_id::text)
        or (_client_event_id is null and dispatch_stop_id=_stop_id and payload->'delivery_request'=v_request))
      and payload ? 'delivery_result' order by event_at desc,created_at desc,id desc limit 1;
  if found then
    if v_existing.dispatch_stop_id<>_stop_id or v_existing.payload->'delivery_request' is distinct from v_request then
      raise exception 'Identificador reutilizado para outra entrega' using errcode='23505'; end if;
    return (v_existing.payload->'delivery_result') || jsonb_build_object('replayed',true);
  end if;
  if _expected_status is not null and _expected_status is distinct from v_stop.status then
    raise exception 'A parada mudou. Atualize antes de confirmar.' using errcode='40001'; end if;
  if v_stop.status is null or v_stop.status=any(public.stop_terminal_statuses()) or v_trip.status='completed' then
    raise exception 'Parada já finalizada; solicite revisão à operação' using errcode='23514'; end if;
  if _outcome not in('skipped','cancelled') and v_stop.actual_arrival_at is null then
    raise exception 'Registre a chegada antes de informar o resultado' using errcode='23514'; end if;
  if _outcome<>'delivered' and length(coalesce(v_notes,''))<3 then
    raise exception 'Informe o motivo do resultado da entrega' using errcode='22023'; end if;
  if _outcome in('delivered','partial_delivery') and length(coalesce(v_receiver,''))<2 then
    raise exception 'Informe o recebedor' using errcode='22023'; end if;
  if _outcome in('delivered','partial_delivery') and (v_signature is null or jsonb_array_length(v_photos)=0) then
    raise exception 'Foto e assinatura são obrigatórias para comprovar a entrega' using errcode='22023'; end if;
  v_prefix:=v_stop.tenant_id::text || '/deliveries/' || v_trip.id::text || '/' || _stop_id::text || '/';
  if exists(select 1 from jsonb_array_elements(v_photos) p where jsonb_typeof(p)<>'string') then
    raise exception 'Caminho de foto inválido' using errcode='22023'; end if;
  for v_path in select value from jsonb_array_elements_text(v_photos) union all select v_signature where v_signature is not null loop
    if v_path is null or length(v_path)>500 or position('..' in v_path)>0 or left(v_path,length(v_prefix))<>v_prefix
      or not exists(select 1 from storage.objects where bucket_id='receipts' and name=v_path) then
      raise exception 'Comprovante inexistente ou fora desta entrega' using errcode='42501'; end if;
  end loop;
  -- Lock quantities in stable order before validating item-level outcomes.
  perform li.id from public.load_items li where exists(select 1 from public.dispatch_stop_documents d
    where d.dispatch_stop_id=_stop_id and d.fiscal_document_id=li.fiscal_document_id) order by li.id for share;
  if exists(select 1 from public.load_items li join public.fiscal_documents f on f.id=li.fiscal_document_id
    join public.dispatch_stop_documents d on d.fiscal_document_id=f.id where d.dispatch_stop_id=_stop_id
    and (li.tenant_id is distinct from v_stop.tenant_id or (li.load_id is not null and coalesce(d.load_id,f.load_id) is not null
      and li.load_id<>coalesce(d.load_id,f.load_id)))) then
    raise exception 'Itens fora do vínculo de carga da parada' using errcode='23514'; end if;
  -- History is immutable. A legacy current-status edit cannot silently become
  -- a second attempt or change the meaning of an already recorded outcome.
  if exists(select 1 from public.delivery_document_outcomes h
    join public.fiscal_documents f on f.id=h.fiscal_document_id
    where h.dispatch_stop_id=_stop_id and (h.tenant_id is distinct from v_stop.tenant_id or h.outcome is distinct from f.status)) then
    raise exception 'Histórico da nota diverge do estado atual; solicite revisão à operação' using errcode='23514';end if;
  select coalesce(array_agg(distinct f.id),array[]::uuid[]) into v_preserved
    from public.dispatch_stop_documents d join public.fiscal_documents f on f.id=d.fiscal_document_id
    where d.dispatch_stop_id=_stop_id and d.tenant_id=v_stop.tenant_id
      and f.status in('delivered','returned','refused','partial_delivery','failed','cancelled','not_delivered')
      and exists(select 1 from public.delivery_document_outcomes h where h.dispatch_stop_id=_stop_id
        and h.fiscal_document_id=f.id and h.tenant_id=v_stop.tenant_id and h.outcome=f.status);
  if exists(select 1 from jsonb_object_keys(v_items) k join public.load_items li on li.id::text=k
    join public.delivery_document_outcomes h on h.fiscal_document_id=li.fiscal_document_id
    where h.dispatch_stop_id=_stop_id) then
    raise exception 'Itens com resultado já registrado não podem ser devolvidos novamente' using errcode='23514';end if;
  for v_item in select key,value from jsonb_each(v_items) loop
    if v_item.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_item.value)<>'number' then raise exception 'Item devolvido inválido' using errcode='22023'; end if;
    select li.quantity into v_quantity from public.load_items li
      where li.id=v_item.key::uuid and li.tenant_id=v_stop.tenant_id and exists(select 1 from public.dispatch_stop_documents d
        where d.dispatch_stop_id=_stop_id and d.tenant_id=v_stop.tenant_id and d.fiscal_document_id=li.fiscal_document_id) for share;
    if not found or v_quantity is null or (v_item.value::text)::numeric<=0 or (v_item.value::text)::numeric>v_quantity then
      raise exception 'Quantidade devolvida fora dos itens desta parada' using errcode='22023'; end if;
    v_returned:=v_returned+(v_item.value::text)::numeric;
  end loop;
  if _outcome in('delivered','failed','skipped','cancelled') and v_returned>0 then
    raise exception 'Resultado incompatível com itens devolvidos' using errcode='22023'; end if;
  if _outcome='partial_delivery' then
    select sum(li.quantity) into v_total from public.load_items li where li.tenant_id=v_stop.tenant_id
      and not(li.fiscal_document_id=any(v_preserved)) and exists(
      select 1 from public.dispatch_stop_documents d where d.dispatch_stop_id=_stop_id and d.fiscal_document_id=li.fiscal_document_id and d.tenant_id=v_stop.tenant_id);
    if v_returned<=0 or v_total is null or v_returned>=v_total then
      raise exception 'Entrega parcial exige quantidade devolvida menor que o total' using errcode='22023'; end if;
  end if;
  if _outcome in('returned','refused') and v_returned>0 then
    if exists(select 1 from public.load_items li where not(li.fiscal_document_id=any(v_preserved)) and exists(select 1 from public.dispatch_stop_documents d
      where d.dispatch_stop_id=_stop_id and d.fiscal_document_id=li.fiscal_document_id)
      and (li.quantity is null or li.quantity<=0 or coalesce((v_items->>li.id::text)::numeric,0)<>li.quantity)) then
      raise exception 'Devolução total exige todos os itens, ou apenas o motivo quando não detalhados' using errcode='22023'; end if;
  end if;
  select case when count(*)=1 then (array_agg(load_id))[1] end into v_single_load
    from public.dispatch_trip_loads where dispatch_trip_id=v_trip.id and tenant_id=v_stop.tenant_id;
  select array_agg(distinct fiscal_document_id) into v_docs from public.dispatch_stop_documents
    where dispatch_stop_id=_stop_id and tenant_id=v_stop.tenant_id;
  select array_agg(distinct coalesce(d.load_id,f.load_id,v_single_load)) filter(where coalesce(d.load_id,f.load_id,v_single_load) is not null)
    into v_loads from public.dispatch_stop_documents d join public.fiscal_documents f on f.id=d.fiscal_document_id
    where d.dispatch_stop_id=_stop_id and d.tenant_id=v_stop.tenant_id;
  if v_loads is null and v_single_load is not null then v_loads:=array[v_single_load]; end if;
  -- Route the operational message before trip closure; the occurrence API requires an active trip.
  v_occurrence:=public.driver_create_operational_occurrence(v_trip.id,_outcome,
    coalesce(v_notes,'Entrega concluída por ' || v_receiver),case when _outcome='delivered' then 'low' else 'medium' end,_stop_id,null);
  update public.operational_events set
    load_id=case when cardinality(v_loads)=1 then v_loads[1] else null end,
    report_details=v_details || jsonb_build_object('label',coalesce(_details->>'event_label',_outcome),
      'has_photo',jsonb_array_length(v_photos)>0,'has_signature',v_signature is not null,'stop_name',v_stop.destination),
    payload=payload || jsonb_build_object('delivery_outcome',_outcome,'document_ids',coalesce(to_jsonb(v_docs),'[]'::jsonb),
      'load_ids',coalesce(to_jsonb(v_loads),'[]'::jsonb))
    where id=v_occurrence and tenant_id=v_stop.tenant_id;
  insert into public.dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,notes,payload,created_by,event_at)
    values(v_stop.tenant_id,v_trip.id,_stop_id,case when _outcome='delivered' then 'delivery_delivered' else 'stop_'||_outcome end,
      v_notes,v_details || jsonb_build_object('source','driver_app','client_event_id',_client_event_id,'delivery_request',v_request,'operational_event_id',v_occurrence),
      auth.uid(),clock_timestamp()) returning id into v_event;
  for v_fd in select f.id,coalesce(d.load_id,f.load_id,v_single_load) load_id,f.status from public.dispatch_stop_documents d
    join public.fiscal_documents f on f.id=d.fiscal_document_id
    where d.dispatch_stop_id=_stop_id and d.tenant_id=v_stop.tenant_id order by f.id loop
    -- Operation can confirm notes individually. Preserve those canonical results
    -- and proofs while the driver confirms only the remaining cargo.
    if v_fd.id=any(v_preserved) then continue;end if;
    v_doc_outcome:=case when _outcome='skipped' then 'not_delivered' else _outcome end;
    if _outcome='partial_delivery' then
      select sum(li.quantity),sum(coalesce((v_items->>li.id::text)::numeric,0)) into v_doc_total,v_doc_returned
        from public.load_items li where li.fiscal_document_id=v_fd.id and li.tenant_id=v_stop.tenant_id;
      if v_doc_total is null or v_doc_total<=0 or exists(select 1 from public.load_items
        where fiscal_document_id=v_fd.id and (quantity is null or quantity<=0)) then
        raise exception 'Documento sem quantidades confiáveis para entrega parcial' using errcode='23514'; end if;
      v_doc_outcome:=case when v_doc_returned=0 then 'delivered' when v_doc_returned=v_doc_total then 'returned' else 'partial_delivery' end;
    end if;
    if v_fd.status in('delivered','returned','refused','partial_delivery','failed','cancelled','not_delivered') and v_fd.status<>v_doc_outcome then
      raise exception 'Documento possui resultado final divergente' using errcode='23514'; end if;
    if v_doc_outcome in('delivered','partial_delivery') then
      insert into public.proof_of_delivery as pod(tenant_id,fiscal_document_id,load_id,dispatch_trip_id,dispatch_stop_id,
        proof_type,status,storage_bucket,storage_path,receiver_name,receiver_document,receiver_role,received_at,metadata,created_by)
      values(v_stop.tenant_id,v_fd.id,v_fd.load_id,v_trip.id,_stop_id,'receiver_confirmation','uploaded','receipts',v_signature,
        v_receiver,nullif(btrim(_details->>'receiver_document'),''),nullif(btrim(_details->>'receiver_role'),''),clock_timestamp(),
        jsonb_build_object('photo_paths',v_photos,'signature_path',v_signature,'event_id',v_event,'outcome',v_doc_outcome),auth.uid())
      on conflict(fiscal_document_id) do update set
        load_id=excluded.load_id,dispatch_trip_id=excluded.dispatch_trip_id,dispatch_stop_id=excluded.dispatch_stop_id,
        proof_type=excluded.proof_type,status=excluded.status,storage_bucket=excluded.storage_bucket,storage_path=excluded.storage_path,
        receiver_name=excluded.receiver_name,receiver_document=excluded.receiver_document,receiver_role=excluded.receiver_role,
        received_at=excluded.received_at,metadata=excluded.metadata,created_by=excluded.created_by,updated_at=clock_timestamp()
      where pod.tenant_id=excluded.tenant_id and pod.status in('pending','missing')
        and (pod.dispatch_trip_id is null or pod.dispatch_trip_id=excluded.dispatch_trip_id)
        and (pod.dispatch_stop_id is null or pod.dispatch_stop_id=excluded.dispatch_stop_id)
        and pod.storage_path is null and pod.photo_url is null and pod.signature_url is null and pod.received_at is null
        and pod.metadata='{}'::jsonb
      returning id into v_pod;
      if not found then raise exception 'Comprovante existente exige revisão; não será sobrescrito' using errcode='23514'; end if;
      v_pods:=array_append(v_pods,v_pod);
    end if;
    v_applied:=array_append(v_applied,v_fd.id);
    update public.fiscal_documents set status=v_doc_outcome,
      updated_at=clock_timestamp() where id=v_fd.id and tenant_id=v_stop.tenant_id;
    perform public._log_entity_audit(v_stop.tenant_id,'fiscal_document',v_fd.id,'status_change_by_driver',
      jsonb_build_object('status',v_fd.status),jsonb_build_object('status',v_doc_outcome,'stop_id',_stop_id),'delivery_outcome');
  end loop;
  v_stop_outcome:=_outcome;
  if cardinality(v_preserved)>0 then
    select public._delivery_result_from_statuses(array_agg(case when f.status='not_delivered' then 'failed' else f.status end))
      into v_stop_outcome from public.dispatch_stop_documents d join public.fiscal_documents f on f.id=d.fiscal_document_id
      where d.dispatch_stop_id=_stop_id;
    if v_stop_outcome is null then raise exception 'Parada ainda possui notas sem resultado' using errcode='23514';end if;
    update public.operational_events set payload=payload||jsonb_build_object('delivery_outcome',v_stop_outcome,
      'preserved_document_ids',to_jsonb(v_preserved),'applied_document_ids',to_jsonb(v_applied)) where id=v_occurrence;
  end if;
  update public.dispatch_stops set status=v_stop_outcome,notes=coalesce(v_notes,notes),
    actual_departure_at=case when actual_arrival_at is not null then coalesce(actual_departure_at,clock_timestamp()) else actual_departure_at end,
    updated_at=clock_timestamp() where id=_stop_id and tenant_id=v_stop.tenant_id;
  perform public._log_entity_audit(v_stop.tenant_id,'dispatch_stop',_stop_id,'status_change',
    jsonb_build_object('status',v_stop.status),jsonb_build_object('status',v_stop_outcome,'event_id',v_event),'delivery_outcome');
  perform public._derive_driver_delivery_result(v_stop.tenant_id,v_trip.id);
  v_result:=jsonb_build_object('event_id',v_event,'operational_event_id',v_occurrence,'pod_ids',to_jsonb(v_pods),
    'updated_stop_id',_stop_id,'updated_document_ids',coalesce(to_jsonb(v_docs),'[]'::jsonb),
    'updated_load_ids',coalesce(to_jsonb(v_loads),'[]'::jsonb),
    'preserved_document_ids',to_jsonb(v_preserved),'applied_document_ids',to_jsonb(v_applied),'stop_outcome',v_stop_outcome,
    'trip_completed',(select status='completed' from public.dispatch_trips where id=v_trip.id),'replayed',false);
  update public.dispatch_events set event_type=case when v_stop_outcome='delivered' then 'delivery_delivered' else 'stop_'||v_stop_outcome end,
    payload=payload || jsonb_build_object('delivery_result',v_result,'actual_stop_outcome',v_stop_outcome) where id=v_event;
  return v_result;
end;
$fn$;
revoke all on function public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text) to authenticated,service_role;
