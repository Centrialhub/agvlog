-- LOCAL CANDIDATE: a prerequisite for audited correction/redelivery, not its release.
-- Keep old proof IDs/files; a retired proof cannot become the current receipt again.
set local lock_timeout='3s';
set local statement_timeout='30s';
do $reader_preflight$
declare c record;target oid;
begin
 for c in select * from(values
  ('get_client_portal_summary','2f0f470b07475e05a9687582c8500f15'),
  ('search_client_portal_shipments','d6ef67f31e8ccd2a6b5ae939519f2bb2'),
  ('list_client_documents','3707daa3148d22bb3044f4e941d4d7c2'),
  ('get_public_shipment_status','2f251dbb3f4dda03ec638c022fded049'),
  ('get_client_portal_summary_v2','141d7030a6636a721081af88973ff205'),
  ('get_client_portal_upcoming_deliveries','d4b96afa32d51c1330cc6abdba10022d'),
  ('get_client_portal_alerts','3458148e8b3d66a3445166f93895b5bf'),
  ('get_client_portal_reports_summary','4b8c58a5d93a866a019733ce95d62f28'),
  ('get_client_portal_tracking','d97b3cb48552a6858ca579f0cbaa912d'),
  ('list_client_documents_v2','ac8d7cddf567b89f82f260133acd9b43'),
  ('search_client_portal_shipments_v2','78183de6e748ecdd9b7d02f7349d5e43'),
  ('get_client_portal_reports_summary_v2','6958030dbe5b07592679aef32265acce'),
  ('list_client_pods','f9fac858c0451964c619050fc396853b'),
  ('list_client_pods_v2','de372961a7fd6d4c84e346fa12b43d33'),
  ('get_client_portal_shipment_detail','600316cd5ffc139d090bad7da3a7ebc1'),
  ('get_client_portal_shipment_detail_v2','7411ddff12475ee87930b317353db426'),
  ('_operation_document_context','dd57aa341cb02a3358258097408fdfb3')
 ) expected(name,hash) loop
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=c.name)<>1 then
   raise exception 'Proof reader missing or overloaded: %',c.name;end if;
  select p.oid into target from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=c.name;
  if md5(replace(pg_get_functiondef(target),E'\r\n',E'\n')) is distinct from c.hash then
   raise exception 'Proof reader changed: %',c.name;end if;
 end loop;
end;
$reader_preflight$;
do $preflight$
begin
 if to_regclass('public.delivery_document_outcomes') is null
  or md5(replace(pg_get_functiondef(to_regprocedure('public.record_operation_document_outcome(jsonb)')),E'\r\n',E'\n')) is distinct from '11ae3f47818aaf4a239279ab33926b4f'
  or md5(replace(pg_get_functiondef(to_regprocedure('public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)')),E'\r\n',E'\n')) is distinct from '6664818c64d992c324fa57bc2cdfd535' then
  raise exception 'Proof versioning requires the verified operational outcome contract';end if;
 if to_regclass('public.current_delivery_proofs') is not null
  or exists(select 1 from pg_attribute where attrelid='public.proof_of_delivery'::regclass and attname='retired_event_id' and not attisdropped)
  or not exists(select 1 from pg_constraint where conrelid='public.proof_of_delivery'::regclass and conname='uq_pod_fiscal_document'
   and contype='u' and pg_get_constraintdef(oid)='UNIQUE (fiscal_document_id)')
  or not exists(select 1 from pg_attribute where attrelid='public.proof_of_delivery'::regclass and attname='version' and attnotnull and atttypid='integer'::regtype)
  or not exists(select 1 from pg_attribute where attrelid='public.proof_of_delivery'::regclass and attname='is_active' and attnotnull and atttypid='boolean'::regtype)
  or exists(select 1 from public.proof_of_delivery where version<1) then
  raise exception 'Proof versioning preflight refused: unexpected evidence schema';end if;
end;
$preflight$;

alter table public.proof_of_delivery drop constraint uq_pod_fiscal_document;
alter table public.proof_of_delivery
 add column retired_event_id uuid references public.dispatch_events(id),
 add column retired_at timestamptz,
 add constraint proof_version_positive check(version>0),
 add constraint proof_retirement_pair check((retired_event_id is null)=(retired_at is null)),
 add constraint proof_retired_not_active check(retired_event_id is null or not is_active),
 add constraint proof_document_version_unique unique(tenant_id,fiscal_document_id,version);
create unique index proof_one_active_document_idx on public.proof_of_delivery(fiscal_document_id) where is_active;
create index proof_retired_event_idx on public.proof_of_delivery(retired_event_id) where retired_event_id is not null;
-- Functions own writes; public clients cannot invent versions or overwrite evidence.
revoke insert,update,delete,truncate,references,trigger on public.proof_of_delivery from public,anon,authenticated;

create view public.current_delivery_proofs with(security_invoker=true) as
 select p.* from public.proof_of_delivery p join public.fiscal_documents f
  on f.id=p.fiscal_document_id and f.tenant_id=p.tenant_id
 where p.is_active and f.deleted_at is null and (p.load_id is null or p.load_id=f.load_id);
create view public.available_delivery_proofs with(security_invoker=true) as
 select * from public.current_delivery_proofs where status in('uploaded','validated')
  and nullif(btrim(storage_path),'') is not null;
revoke all on public.current_delivery_proofs,public.available_delivery_proofs from public,anon,authenticated,service_role;

create function public._preserve_retired_delivery_proof() returns trigger
language plpgsql security invoker set search_path='' as $fn$
begin
 if tg_op='DELETE' then raise exception 'Delivery proof evidence cannot be deleted; retire it with an audited event' using errcode='55000';end if;
 if not old.is_active then raise exception 'Retired delivery proof evidence is immutable' using errcode='55000';end if;
 if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
  or new.fiscal_document_id is distinct from old.fiscal_document_id or new.version is distinct from old.version then
  raise exception 'Delivery proof identity is immutable' using errcode='55000';end if;
 if not new.is_active then
  if new.retired_event_id is null or new.retired_at is null
   or (to_jsonb(new)-array['is_active','retired_event_id','retired_at','updated_at']) is distinct from
      (to_jsonb(old)-array['is_active','retired_event_id','retired_at','updated_at']) then
   raise exception 'Proof retirement must preserve original evidence' using errcode='55000';end if;
  if not exists(select 1 from public.dispatch_events e where e.id=new.retired_event_id and e.tenant_id=old.tenant_id
    and e.created_by=auth.uid() and e.payload->>'document_id'=old.fiscal_document_id::text
    and e.payload->>'source'='operation' and e.event_type in('operation_document_correction','redelivery_requested')
    and length(btrim(e.notes))>=5 and e.dispatch_stop_id is not distinct from old.dispatch_stop_id
    and e.dispatch_trip_id is not distinct from old.dispatch_trip_id) then
   raise exception 'Proof retirement requires its own authorized correction event' using errcode='42501';end if;
 elsif new.retired_event_id is not null or new.retired_at is not null then
  raise exception 'Active proof cannot have a retirement event' using errcode='23514';
 end if;
 return new;
end;
$fn$;
revoke all on function public._preserve_retired_delivery_proof() from public,anon,authenticated,service_role;
create trigger preserve_retired_delivery_proof before update or delete on public.proof_of_delivery
 for each row execute function public._preserve_retired_delivery_proof();

create function public._prepare_delivery_proof(_tenant uuid,_document uuid,_trip uuid,_stop uuid)
returns uuid language plpgsql security invoker set search_path='' as $fn$
declare f public.fiscal_documents%rowtype;p public.proof_of_delivery%rowtype;v_version integer;v_id uuid;
begin
 -- The caller owns the trip graph first; the document lock also serializes versions.
 select * into f from public.fiscal_documents where id=_document and tenant_id=_tenant for update;
 if not found or f.load_id is null or f.document_type is distinct from 'inbound' or f.deleted_at is not null
  or not exists(select 1 from public.dispatch_stops s join public.dispatch_stop_documents d on d.dispatch_stop_id=s.id
   join public.dispatch_trip_loads l on l.dispatch_trip_id=s.dispatch_trip_id and l.load_id=f.load_id and l.tenant_id=_tenant
   where s.id=_stop and s.dispatch_trip_id=_trip and s.tenant_id=_tenant and d.tenant_id=_tenant
    and d.fiscal_document_id=f.id and coalesce(d.load_id,f.load_id)=f.load_id) then
  raise exception 'Invalid current proof allocation' using errcode='23514';end if;
 perform id from public.proof_of_delivery where fiscal_document_id=_document order by id for update;
 if exists(select 1 from public.proof_of_delivery where fiscal_document_id=_document and tenant_id<>_tenant) then
  raise exception 'Proof evidence tenant mismatch' using errcode='23514';end if;
 select * into p from public.proof_of_delivery where fiscal_document_id=_document and is_active;
 if found then
  if p.status not in('pending','missing') or p.storage_path is not null or p.photo_url is not null or p.signature_url is not null
    or p.received_at is not null or p.metadata<>'{}'::jsonb
    or p.dispatch_trip_id is not null and p.dispatch_trip_id<>_trip
    or p.dispatch_stop_id is not null and p.dispatch_stop_id<>_stop
    or p.load_id is not null and p.load_id<>f.load_id then
   raise exception 'Comprovante existente exige revisão; não será sobrescrito' using errcode='23514';end if;
  return p.id;
 end if;
 select coalesce(max(version),0)+1 into v_version from public.proof_of_delivery where fiscal_document_id=_document;
 insert into public.proof_of_delivery(tenant_id,fiscal_document_id,load_id,dispatch_trip_id,dispatch_stop_id,
   proof_type,status,version,is_active,created_by)
 values(_tenant,_document,f.load_id,_trip,_stop,'receiver_confirmation','pending',v_version,true,auth.uid()) returning id into v_id;
 return v_id;
end;
$fn$;
revoke all on function public._prepare_delivery_proof(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public._retire_delivery_proof(_tenant uuid,_document uuid,_event uuid)
returns uuid language plpgsql security invoker set search_path='' as $fn$
declare p public.proof_of_delivery%rowtype;e public.dispatch_events%rowtype;
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant),false) then
  raise exception 'not_authorized' using errcode='42501';end if;
 perform tenant_id from public.tenant_memberships where tenant_id=_tenant and user_id=auth.uid() and active
  and role::text in('owner','admin','operator') for share nowait;
 if not found then raise exception 'not_authorized' using errcode='42501';end if;
 perform id from public.fiscal_documents where id=_document and tenant_id=_tenant for update;
 if not found then raise exception 'Proof document not found' using errcode='23514';end if;
 select * into e from public.dispatch_events where id=_event and tenant_id=_tenant;
 if not found or e.created_by is distinct from auth.uid() or e.payload->>'document_id' is distinct from _document::text
  or e.payload->>'source' is distinct from 'operation' or e.event_type not in('operation_document_correction','redelivery_requested')
  or coalesce(length(btrim(e.notes)),0)<5 then raise exception 'Invalid proof retirement event' using errcode='42501';end if;
 select * into p from public.proof_of_delivery where fiscal_document_id=_document and tenant_id=_tenant and is_active for update;
 if not found then return null;end if;
 update public.proof_of_delivery set is_active=false,retired_event_id=e.id,retired_at=clock_timestamp(),updated_at=clock_timestamp()
 where id=p.id;
 return p.id;
end;
$fn$;
revoke all on function public._retire_delivery_proof(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- VERSION-AWARE WRITERS AND READERS. Rollout QA remains required.
create or replace function public._operation_document_context(_tenant uuid,_load uuid,_document uuid)
returns jsonb language sql stable security invoker set search_path=''
as $fn$
 select jsonb_build_object('tenant_id',f.tenant_id,'load_id',l.id,'document_id',f.id,'document_status',f.status,
  'delivery_meta',f.delivery_meta,'trip_id',t.id,'trip_status',t.status,'actual_start_at',t.actual_start_at,
  'stops',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'destination',s.destination,
   'actual_arrival_at',s.actual_arrival_at,'actual_departure_at',s.actual_departure_at) order by s.id)
   from public.dispatch_stops s join public.dispatch_stop_documents d on d.dispatch_stop_id=s.id
   where d.fiscal_document_id=f.id and d.load_id=l.id and d.tenant_id=_tenant and s.dispatch_trip_id=t.id),'[]'::jsonb),
  'proofs',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'status',p.status,'updated_at',p.updated_at) order by p.id)
   from public.current_delivery_proofs p where p.fiscal_document_id=f.id and p.tenant_id=_tenant),'[]'::jsonb),
  'history',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'source',h.source,'outcome',h.outcome,
   'occurred_at',h.occurred_at,'recorded_at',h.recorded_at,'reason',h.reason) order by h.recorded_at,h.id)
   from public.delivery_document_outcomes h where h.fiscal_document_id=f.id and h.tenant_id=_tenant),'[]'::jsonb))
 from public.fiscal_documents f join public.loads l on l.id=f.load_id and l.tenant_id=f.tenant_id
 left join public.dispatch_trips t on t.id=l.trip_id and t.tenant_id=l.tenant_id
 where f.id=_document and f.tenant_id=_tenant and l.id=_load and f.document_type='inbound' and f.deleted_at is null;
$fn$;

create or replace function public.record_operation_document_outcome(_payload jsonb)
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
 if exists(select 1 from public.proof_of_delivery where fiscal_document_id=v_doc and (tenant_id<>v_tenant or (is_active and (status not in('pending','missing')
  or storage_path is not null or photo_url is not null or signature_url is not null or received_at is not null or metadata<>'{}'::jsonb
  or dispatch_stop_id is not null and dispatch_stop_id<>v_stop or dispatch_trip_id is not null and dispatch_trip_id<>v_trip)))) then
  raise exception 'operation_outcome_proof_requires_review' using errcode='23514';end if;
 insert into public.dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,notes,payload,created_by,event_at)
  values(v_tenant,v_trip,v_stop,'operation_document_outcome',v_reason,jsonb_build_object('source','operation','document_id',v_doc,
   'outcome',v_outcome,'occurred_at',v_time,'request_id',v_request,'manual_attestation',true),v_actor,clock_timestamp()) returning id into v_event;
 if v_outcome='delivered' then
  v_pod:=public._prepare_delivery_proof(v_tenant,v_doc,v_trip,v_stop);
  update public.proof_of_delivery set load_id=v_load,dispatch_trip_id=v_trip,dispatch_stop_id=v_stop,
   proof_type='manual_receipt',status='pending',receiver_name=v_receiver,
   metadata=jsonb_build_object('source','operation','manual_attestation',true,'attested_at',v_time,'event_id',v_event,'reason',v_reason),
   created_by=v_actor,updated_at=clock_timestamp() where id=v_pod;
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
      v_pod:=public._prepare_delivery_proof(v_stop.tenant_id,v_fd.id,v_trip.id,_stop_id);
      update public.proof_of_delivery set load_id=v_fd.load_id,dispatch_trip_id=v_trip.id,dispatch_stop_id=_stop_id,
       proof_type='receiver_confirmation',status='uploaded',storage_bucket='receipts',storage_path=v_signature,
       receiver_name=v_receiver,receiver_document=nullif(btrim(_details->>'receiver_document'),''),
       receiver_role=nullif(btrim(_details->>'receiver_role'),''),received_at=clock_timestamp(),
       metadata=jsonb_build_object('photo_paths',v_photos,'signature_path',v_signature,'event_id',v_event,'outcome',v_doc_outcome),
       created_by=auth.uid(),updated_at=clock_timestamp() where id=v_pod;
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

CREATE OR REPLACE FUNCTION public.get_client_portal_summary(_tenant_id uuid, _start_date date DEFAULT NULL::date, _end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _result jsonb;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.client_portal_access
                WHERE tenant_id=_tenant_id AND user_id=auth.uid() AND active=true) THEN
    RETURN jsonb_build_object('in_transit',0,'delivered',0,'delayed',0,'pending_pickup',0,
      'pending_pod',0,'open_occurrences',0,'deliveries_today',0,'deliveries_tomorrow',0);
  END IF;

  WITH fds AS (
    SELECT fd.* FROM public.fiscal_documents fd
    WHERE fd.tenant_id = _tenant_id
      AND public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
      AND (_start_date IS NULL OR fd.issue_date >= _start_date)
      AND (_end_date   IS NULL OR fd.issue_date <= _end_date)
  )
  SELECT jsonb_build_object(
    'in_transit', (SELECT count(*) FROM fds WHERE status IN ('in_transit','loading','loaded')),
    'delivered',  (SELECT count(*) FROM fds WHERE status = 'delivered'),
    'delayed',    (SELECT count(*) FROM fds fd
                   JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                   JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                   WHERE ds.status IN ('pending','arriving','arrived','in_progress')
                     AND ds.planned_arrival_at < now()),
    'pending_pickup', (SELECT count(DISTINCT po.id) FROM public.pickup_orders po
                       WHERE po.tenant_id = _tenant_id AND po.status IN ('pendente','vinculada')
                         AND public.portal_user_can_access_pickup_order(_tenant_id, po.id)),
    'pending_pod', (SELECT count(*) FROM fds fd WHERE fd.status='delivered'
                    AND NOT EXISTS (SELECT 1 FROM public.available_delivery_proofs p
                                    WHERE p.fiscal_document_id = fd.id AND p.status IN ('uploaded','validated'))),
    'open_occurrences', (SELECT count(*) FROM public.operational_events oe
                         WHERE oe.tenant_id = _tenant_id AND oe.visible_to_client = true
                           AND oe.public_status = 'open'
                           AND public.portal_user_can_access_operational_event(_tenant_id, oe.id)),
    'deliveries_today', (SELECT count(*) FROM fds fd
                          JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                          JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                          WHERE ds.planned_arrival_at::date = CURRENT_DATE),
    'deliveries_tomorrow', (SELECT count(*) FROM fds fd
                             JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                             JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                             WHERE ds.planned_arrival_at::date = CURRENT_DATE + 1)
  ) INTO _result;
  RETURN _result;
END; $function$;

CREATE OR REPLACE FUNCTION public.search_client_portal_shipments(_tenant_id uuid, _search text DEFAULT NULL::text, _status text[] DEFAULT NULL::text[], _start_date date DEFAULT NULL::date, _end_date date DEFAULT NULL::date, _city text DEFAULT NULL::text, _state text DEFAULT NULL::text, _has_pod boolean DEFAULT NULL::boolean, _has_occurrence boolean DEFAULT NULL::boolean, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _rows jsonb; _total int; _search_norm text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.client_portal_access
                WHERE tenant_id=_tenant_id AND user_id=auth.uid() AND active=true) THEN
    RETURN jsonb_build_object('rows','[]'::jsonb,'total',0);
  END IF;
  _search_norm := NULLIF(trim(_search), '');

  WITH base AS (
    SELECT fd.id AS fiscal_document_id, fd.tenant_id, fd.client_id,
      fd.invoice_number, fd.access_key, fd.issue_date, fd.document_type,
      fd.status AS document_status, fd.client_load_number, fd.reference_number,
      fd.remitter, fd.remitter_cnpj, fd.recipient, fd.recipient_cnpj,
      fd.recipient_city, fd.recipient_state, fd.recipient_neighborhood,
      fd.product_summary, fd.pallet_count, fd.weight_kg,
      CASE WHEN public.portal_user_can_view_financial(_tenant_id, fd.id) THEN fd.value END AS value,
      CASE WHEN public.portal_user_can_view_financial(_tenant_id, fd.id) THEN fd.freight_value END AS freight_value,
      fd.load_id, fd.pickup_order_id, fd.updated_at,
      l.load_number, l.status AS load_status, l.trip_id,
      ds.id AS dispatch_stop_id, ds.status AS stop_status,
      ds.planned_arrival_at, ds.actual_arrival_at, ds.actual_departure_at,
      EXISTS (SELECT 1 FROM public.available_delivery_proofs p
              WHERE p.fiscal_document_id = fd.id AND p.status IN ('uploaded','validated')) AS has_pod,
      EXISTS (
        SELECT 1 FROM public.operational_events oe
        WHERE oe.tenant_id = _tenant_id AND oe.visible_to_client = true AND oe.public_status = 'open'
          AND (
            oe.fiscal_document_id = fd.id
            OR oe.dispatch_stop_id IN (SELECT dsd.dispatch_stop_id FROM public.dispatch_stop_documents dsd WHERE dsd.fiscal_document_id = fd.id)
            OR (oe.client_id IS NOT NULL AND oe.client_id = fd.client_id
                AND (oe.fiscal_document_id IS NULL OR oe.fiscal_document_id = fd.id))
          )
      ) AS has_open_occurrence,
      public.get_public_shipment_status(fd.id) AS public_status
    FROM public.fiscal_documents fd
    LEFT JOIN public.loads l ON l.id = fd.load_id
    LEFT JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
    LEFT JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
    WHERE fd.tenant_id = _tenant_id
      AND public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
      AND (_start_date IS NULL OR fd.issue_date >= _start_date)
      AND (_end_date   IS NULL OR fd.issue_date <= _end_date)
      AND (_city  IS NULL OR fd.recipient_city  ILIKE _city)
      AND (_state IS NULL OR fd.recipient_state ILIKE _state)
      AND (_status IS NULL OR fd.status = ANY(_status))
      AND ( _search_norm IS NULL
            OR fd.invoice_number ILIKE '%' || _search_norm || '%'
            OR fd.access_key ILIKE '%' || _search_norm || '%'
            OR fd.client_load_number ILIKE '%' || _search_norm || '%'
            OR fd.reference_number ILIKE '%' || _search_norm || '%'
            OR fd.recipient ILIKE '%' || _search_norm || '%'
            OR fd.recipient_cnpj ILIKE '%' || _search_norm || '%'
            OR fd.recipient_city ILIKE '%' || _search_norm || '%'
            OR COALESCE(l.load_number,'') ILIKE '%' || _search_norm || '%' )
  ),
  filtered AS (
    SELECT * FROM base
    WHERE (_has_pod IS NULL OR has_pod = _has_pod)
      AND (_has_occurrence IS NULL OR has_open_occurrence = _has_occurrence)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.issue_date DESC NULLS LAST, f.updated_at DESC), '[]'::jsonb),
         (SELECT count(*) FROM filtered)
  INTO _rows, _total
  FROM (SELECT * FROM filtered ORDER BY issue_date DESC NULLS LAST, updated_at DESC
        LIMIT _limit OFFSET _offset) f;

  RETURN jsonb_build_object('rows', _rows, 'total', _total);
END; $function$;

CREATE OR REPLACE FUNCTION public.list_client_documents(_tenant_id uuid, _document_type text DEFAULT NULL::text, _search text DEFAULT NULL::text, _start_date date DEFAULT NULL::date, _end_date date DEFAULT NULL::date, _limit integer DEFAULT 100, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, document_type text, invoice_number text, access_key text, issue_date date, remitter text, recipient text, recipient_city text, recipient_state text, value numeric, weight_kg numeric, status text, load_id uuid, client_id uuid, has_pod boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT fd.id, fd.document_type, fd.invoice_number, fd.access_key, fd.issue_date,
    fd.remitter, fd.recipient, fd.recipient_city, fd.recipient_state,
    CASE WHEN public.portal_user_can_view_financial(_tenant_id, fd.id) THEN fd.value END,
    fd.weight_kg, fd.status, fd.load_id, fd.client_id,
    EXISTS(SELECT 1 FROM public.available_delivery_proofs pod WHERE pod.fiscal_document_id = fd.id)
  FROM public.fiscal_documents fd
  WHERE fd.tenant_id = _tenant_id
    AND public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
    AND (_document_type IS NULL OR fd.document_type = _document_type)
    AND (_start_date IS NULL OR fd.issue_date >= _start_date)
    AND (_end_date   IS NULL OR fd.issue_date <= _end_date)
    AND (_search IS NULL OR (
      fd.invoice_number ILIKE '%' || _search || '%'
      OR fd.access_key  ILIKE '%' || _search || '%'
      OR fd.remitter    ILIKE '%' || _search || '%'
      OR fd.recipient   ILIKE '%' || _search || '%'
    ))
  ORDER BY fd.issue_date DESC NULLS LAST, fd.created_at DESC
  LIMIT _limit OFFSET _offset;
$function$;

CREATE OR REPLACE FUNCTION public.get_public_shipment_status(_fiscal_document_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fd_status text; v_load_status text; v_stop_status text;
  v_has_pod boolean; v_has_critical_occ boolean;
  v_tenant uuid; v_client uuid; v_load uuid;
BEGIN
  SELECT fd.status, l.status, fd.tenant_id, fd.client_id, fd.load_id
    INTO v_fd_status, v_load_status, v_tenant, v_client, v_load
  FROM public.fiscal_documents fd
  LEFT JOIN public.loads l ON l.id = fd.load_id
  WHERE fd.id = _fiscal_document_id;

  SELECT ds.status INTO v_stop_status
  FROM public.dispatch_stop_documents dsd
  JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
  WHERE dsd.fiscal_document_id = _fiscal_document_id
  ORDER BY ds.updated_at DESC NULLS LAST LIMIT 1;

  SELECT EXISTS(SELECT 1 FROM public.available_delivery_proofs
    WHERE fiscal_document_id = _fiscal_document_id AND status IN ('uploaded','validated'))
    INTO v_has_pod;

  -- Ocorrência crítica vinculada à NF, à parada que contém a NF, ou ao cliente da NF (visível)
  SELECT EXISTS(
    SELECT 1 FROM public.operational_events oe
    WHERE oe.tenant_id = v_tenant
      AND oe.visible_to_client = true
      AND oe.public_status = 'open'
      AND oe.severity IN ('high','critical')
      AND (
        oe.fiscal_document_id = _fiscal_document_id
        OR oe.dispatch_stop_id IN (
          SELECT dsd.dispatch_stop_id FROM public.dispatch_stop_documents dsd
          WHERE dsd.fiscal_document_id = _fiscal_document_id
        )
        OR (oe.client_id IS NOT NULL AND oe.client_id = v_client
            AND (oe.fiscal_document_id IS NULL OR oe.fiscal_document_id = _fiscal_document_id))
      )
  ) INTO v_has_critical_occ;

  IF v_has_critical_occ THEN RETURN 'exception'; END IF;
  IF v_fd_status = 'refused' THEN RETURN 'not_delivered'; END IF;
  IF v_fd_status = 'returned' THEN RETURN 'returned'; END IF;
  IF v_fd_status IN ('failed','not_delivered') THEN RETURN 'not_delivered'; END IF;
  IF v_fd_status = 'partial_delivery' THEN RETURN 'exception'; END IF;
  IF v_fd_status = 'cancelled' THEN RETURN 'cancelled'; END IF;
  IF v_fd_status = 'delivered' THEN
    RETURN CASE WHEN v_has_pod THEN 'pod_available' ELSE 'pod_pending' END;
  END IF;
  IF v_stop_status IN ('arrived','servicing','in_progress') THEN RETURN 'arrived_at_destination'; END IF;
  IF v_stop_status = 'departed' THEN RETURN 'out_for_delivery'; END IF;
  IF v_load_status = 'in_transit' OR v_fd_status = 'in_transit' THEN RETURN 'in_transit'; END IF;
  IF v_load_status IN ('loading','loaded') OR v_fd_status IN ('loading','loaded') THEN RETURN 'loaded'; END IF;
  IF v_load_status IN ('planned','assembling','ready') THEN RETURN 'being_prepared'; END IF;
  IF v_fd_status IN ('confirmed','assigned','pending') THEN RETURN 'received'; END IF;
  RETURN COALESCE(v_fd_status, 'received');
END $function$;

CREATE OR REPLACE FUNCTION public.get_client_portal_summary_v2(_tenant_id uuid, _client_id uuid DEFAULT NULL::uuid, _start_date date DEFAULT NULL::date, _end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _client_ids uuid[];
  _result jsonb;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT client_id), ARRAY[]::uuid[])
  INTO _client_ids
  FROM public.client_portal_access
  WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true
    AND (_client_id IS NULL OR client_id = _client_id);

  IF array_length(_client_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'in_transit',0,'delivered',0,'delayed',0,
      'pending_pickup',0,'scheduled_pickups',0,
      'pending_pod',0,'open_occurrences',0,
      'client_action_required',0,
      'deliveries_today',0,'deliveries_tomorrow',0,
      'documents_last_7_days',0
    );
  END IF;

  WITH fds AS (
    SELECT fd.* FROM public.fiscal_documents fd
    WHERE fd.tenant_id = _tenant_id AND fd.client_id = ANY(_client_ids)
      AND (_start_date IS NULL OR fd.issue_date >= _start_date)
      AND (_end_date   IS NULL OR fd.issue_date <= _end_date)
  )
  SELECT jsonb_build_object(
    'in_transit', (SELECT count(*) FROM fds WHERE status IN ('in_transit','loading','loaded')),
    'delivered',  (SELECT count(*) FROM fds WHERE status = 'delivered'),
    'delayed', (SELECT count(*) FROM fds fd
                JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                WHERE ds.status IN ('pending','arriving','in_progress')
                  AND ds.planned_arrival_at < now()),
    'pending_pickup', (SELECT count(*) FROM public.pickup_orders po
                       WHERE po.tenant_id = _tenant_id
                         AND po.status IN ('pendente','vinculada')
                         AND po.remitter_client_id = ANY(_client_ids)),
    'scheduled_pickups', (SELECT count(*) FROM public.pickup_orders po
                          WHERE po.tenant_id = _tenant_id
                            AND po.status = 'agendada'
                            AND po.remitter_client_id = ANY(_client_ids)),
    'pending_pod', (SELECT count(*) FROM fds fd
                    WHERE fd.status = 'delivered'
                      AND NOT EXISTS (SELECT 1 FROM public.available_delivery_proofs p
                                      WHERE p.fiscal_document_id = fd.id
                                        AND p.status IN ('uploaded','validated'))),
    'open_occurrences', (SELECT count(*) FROM public.operational_events oe
                         WHERE oe.tenant_id = _tenant_id
                           AND oe.visible_to_client = true
                           AND oe.public_status = 'open'
                           AND oe.client_id = ANY(_client_ids)),
    'client_action_required', (SELECT count(*) FROM public.operational_events oe
                               WHERE oe.tenant_id = _tenant_id
                                 AND oe.visible_to_client = true
                                 AND oe.client_action_required = true
                                 AND oe.public_status <> 'resolved'
                                 AND oe.client_id = ANY(_client_ids)),
    'deliveries_today', (SELECT count(*) FROM fds fd
                         JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                         JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                         WHERE ds.planned_arrival_at::date = CURRENT_DATE),
    'deliveries_tomorrow', (SELECT count(*) FROM fds fd
                            JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                            JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                            WHERE ds.planned_arrival_at::date = CURRENT_DATE + 1),
    'documents_last_7_days', (SELECT count(*) FROM fds WHERE issue_date >= CURRENT_DATE - 7)
  ) INTO _result;

  RETURN _result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_client_portal_upcoming_deliveries(_tenant_id uuid, _client_id uuid DEFAULT NULL::uuid, _limit integer DEFAULT 8)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _client_ids uuid[];
  _can_driver boolean := false;
  _can_vehicle boolean := false;
  _rows jsonb;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT client_id), ARRAY[]::uuid[])
  INTO _client_ids
  FROM public.client_portal_access
  WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true
    AND (_client_id IS NULL OR client_id = _client_id);

  IF array_length(_client_ids, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT bool_or(can_view_driver_contact), bool_or(can_view_vehicle_live)
  INTO _can_driver, _can_vehicle
  FROM public.client_portal_access
  WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true
    AND client_id = ANY(_client_ids);

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO _rows
  FROM (
    SELECT
      fd.id AS fiscal_document_id,
      fd.invoice_number,
      fd.recipient,
      fd.recipient_city,
      fd.recipient_state,
      ds.planned_arrival_at,
      CASE WHEN fd.status = 'delivered' THEN 'delivered'
           WHEN fd.status = 'in_transit' THEN 'in_transit'
           WHEN fd.status IN ('loading','loaded') THEN 'loaded'
           ELSE 'received' END AS public_status,
      EXISTS (SELECT 1 FROM public.operational_events oo
              WHERE oo.load_id = fd.load_id AND oo.visible_to_client = true
                AND oo.public_status = 'open') AS has_open_occurrence,
      EXISTS (SELECT 1 FROM public.available_delivery_proofs p
              WHERE p.fiscal_document_id = fd.id
                AND p.status IN ('uploaded','validated')) AS has_pod,
      l.load_number,
      CASE WHEN _can_driver THEN drv.name END AS driver_name,
      CASE WHEN _can_vehicle THEN v.plate END AS vehicle_plate
    FROM public.fiscal_documents fd
    LEFT JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
    LEFT JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
    LEFT JOIN public.loads l ON l.id = fd.load_id
    LEFT JOIN public.dispatch_trips dt ON dt.id = ds.dispatch_trip_id
    LEFT JOIN public.drivers drv ON drv.id = dt.driver_id
    LEFT JOIN public.vehicles v ON v.id = dt.vehicle_id
    WHERE fd.tenant_id = _tenant_id
      AND fd.client_id = ANY(_client_ids)
      AND fd.status NOT IN ('delivered','cancelled')
      AND (ds.planned_arrival_at IS NULL OR ds.planned_arrival_at >= now() - interval '1 day')
    ORDER BY ds.planned_arrival_at NULLS LAST, fd.updated_at DESC
    LIMIT _limit
  ) t;

  RETURN _rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_client_portal_alerts(_tenant_id uuid, _client_id uuid DEFAULT NULL::uuid, _limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _client_ids uuid[];
  _rows jsonb;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT client_id), ARRAY[]::uuid[])
  INTO _client_ids
  FROM public.client_portal_access
  WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true
    AND (_client_id IS NULL OR client_id = _client_id);

  IF array_length(_client_ids, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH
    delays AS (
      SELECT
        fd.id AS related_id,
        'delay'::text AS type,
        'danger'::text AS severity,
        ('Entrega atrasada: NF ' || COALESCE(fd.invoice_number,'—')) AS title,
        ('Prevista para ' || to_char(ds.planned_arrival_at AT TIME ZONE 'America/Sao_Paulo','DD/MM HH24:MI')) AS description,
        'fiscal_document'::text AS related_type,
        fd.id::text AS fiscal_document,
        NULL::text AS pickup_order,
        NULL::text AS operational_event,
        NULL::text AS proof_of_delivery,
        ds.planned_arrival_at AS created_at,
        'Ver mercadoria'::text AS action_label,
        ('/portal/shipments/' || fd.id::text) AS action_url
      FROM public.fiscal_documents fd
      JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
      JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
      WHERE fd.tenant_id = _tenant_id
        AND fd.client_id = ANY(_client_ids)
        AND ds.status IN ('pending','arriving','in_progress')
        AND ds.planned_arrival_at < now()
    ),
    occs AS (
      SELECT
        oe.id AS related_id,
        CASE WHEN oe.client_action_required THEN 'client_action'::text ELSE 'occurrence'::text END AS type,
        CASE WHEN oe.severity IN ('critical','high') THEN 'danger'::text
             WHEN oe.severity = 'medium' THEN 'warning'::text
             ELSE 'info'::text END AS severity,
        ('Ocorrência: ' || COALESCE(oe.event_type,'—')) AS title,
        COALESCE(oe.description,'') AS description,
        'operational_event'::text AS related_type,
        NULL::text AS fiscal_document,
        NULL::text AS pickup_order,
        oe.id::text AS operational_event,
        NULL::text AS proof_of_delivery,
        oe.created_at,
        'Ver ocorrência'::text AS action_label,
        '/portal/occurrences'::text AS action_url
      FROM public.operational_events oe
      WHERE oe.tenant_id = _tenant_id
        AND oe.client_id = ANY(_client_ids)
        AND oe.visible_to_client = true
        AND oe.public_status IN ('open','in_analysis','client_action_required')
    ),
    pods AS (
      SELECT
        fd.id AS related_id,
        'pod_pending'::text AS type,
        'warning'::text AS severity,
        ('Canhoto pendente: NF ' || COALESCE(fd.invoice_number,'—')) AS title,
        'Entrega concluída, aguardando canhoto.'::text AS description,
        'fiscal_document'::text AS related_type,
        fd.id::text AS fiscal_document,
        NULL::text AS pickup_order,
        NULL::text AS operational_event,
        NULL::text AS proof_of_delivery,
        fd.updated_at AS created_at,
        'Ver mercadoria'::text AS action_label,
        ('/portal/shipments/' || fd.id::text) AS action_url
      FROM public.fiscal_documents fd
      WHERE fd.tenant_id = _tenant_id
        AND fd.client_id = ANY(_client_ids)
        AND fd.status = 'delivered'
        AND NOT EXISTS (SELECT 1 FROM public.available_delivery_proofs p
                        WHERE p.fiscal_document_id = fd.id
                          AND p.status IN ('uploaded','validated'))
    ),
    pickups AS (
      SELECT
        po.id AS related_id,
        'pickup_pending'::text AS type,
        'info'::text AS severity,
        ('Coleta pendente: ' || COALESCE(po.pickup_number, po.id::text)) AS title,
        COALESCE(po.recipient_name, po.notes, '')::text AS description,
        'pickup_order'::text AS related_type,
        NULL::text AS fiscal_document,
        po.id::text AS pickup_order,
        NULL::text AS operational_event,
        NULL::text AS proof_of_delivery,
        po.created_at,
        'Ver coletas'::text AS action_label,
        '/portal/pickups'::text AS action_url
      FROM public.pickup_orders po
      WHERE po.tenant_id = _tenant_id
        AND po.remitter_client_id = ANY(_client_ids)
        AND po.status IN ('pendente','vinculada')
    ),
    unioned AS (
      SELECT * FROM delays
      UNION ALL SELECT * FROM occs
      UNION ALL SELECT * FROM pods
      UNION ALL SELECT * FROM pickups
    )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY
      CASE t.severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 WHEN 'info' THEN 2 ELSE 3 END,
      t.created_at DESC
    ), '[]'::jsonb) INTO _rows
  FROM (SELECT * FROM unioned LIMIT _limit) t;

  RETURN _rows;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_client_portal_reports_summary(_tenant_id uuid, _start_date date DEFAULT NULL::date, _end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_start date := COALESCE(_start_date, (now() - interval '90 days')::date);
  v_end   date := COALESCE(_end_date, now()::date);
BEGIN
  WITH allowed AS (
    SELECT unnest(public._portal_user_client_ids(_tenant_id)) AS client_id
  ),
  fd AS (
    SELECT f.*
    FROM public.fiscal_documents f
    WHERE f.tenant_id = _tenant_id
      AND f.client_id IN (SELECT client_id FROM allowed)
      AND COALESCE(f.issue_date, f.created_at::date) BETWEEN v_start AND v_end
  ),
  by_status AS (
    SELECT COALESCE(status,'sem_status') AS status, count(*)::int AS total
    FROM fd GROUP BY 1
  ),
  delayed AS (
    SELECT count(*)::int AS total
    FROM fd f
    WHERE EXISTS (
      SELECT 1 FROM public.dispatch_stop_documents dsd
      JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
      WHERE dsd.fiscal_document_id = f.id
        AND ds.planned_arrival_at IS NOT NULL
        AND (ds.actual_arrival_at IS NULL AND ds.planned_arrival_at < now()
             OR ds.actual_arrival_at > ds.planned_arrival_at + interval '30 minutes')
    )
  ),
  pending_pods AS (
    SELECT count(*)::int AS total
    FROM fd f
    WHERE f.status IN ('delivered','completed')
      AND NOT EXISTS (SELECT 1 FROM public.available_delivery_proofs pod WHERE pod.fiscal_document_id = f.id)
  ),
  occ_by_type AS (
    SELECT COALESCE(event_type,'outros') AS event_type, count(*)::int AS total
    FROM public.operational_events
    WHERE tenant_id = _tenant_id
      AND client_id IN (SELECT client_id FROM allowed)
      AND (visible_to_client = true OR client_opened = true)
      AND created_at::date BETWEEN v_start AND v_end
    GROUP BY 1
    ORDER BY total DESC
    LIMIT 20
  ),
  pickups_by AS (
    SELECT COALESCE(status,'sem_status') AS status, count(*)::int AS total
    FROM public.pickup_orders
    WHERE tenant_id = _tenant_id
      AND remitter_client_id IN (SELECT client_id FROM allowed)
      AND created_at::date BETWEEN v_start AND v_end
    GROUP BY 1
  ),
  top_cities AS (
    SELECT COALESCE(recipient_city,'—') AS city,
           COALESCE(recipient_state,'') AS state,
           count(*)::int AS total
    FROM fd GROUP BY 1,2 ORDER BY total DESC LIMIT 15
  ),
  avg_time AS (
    SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (ds.actual_arrival_at - COALESCE(dt.actual_start_at, ds.planned_arrival_at))) / 86400.0)::numeric, 2), 0) AS avg_days
    FROM fd f
    JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = f.id
    JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
    LEFT JOIN public.dispatch_trips dt ON dt.id = ds.dispatch_trip_id
    WHERE ds.actual_arrival_at IS NOT NULL
  )
  SELECT jsonb_build_object(
    'period_start', v_start,
    'period_end', v_end,
    'deliveries_total', (SELECT count(*)::int FROM fd),
    'deliveries_by_status',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'total', total)) FROM by_status), '[]'::jsonb),
    'deliveries_delayed', (SELECT total FROM delayed),
    'pending_pods',       (SELECT total FROM pending_pods),
    'occurrences_by_type',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('event_type', event_type, 'total', total)) FROM occ_by_type), '[]'::jsonb),
    'pickups_by_status',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'total', total)) FROM pickups_by), '[]'::jsonb),
    'top_cities',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('city', city, 'state', state, 'total', total)) FROM top_cities), '[]'::jsonb),
    'avg_delivery_days',  (SELECT avg_days FROM avg_time)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_client_portal_tracking(_tenant_id uuid, _client_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_result jsonb;
BEGIN
  PERFORM public._portal_assert_client_access(_tenant_id, _client_id);

  WITH allowed AS (
    SELECT client_id,
           bool_or(can_view_vehicle_live)   AS can_vehicle,
           bool_or(can_view_driver_contact) AS can_driver
    FROM public.client_portal_access
    WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true
      AND (_client_id IS NULL OR client_id = _client_id)
    GROUP BY client_id
  ),
  base AS (
    SELECT DISTINCT
      l.id AS load_id, l.load_number, l.status, l.updated_at,
      fd.client_id, a.can_vehicle, a.can_driver
    FROM public.fiscal_documents fd
    JOIN allowed a ON a.client_id = fd.client_id
    JOIN public.loads l ON l.id = fd.load_id
    WHERE fd.tenant_id = _tenant_id
      AND l.status IN ('planned','in_transit','arrived','loading','out_for_delivery')
  ),
  enriched AS (
    SELECT
      b.*,
      dt.id AS trip_id, dt.vehicle_id, dt.driver_id,
      dt.actual_start_at, dt.planned_end_at,
      v.plate, v.nickname AS vehicle_nickname,
      d.name AS driver_name, d.phone AS driver_phone,
      pl.lat, pl.lng, pl.speed, pl.captured_at,
      (SELECT jsonb_build_object(
          'id', ds.id, 'sequence', ds.stop_order,
          'destination', ds.destination,
          'city', NULL::text, 'state', NULL::text,
          'planned_arrival_at', ds.planned_arrival_at)
        FROM public.dispatch_stops ds
        WHERE ds.dispatch_trip_id = dt.id AND ds.actual_departure_at IS NULL
        ORDER BY ds.stop_order ASC LIMIT 1) AS next_stop,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'fiscal_document_id', fd2.id,
          'invoice_number', fd2.invoice_number,
          'recipient', fd2.recipient,
          'recipient_city', fd2.recipient_city,
          'recipient_state', fd2.recipient_state,
          'public_status', public.get_public_shipment_status(fd2.id),
          'planned_arrival_at', (
             SELECT ds3.planned_arrival_at FROM public.dispatch_stop_documents dsd3
             JOIN public.dispatch_stops ds3 ON ds3.id = dsd3.dispatch_stop_id
             WHERE dsd3.fiscal_document_id = fd2.id LIMIT 1),
          'has_pod', EXISTS(SELECT 1 FROM public.available_delivery_proofs p WHERE p.fiscal_document_id=fd2.id AND p.status IN ('uploaded','validated')),
          'has_open_occurrence', EXISTS(SELECT 1 FROM public.operational_events oe
             WHERE oe.tenant_id=_tenant_id AND oe.visible_to_client=true
               AND oe.public_status='open' AND oe.fiscal_document_id=fd2.id)
        ) ORDER BY fd2.invoice_number), '[]'::jsonb)
       FROM public.fiscal_documents fd2
       WHERE fd2.tenant_id=_tenant_id AND fd2.load_id=b.load_id
         AND fd2.client_id=b.client_id) AS documents
    FROM base b
    LEFT JOIN public.dispatch_trip_loads dtl ON dtl.load_id = b.load_id
    LEFT JOIN public.dispatch_trips dt ON dt.id = dtl.dispatch_trip_id
    LEFT JOIN public.vehicles v ON v.id = dt.vehicle_id
    LEFT JOIN public.drivers d ON d.id = dt.driver_id
    LEFT JOIN public.positions_last pl ON pl.tenant_id = _tenant_id AND pl.vehicle_id = dt.vehicle_id
  )
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(
      jsonb_build_object(
        'load_id', load_id, 'load_number', load_number, 'status', status,
        'updated_at', updated_at, 'client_id', client_id, 'trip_id', trip_id,
        'plate', CASE WHEN can_vehicle THEN plate END,
        'vehicle_nickname', CASE WHEN can_vehicle THEN vehicle_nickname END,
        'lat', CASE WHEN can_vehicle THEN lat END,
        'lng', CASE WHEN can_vehicle THEN lng END,
        'speed', CASE WHEN can_vehicle THEN speed END,
        'captured_at', CASE WHEN can_vehicle THEN captured_at END,
        'driver_name',  CASE WHEN can_driver THEN driver_name END,
        'driver_phone', CASE WHEN can_driver THEN driver_phone END,
        'actual_start_at', actual_start_at, 'planned_end_at', planned_end_at,
        'next_stop', next_stop,
        'documents', documents,
        'can_view_vehicle_live', can_vehicle,
        'can_view_driver_contact', can_driver
      ) ORDER BY updated_at DESC
    ), '[]'::jsonb)
  ) INTO v_result FROM enriched;
  RETURN v_result;
END; $function$;

CREATE OR REPLACE FUNCTION public.list_client_documents_v2(_tenant_id uuid, _client_id uuid DEFAULT NULL::uuid, _document_type text DEFAULT NULL::text, _search text DEFAULT NULL::text, _start_date date DEFAULT NULL::date, _end_date date DEFAULT NULL::date, _limit integer DEFAULT 100, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, document_type text, invoice_number text, access_key text, issue_date date, remitter text, recipient text, recipient_city text, recipient_state text, value numeric, weight_kg numeric, status text, load_id uuid, client_id uuid, has_pod boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._portal_assert_client_access(_tenant_id, _client_id);
  RETURN QUERY
  SELECT fd.id, fd.document_type, fd.invoice_number, fd.access_key, fd.issue_date,
    fd.remitter, fd.recipient, fd.recipient_city, fd.recipient_state,
    CASE WHEN public.portal_user_can_view_financial(_tenant_id, fd.id) THEN fd.value END,
    fd.weight_kg, fd.status, fd.load_id, fd.client_id,
    EXISTS(SELECT 1 FROM public.available_delivery_proofs pod WHERE pod.fiscal_document_id = fd.id)
  FROM public.fiscal_documents fd
  WHERE fd.tenant_id = _tenant_id
    AND public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
    AND (_client_id IS NULL OR fd.client_id = _client_id)
    AND (_document_type IS NULL OR fd.document_type = _document_type)
    AND (_start_date IS NULL OR fd.issue_date >= _start_date)
    AND (_end_date   IS NULL OR fd.issue_date <= _end_date)
    AND (_search IS NULL OR (
      fd.invoice_number ILIKE '%' || _search || '%'
      OR fd.access_key  ILIKE '%' || _search || '%'
      OR fd.remitter    ILIKE '%' || _search || '%'
      OR fd.recipient   ILIKE '%' || _search || '%'
    ))
  ORDER BY fd.issue_date DESC NULLS LAST, fd.created_at DESC
  LIMIT _limit OFFSET _offset;
END; $function$;

CREATE OR REPLACE FUNCTION public.search_client_portal_shipments_v2(_tenant_id uuid, _client_id uuid DEFAULT NULL::uuid, _search text DEFAULT NULL::text, _status text[] DEFAULT NULL::text[], _start_date date DEFAULT NULL::date, _end_date date DEFAULT NULL::date, _city text DEFAULT NULL::text, _state text DEFAULT NULL::text, _has_pod boolean DEFAULT NULL::boolean, _has_occurrence boolean DEFAULT NULL::boolean, _limit integer DEFAULT 50, _offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _rows jsonb; _total int; _search_norm text;
BEGIN
  PERFORM public._portal_assert_client_access(_tenant_id, _client_id);
  IF NOT EXISTS(SELECT 1 FROM public.client_portal_access
                WHERE tenant_id=_tenant_id AND user_id=auth.uid() AND active=true) THEN
    RETURN jsonb_build_object('rows','[]'::jsonb,'total',0);
  END IF;
  _search_norm := NULLIF(trim(_search), '');

  WITH base AS (
    SELECT fd.id AS fiscal_document_id, fd.tenant_id, fd.client_id,
      fd.invoice_number, fd.access_key, fd.issue_date, fd.document_type,
      fd.status AS document_status, fd.client_load_number, fd.reference_number,
      fd.remitter, fd.remitter_cnpj, fd.recipient, fd.recipient_cnpj,
      fd.recipient_city, fd.recipient_state, fd.recipient_neighborhood,
      fd.product_summary, fd.pallet_count, fd.weight_kg,
      CASE WHEN public.portal_user_can_view_financial(_tenant_id, fd.id) THEN fd.value END AS value,
      CASE WHEN public.portal_user_can_view_financial(_tenant_id, fd.id) THEN fd.freight_value END AS freight_value,
      fd.load_id, fd.pickup_order_id, fd.updated_at,
      l.load_number, l.status AS load_status, l.trip_id,
      ds.id AS dispatch_stop_id, ds.status AS stop_status,
      ds.planned_arrival_at, ds.actual_arrival_at, ds.actual_departure_at,
      EXISTS (SELECT 1 FROM public.available_delivery_proofs p
              WHERE p.fiscal_document_id = fd.id AND p.status IN ('uploaded','validated')) AS has_pod,
      EXISTS (
        SELECT 1 FROM public.operational_events oe
        WHERE oe.tenant_id = _tenant_id AND oe.visible_to_client = true AND oe.public_status = 'open'
          AND (oe.fiscal_document_id = fd.id
            OR oe.dispatch_stop_id IN (SELECT dsd.dispatch_stop_id FROM public.dispatch_stop_documents dsd WHERE dsd.fiscal_document_id = fd.id)
            OR (oe.client_id IS NOT NULL AND oe.client_id = fd.client_id
                AND (oe.fiscal_document_id IS NULL OR oe.fiscal_document_id = fd.id)))
      ) AS has_open_occurrence,
      public.get_public_shipment_status(fd.id) AS public_status
    FROM public.fiscal_documents fd
    LEFT JOIN public.loads l ON l.id = fd.load_id
    LEFT JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
    LEFT JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
    WHERE fd.tenant_id = _tenant_id
      AND public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
      AND (_client_id IS NULL OR fd.client_id = _client_id)
      AND (_start_date IS NULL OR fd.issue_date >= _start_date)
      AND (_end_date   IS NULL OR fd.issue_date <= _end_date)
      AND (_city  IS NULL OR fd.recipient_city  ILIKE _city)
      AND (_state IS NULL OR fd.recipient_state ILIKE _state)
      AND (_status IS NULL OR fd.status = ANY(_status))
      AND ( _search_norm IS NULL
            OR fd.invoice_number ILIKE '%' || _search_norm || '%'
            OR fd.access_key ILIKE '%' || _search_norm || '%'
            OR fd.client_load_number ILIKE '%' || _search_norm || '%'
            OR fd.reference_number ILIKE '%' || _search_norm || '%'
            OR fd.recipient ILIKE '%' || _search_norm || '%'
            OR fd.recipient_cnpj ILIKE '%' || _search_norm || '%'
            OR fd.recipient_city ILIKE '%' || _search_norm || '%'
            OR COALESCE(l.load_number,'') ILIKE '%' || _search_norm || '%' )
  ),
  filtered AS (
    SELECT * FROM base
    WHERE (_has_pod IS NULL OR has_pod = _has_pod)
      AND (_has_occurrence IS NULL OR has_open_occurrence = _has_occurrence)
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(f) ORDER BY f.issue_date DESC NULLS LAST, f.updated_at DESC), '[]'::jsonb),
         (SELECT count(*) FROM filtered)
  INTO _rows, _total
  FROM (SELECT * FROM filtered ORDER BY issue_date DESC NULLS LAST, updated_at DESC
        LIMIT _limit OFFSET _offset) f;

  RETURN jsonb_build_object('rows', _rows, 'total', _total);
END; $function$;

CREATE OR REPLACE FUNCTION public.get_client_portal_reports_summary_v2(_tenant_id uuid, _client_id uuid DEFAULT NULL::uuid, _start_date date DEFAULT NULL::date, _end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_result jsonb;
  v_start date := COALESCE(_start_date, (now() - interval '90 days')::date);
  v_end   date := COALESCE(_end_date, now()::date);
BEGIN
  PERFORM public._portal_assert_client_access(_tenant_id, _client_id);
  WITH allowed AS (SELECT unnest(public._portal_user_client_ids(_tenant_id)) AS client_id),
  fd AS (
    SELECT f.* FROM public.fiscal_documents f
    WHERE f.tenant_id = _tenant_id
      AND f.client_id IN (SELECT client_id FROM allowed)
      AND (_client_id IS NULL OR f.client_id = _client_id)
      AND COALESCE(f.issue_date, f.created_at::date) BETWEEN v_start AND v_end
  ),
  by_status AS (SELECT COALESCE(status,'sem_status') AS status, count(*)::int AS total FROM fd GROUP BY 1),
  delayed AS (
    SELECT count(*)::int AS total FROM fd f
    WHERE EXISTS (
      SELECT 1 FROM public.dispatch_stop_documents dsd
      JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
      WHERE dsd.fiscal_document_id = f.id AND ds.planned_arrival_at IS NOT NULL
        AND (ds.actual_arrival_at IS NULL AND ds.planned_arrival_at < now()
             OR ds.actual_arrival_at > ds.planned_arrival_at + interval '30 minutes')
    )
  ),
  pending_pods AS (
    SELECT count(*)::int AS total FROM fd f
    WHERE f.status IN ('delivered','completed')
      AND NOT EXISTS (SELECT 1 FROM public.available_delivery_proofs pod WHERE pod.fiscal_document_id = f.id)
  ),
  occ_by_type AS (
    SELECT COALESCE(event_type,'outros') AS event_type, count(*)::int AS total
    FROM public.operational_events
    WHERE tenant_id = _tenant_id
      AND client_id IN (SELECT client_id FROM allowed)
      AND (_client_id IS NULL OR client_id = _client_id)
      AND (visible_to_client = true OR client_opened = true)
      AND created_at::date BETWEEN v_start AND v_end
    GROUP BY 1 ORDER BY total DESC LIMIT 20
  ),
  pickups_by AS (
    SELECT COALESCE(status,'sem_status') AS status, count(*)::int AS total
    FROM public.pickup_orders
    WHERE tenant_id = _tenant_id
      AND remitter_client_id IN (SELECT client_id FROM allowed)
      AND (_client_id IS NULL OR remitter_client_id = _client_id)
      AND created_at::date BETWEEN v_start AND v_end
    GROUP BY 1
  ),
  top_cities AS (
    SELECT COALESCE(recipient_city,'—') AS city, COALESCE(recipient_state,'') AS state,
      count(*)::int AS total FROM fd GROUP BY 1,2 ORDER BY total DESC LIMIT 15
  ),
  avg_time AS (
    SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (ds.actual_arrival_at - COALESCE(dt.actual_start_at, ds.planned_arrival_at))) / 86400.0)::numeric, 2), 0) AS avg_days
    FROM fd f
    JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = f.id
    JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
    LEFT JOIN public.dispatch_trips dt ON dt.id = ds.dispatch_trip_id
    WHERE ds.actual_arrival_at IS NOT NULL
  )
  SELECT jsonb_build_object(
    'period_start', v_start, 'period_end', v_end,
    'deliveries_total', (SELECT count(*)::int FROM fd),
    'deliveries_by_status', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'total', total)) FROM by_status), '[]'::jsonb),
    'deliveries_delayed', (SELECT total FROM delayed),
    'pending_pods', (SELECT total FROM pending_pods),
    'occurrences_by_type', COALESCE((SELECT jsonb_agg(jsonb_build_object('event_type', event_type, 'total', total)) FROM occ_by_type), '[]'::jsonb),
    'pickups_by_status', COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'total', total)) FROM pickups_by), '[]'::jsonb),
    'top_cities', COALESCE((SELECT jsonb_agg(jsonb_build_object('city', city, 'state', state, 'total', total)) FROM top_cities), '[]'::jsonb),
    'avg_delivery_days', (SELECT avg_days FROM avg_time)
  ) INTO v_result;
  RETURN v_result;
END; $function$;

CREATE OR REPLACE FUNCTION public.list_client_pods(_tenant_id uuid, _status text DEFAULT NULL::text, _start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, _end_date timestamp with time zone DEFAULT NULL::timestamp with time zone, _limit integer DEFAULT 100, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, fiscal_document_id uuid, load_id uuid, invoice_number text, proof_type text, status text, has_file boolean, receiver_name text, receiver_document text, receiver_role text, received_at timestamp with time zone, validated_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT pod.id, pod.fiscal_document_id, pod.load_id, fd.invoice_number,
    pod.proof_type, pod.status, (pod.storage_path IS NOT NULL) AS has_file,
    pod.receiver_name, pod.receiver_document, pod.receiver_role,
    pod.received_at, pod.validated_at
  FROM public.current_delivery_proofs pod
  JOIN public.fiscal_documents fd ON fd.id = pod.fiscal_document_id
  WHERE pod.tenant_id = _tenant_id
    AND public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
    AND (_status IS NULL OR pod.status = _status)
    AND (_start_date IS NULL OR pod.received_at >= _start_date)
    AND (_end_date   IS NULL OR pod.received_at <= _end_date)
  ORDER BY pod.received_at DESC NULLS LAST, pod.created_at DESC
  LIMIT _limit OFFSET _offset;
$function$;

CREATE OR REPLACE FUNCTION public.list_client_pods_v2(_tenant_id uuid, _client_id uuid DEFAULT NULL::uuid, _status text DEFAULT NULL::text, _start_date timestamp with time zone DEFAULT NULL::timestamp with time zone, _end_date timestamp with time zone DEFAULT NULL::timestamp with time zone, _limit integer DEFAULT 100, _offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, fiscal_document_id uuid, load_id uuid, invoice_number text, proof_type text, status text, has_file boolean, receiver_name text, receiver_document text, receiver_role text, received_at timestamp with time zone, validated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._portal_assert_client_access(_tenant_id, _client_id);
  RETURN QUERY
  SELECT pod.id, pod.fiscal_document_id, pod.load_id, fd.invoice_number,
    pod.proof_type, pod.status, (pod.storage_path IS NOT NULL),
    pod.receiver_name, pod.receiver_document, pod.receiver_role,
    pod.received_at, pod.validated_at
  FROM public.current_delivery_proofs pod
  JOIN public.fiscal_documents fd ON fd.id = pod.fiscal_document_id
  WHERE pod.tenant_id = _tenant_id
    AND public.portal_user_can_access_fiscal_document(_tenant_id, fd.id)
    AND (_client_id IS NULL OR fd.client_id = _client_id)
    AND (_status IS NULL OR pod.status = _status)
    AND (_start_date IS NULL OR pod.received_at >= _start_date)
    AND (_end_date   IS NULL OR pod.received_at <= _end_date)
  ORDER BY pod.received_at DESC NULLS LAST, pod.created_at DESC
  LIMIT _limit OFFSET _offset;
END; $function$;

CREATE OR REPLACE FUNCTION public.get_client_portal_shipment_detail(_fiscal_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _fd public.fiscal_documents; _tenant uuid; _can_financial boolean := false;
  _trip_id uuid; _stop_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Acesso negado a este documento' USING ERRCODE='42501'; END IF;
  SELECT * INTO _fd FROM public.fiscal_documents WHERE id = _fiscal_document_id AND deleted_at IS NULL;
  IF _fd.id IS NULL THEN RAISE EXCEPTION 'Acesso negado a este documento' USING ERRCODE='42501'; END IF;
  _tenant := _fd.tenant_id;
  IF NOT public.portal_user_can_access_fiscal_document(_tenant, _fiscal_document_id) THEN
    RAISE EXCEPTION 'Acesso negado a este documento' USING ERRCODE='42501';
  END IF;
  _can_financial := public.portal_user_can_view_financial(_tenant, _fiscal_document_id);

  SELECT ds.dispatch_trip_id, ds.id INTO _trip_id, _stop_id
  FROM public.dispatch_stop_documents dsd
  JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
  WHERE dsd.fiscal_document_id = _fd.id AND dsd.tenant_id = _tenant AND ds.tenant_id = _tenant
    AND _fd.load_id IS NOT NULL AND (dsd.load_id = _fd.load_id OR (dsd.load_id IS NULL AND EXISTS (
      SELECT 1 FROM public.dispatch_trip_loads dtl WHERE dtl.tenant_id = _tenant
        AND dtl.dispatch_trip_id = ds.dispatch_trip_id AND dtl.load_id = _fd.load_id)))
    AND EXISTS (SELECT 1 FROM public.dispatch_trips dt WHERE dt.id = ds.dispatch_trip_id AND dt.tenant_id = _tenant)
  ORDER BY dsd.created_at DESC, dsd.id DESC LIMIT 1;

  RETURN jsonb_build_object(
    'context', jsonb_build_object('tenant_id', _tenant, 'actor_id', auth.uid(), 'document_id', _fd.id),
    'document', jsonb_build_object(
      'id', _fd.id, 'invoice_number', _fd.invoice_number, 'access_key', _fd.access_key,
      'document_type', _fd.document_type, 'issue_date', _fd.issue_date, 'status', _fd.status,
      'client_load_number', _fd.client_load_number, 'reference_number', _fd.reference_number,
      'remitter', _fd.remitter, 'remitter_cnpj', _fd.remitter_cnpj,
      'recipient', _fd.recipient, 'recipient_cnpj', _fd.recipient_cnpj,
      'recipient_city', _fd.recipient_city, 'recipient_state', _fd.recipient_state,
      'recipient_neighborhood', _fd.recipient_neighborhood,
      'product_summary', _fd.product_summary, 'pallet_count', _fd.pallet_count, 'weight_kg', _fd.weight_kg,
      'value', CASE WHEN _can_financial THEN _fd.value END,
      'freight_value', CASE WHEN _can_financial THEN _fd.freight_value END
    ),
    'load', (SELECT jsonb_build_object('id', l.id, 'load_number', l.load_number, 'status', l.status,
              'origin', l.origin, 'destination', l.destination,
              'total_pallet_count', l.total_pallet_count, 'total_weight_kg', l.total_weight_kg)
             FROM public.loads l WHERE l.id = _fd.load_id AND l.tenant_id = _tenant),
    'trip', (SELECT jsonb_build_object('id', dt.id, 'status', dt.status,
              'planned_start_at', dt.planned_start_at, 'actual_start_at', dt.actual_start_at,
              'planned_end_at', dt.planned_end_at, 'actual_end_at', dt.actual_end_at)
             FROM public.dispatch_trips dt WHERE dt.id = _trip_id AND dt.tenant_id = _tenant),
    'stop', (SELECT jsonb_build_object('id', ds.id, 'stop_order', ds.stop_order,
              'destination', ds.destination, 'status', ds.status,
              'planned_arrival_at', ds.planned_arrival_at,
              'actual_arrival_at', ds.actual_arrival_at,
              'actual_departure_at', ds.actual_departure_at)
             FROM public.dispatch_stops ds WHERE ds.id = _stop_id AND ds.tenant_id = _tenant),
    'events', '[]'::jsonb,
    'occurrences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', oe.id, 'event_type', oe.event_type,
              'severity', oe.severity, 'description', oe.description,
              'public_status', oe.public_status, 'resolved_at', oe.resolved_at,
              'created_at', oe.created_at) ORDER BY oe.created_at DESC)
      FROM public.operational_events oe
      WHERE oe.tenant_id = _tenant
        AND oe.visible_to_client = true
        AND (oe.fiscal_document_id = _fd.id OR (oe.fiscal_document_id IS NULL AND oe.client_id = _fd.client_id
          AND ((oe.dispatch_stop_id = _stop_id AND (oe.load_id IS NULL OR oe.load_id = _fd.load_id))
            OR (oe.dispatch_stop_id IS NULL AND oe.load_id = _fd.load_id))))
    ), '[]'::jsonb),
    'proof_history', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version,
       'proof_type', p.proof_type, 'status', p.status, 'receiver_name', p.receiver_name, 'received_at', p.received_at,
       'has_file', nullif(btrim(p.storage_path),'') IS NOT NULL, 'retired_at', p.retired_at) ORDER BY p.version DESC, p.id)
       FROM public.proof_of_delivery p WHERE p.tenant_id=_tenant AND p.fiscal_document_id=_fd.id AND NOT p.is_active),'[]'::jsonb),
    'proofs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version, 'proof_type', p.proof_type,
                'status', p.status, 'receiver_name', p.receiver_name, 'receiver_role', p.receiver_role,
                'received_at', p.received_at, 'validated_at', p.validated_at,
                'has_file', (p.storage_path IS NOT NULL)) ORDER BY p.created_at DESC)
                FROM public.current_delivery_proofs p WHERE p.tenant_id = _tenant AND p.fiscal_document_id = _fd.id), '[]'::jsonb)
  );
END $function$;

CREATE OR REPLACE FUNCTION public.get_client_portal_shipment_detail_v2(_fiscal_document_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _fd public.fiscal_documents;
  _tenant uuid;
  _can_financial boolean := false;
  _can_driver boolean := false;
  _can_vehicle boolean := false;
  _trip_id uuid; _stop_id uuid;
  _timeline jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Acesso negado a este documento' USING ERRCODE='42501'; END IF;
  SELECT * INTO _fd FROM public.fiscal_documents WHERE id = _fiscal_document_id AND deleted_at IS NULL;
  IF _fd.id IS NULL THEN RAISE EXCEPTION 'Acesso negado a este documento' USING ERRCODE='42501'; END IF;
  _tenant := _fd.tenant_id;

  IF NOT public.portal_user_can_access_fiscal_document(_tenant, _fiscal_document_id) THEN
    RAISE EXCEPTION 'Acesso negado a este documento' USING ERRCODE='42501';
  END IF;

  _can_financial := public.portal_user_can_view_financial(_tenant, _fiscal_document_id);

  SELECT bool_or(can_view_driver_contact), bool_or(can_view_vehicle_live)
  INTO _can_driver, _can_vehicle
  FROM public.client_portal_access
  WHERE tenant_id = _tenant AND user_id = auth.uid() AND active = true
    AND client_id = _fd.client_id;

  SELECT ds.dispatch_trip_id, ds.id INTO _trip_id, _stop_id
  FROM public.dispatch_stop_documents dsd
  JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
  WHERE dsd.fiscal_document_id = _fd.id AND dsd.tenant_id = _tenant AND ds.tenant_id = _tenant
    AND _fd.load_id IS NOT NULL AND (dsd.load_id = _fd.load_id OR (dsd.load_id IS NULL AND EXISTS (
      SELECT 1 FROM public.dispatch_trip_loads dtl WHERE dtl.tenant_id = _tenant
        AND dtl.dispatch_trip_id = ds.dispatch_trip_id AND dtl.load_id = _fd.load_id)))
    AND EXISTS (SELECT 1 FROM public.dispatch_trips dt WHERE dt.id = ds.dispatch_trip_id AND dt.tenant_id = _tenant)
  ORDER BY dsd.created_at DESC, dsd.id DESC LIMIT 1;

  -- Build unified timeline
  WITH tl AS (
    -- Import/emit
    SELECT
      ('doc-' || _fd.id::text) AS id,
      'document'::text AS type,
      'Documento emitido'::text AS title,
      ('NF ' || COALESCE(_fd.invoice_number, '—') || ' registrada no sistema') AS description,
      COALESCE(_fd.imported_at, _fd.created_at) AS occurred_at,
      'info'::text AS severity,
      'received'::text AS public_status
    WHERE _fd.id IS NOT NULL
    UNION ALL
    -- Load link
    SELECT
      ('load-' || l.id::text),
      'status',
      ('Vinculada à carga ' || l.load_number),
      NULL,
      l.updated_at,
      'info',
      'being_prepared'
    FROM public.loads l WHERE l.id = _fd.load_id AND l.tenant_id = _tenant
    UNION ALL
    -- Trip start
    SELECT
      ('trip-start-' || dt.id::text),
      'status',
      'Viagem iniciada',
      NULL,
      dt.actual_start_at,
      'info',
      'in_transit'
    FROM public.dispatch_trips dt WHERE dt.id = _trip_id AND dt.tenant_id = _tenant AND dt.actual_start_at IS NOT NULL
    UNION ALL
    -- Stop arrival
    SELECT
      ('stop-arr-' || ds.id::text),
      'status',
      'Chegou ao destino',
      COALESCE(ds.destination, ''),
      ds.actual_arrival_at,
      'info',
      'arrived_at_destination'
    FROM public.dispatch_stops ds WHERE ds.id = _stop_id AND ds.tenant_id = _tenant AND ds.actual_arrival_at IS NOT NULL
    UNION ALL
    -- Stop departure
    SELECT
      ('stop-dep-' || ds.id::text),
      'status',
      'Saída da parada',
      NULL,
      ds.actual_departure_at,
      'info',
      NULL
    FROM public.dispatch_stops ds WHERE ds.id = _stop_id AND ds.tenant_id = _tenant AND ds.actual_departure_at IS NOT NULL
    UNION ALL
    -- Private dispatch_events are not a client publication channel.
    -- Occurrences visible to client
    SELECT
      ('oc-' || oe.id::text),
      'occurrence',
      ('Ocorrência: ' || COALESCE(oe.event_type, '—')),
      COALESCE(oe.description, ''),
      oe.created_at,
      CASE WHEN oe.severity IN ('critical','high') THEN 'danger'
           WHEN oe.severity = 'medium' THEN 'warning'
           ELSE 'info' END,
      'exception'
    FROM public.operational_events oe
    WHERE oe.tenant_id = _tenant
      AND oe.visible_to_client = true
      AND (oe.fiscal_document_id = _fd.id OR (oe.fiscal_document_id IS NULL AND oe.client_id = _fd.client_id
          AND ((oe.dispatch_stop_id = _stop_id AND (oe.load_id IS NULL OR oe.load_id = _fd.load_id))
            OR (oe.dispatch_stop_id IS NULL AND oe.load_id = _fd.load_id))))
    UNION ALL
    -- POD received
    SELECT
      ('pod-rec-' || p.id::text),
      'pod',
      'Canhoto recebido',
      NULL,
      p.received_at,
      'success',
      'pod_pending'
    FROM public.available_delivery_proofs p
    WHERE p.tenant_id = _tenant AND p.fiscal_document_id = _fd.id AND p.received_at IS NOT NULL
    UNION ALL
    -- POD validated
    SELECT
      ('pod-val-' || p.id::text),
      'pod',
      'Canhoto validado',
      NULL,
      p.validated_at,
      'success',
      'pod_available'
    FROM public.available_delivery_proofs p
    WHERE p.tenant_id = _tenant AND p.fiscal_document_id = _fd.id AND p.validated_at IS NOT NULL
    UNION ALL
    -- Delivered
    SELECT
      ('deliv-' || _fd.id::text),
      'status',
      'Entrega concluída',
      NULL,
      _fd.updated_at,
      'success',
      'delivered'
    WHERE _fd.status = 'delivered'
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY occurred_at NULLS LAST), '[]'::jsonb)
  INTO _timeline
  FROM (SELECT * FROM tl WHERE occurred_at IS NOT NULL) t;

  RETURN jsonb_build_object(
    'context', jsonb_build_object('tenant_id', _tenant, 'actor_id', auth.uid(), 'document_id', _fd.id),
    'document', jsonb_build_object(
      'id', _fd.id, 'invoice_number', _fd.invoice_number, 'access_key', _fd.access_key,
      'document_type', _fd.document_type, 'issue_date', _fd.issue_date, 'status', _fd.status,
      'client_load_number', _fd.client_load_number, 'reference_number', _fd.reference_number,
      'remitter', _fd.remitter, 'remitter_cnpj', _fd.remitter_cnpj,
      'recipient', _fd.recipient, 'recipient_cnpj', _fd.recipient_cnpj,
      'recipient_city', _fd.recipient_city, 'recipient_state', _fd.recipient_state,
      'recipient_neighborhood', _fd.recipient_neighborhood,
      'product_summary', _fd.product_summary, 'pallet_count', _fd.pallet_count, 'weight_kg', _fd.weight_kg,
      'volume_count', _fd.volume_count,
      'value', CASE WHEN _can_financial THEN _fd.value END,
      'freight_value', CASE WHEN _can_financial THEN _fd.freight_value END,
      'public_status',
        CASE
          WHEN EXISTS (SELECT 1 FROM public.operational_events o WHERE o.tenant_id=_tenant AND o.visible_to_client=true
                        AND o.public_status='open' AND (o.fiscal_document_id = _fd.id OR (o.fiscal_document_id IS NULL AND o.client_id = _fd.client_id
          AND ((o.dispatch_stop_id = _stop_id AND (o.load_id IS NULL OR o.load_id = _fd.load_id))
            OR (o.dispatch_stop_id IS NULL AND o.load_id = _fd.load_id)))))
            THEN 'exception'
          WHEN _fd.status = 'delivered' AND EXISTS (SELECT 1 FROM public.available_delivery_proofs p
                        WHERE p.tenant_id = _tenant AND p.fiscal_document_id = _fd.id AND p.status IN ('uploaded','validated'))
            THEN 'pod_available'
          WHEN _fd.status = 'delivered' THEN 'pod_pending'
          WHEN _fd.status = 'in_transit' THEN 'in_transit'
          WHEN _fd.status IN ('loading','loaded') THEN 'loaded'
          ELSE 'received'
        END
    ),
    'load', (SELECT jsonb_build_object('id', l.id, 'load_number', l.load_number, 'status', l.status,
              'origin', l.origin, 'destination', l.destination,
              'total_pallet_count', l.total_pallet_count, 'total_weight_kg', l.total_weight_kg)
             FROM public.loads l WHERE l.id = _fd.load_id AND l.tenant_id = _tenant),
    'trip', (SELECT jsonb_build_object('id', dt.id, 'status', dt.status,
              'planned_start_at', dt.planned_start_at, 'actual_start_at', dt.actual_start_at,
              'planned_end_at', dt.planned_end_at, 'actual_end_at', dt.actual_end_at,
              'driver_name', CASE WHEN _can_driver THEN drv.name END,
              'driver_phone', CASE WHEN _can_driver THEN drv.phone END,
              'vehicle_plate', CASE WHEN _can_vehicle THEN v.plate END)
             FROM public.dispatch_trips dt
             LEFT JOIN public.drivers drv ON drv.id = dt.driver_id AND drv.tenant_id = _tenant
             LEFT JOIN public.vehicles v ON v.id = dt.vehicle_id AND v.tenant_id = _tenant
             WHERE dt.id = _trip_id AND dt.tenant_id = _tenant),
    'stop', (SELECT jsonb_build_object('id', ds.id, 'stop_order', ds.stop_order,
              'destination', ds.destination, 'status', ds.status,
              'planned_arrival_at', ds.planned_arrival_at,
              'actual_arrival_at', ds.actual_arrival_at,
              'actual_departure_at', ds.actual_departure_at)
             FROM public.dispatch_stops ds WHERE ds.id = _stop_id AND ds.tenant_id = _tenant),
    'timeline', _timeline,
    'occurrences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', oe.id, 'event_type', oe.event_type,
              'severity', oe.severity, 'description', oe.description,
              'public_status', oe.public_status, 'resolved_at', oe.resolved_at,
              'client_action_required', oe.client_action_required,
              'client_resolution_note', oe.client_resolution_note,
              'created_at', oe.created_at) ORDER BY oe.created_at DESC)
      FROM public.operational_events oe
      WHERE oe.tenant_id = _tenant
        AND oe.visible_to_client = true
        AND (oe.fiscal_document_id = _fd.id OR (oe.fiscal_document_id IS NULL AND oe.client_id = _fd.client_id
          AND ((oe.dispatch_stop_id = _stop_id AND (oe.load_id IS NULL OR oe.load_id = _fd.load_id))
            OR (oe.dispatch_stop_id IS NULL AND oe.load_id = _fd.load_id))))
    ), '[]'::jsonb),
    'proof_history', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version,
       'proof_type', p.proof_type, 'status', p.status, 'receiver_name', p.receiver_name, 'received_at', p.received_at,
       'has_file', nullif(btrim(p.storage_path),'') IS NOT NULL, 'retired_at', p.retired_at) ORDER BY p.version DESC, p.id)
       FROM public.proof_of_delivery p WHERE p.tenant_id=_tenant AND p.fiscal_document_id=_fd.id AND NOT p.is_active),'[]'::jsonb),
    'proofs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version, 'proof_type', p.proof_type,
                'status', p.status, 'receiver_name', p.receiver_name, 'receiver_role', p.receiver_role,
                'receiver_document', CASE WHEN _can_financial THEN p.receiver_document END,
                'received_at', p.received_at, 'validated_at', p.validated_at,
                'has_file', (nullif(btrim(p.storage_path),'') IS NOT NULL)) ORDER BY p.created_at DESC)
                FROM public.current_delivery_proofs p WHERE p.tenant_id = _tenant AND p.fiscal_document_id = _fd.id), '[]'::jsonb),
    'permissions', jsonb_build_object(
      'can_view_financial', _can_financial,
      'can_download_documents', public.portal_user_can_download_fiscal_document(_tenant, _fd.id),
      'can_view_driver_contact', _can_driver,
      'can_view_vehicle_live', _can_vehicle
    )
  );
END;
$function$;

-- correction/redelivery contracts and their dependent consumers pass rollout QA.
