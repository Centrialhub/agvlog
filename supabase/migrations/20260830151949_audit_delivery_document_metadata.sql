-- Local candidate: administrative conference per delivery attempt. No fiscal or payment action.
set local lock_timeout='3s';
set local statement_timeout='30s';
do $dependencies$ declare c record;begin
 for c in select * from(values
 ('public.request_document_redelivery(jsonb)','c30924bdf6e0cea805d0b4b322fd938e'),
 ('public.record_operation_document_correction(jsonb)','aeab241d45aa3ecb7d010125b3ea8adb'),
 ('public.get_load_operational_documents(uuid,uuid)','b65131dfe113f248566c30a6225f1ee5')) expected(signature,hash) loop
  if md5(replace(pg_get_functiondef(to_regprocedure(c.signature)),E'\r\n',E'\n')) is distinct from c.hash then
   raise exception 'Metadata audit dependency changed: %',c.signature;end if;
 end loop;end;$dependencies$;
do $guard$ begin
 if to_regprocedure('public.request_document_redelivery(jsonb)') is null
  or to_regclass('public.delivery_document_metadata_audits') is not null then
  raise exception 'Metadata audit requires the untouched redelivery contract';
 end if;
end;$guard$;

create table public.delivery_document_metadata_audits(
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 fiscal_document_id uuid not null references public.fiscal_documents(id),
 delivery_attempt_id uuid references public.delivery_attempts(id),
 -- Frozen historical identity: do not cascade a load cleanup into an audit deletion/update.
 load_id uuid not null,
 outcome_id uuid references public.delivery_document_outcomes(id),
 actor_id uuid not null,
 request_id uuid not null,
 source text not null check(source in('operator','outcome_correction')),
 source_event_id uuid references public.dispatch_events(id),
 reason text not null check(length(btrim(reason)) between 5 and 2000),
 changes jsonb not null check(jsonb_typeof(changes)='object' and changes<>'{}'::jsonb),
 before_fields jsonb not null check(jsonb_typeof(before_fields)='object'),
 after_fields jsonb not null check(jsonb_typeof(after_fields)='object'),
 transaction_id text not null default pg_current_xact_id()::text,
 recorded_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,actor_id,request_id,fiscal_document_id,source)
);
create index delivery_metadata_document_idx on public.delivery_document_metadata_audits(fiscal_document_id,delivery_attempt_id,recorded_at);
create index delivery_metadata_tenant_load_idx on public.delivery_document_metadata_audits(tenant_id,load_id);
create index delivery_metadata_attempt_idx on public.delivery_document_metadata_audits(delivery_attempt_id) where delivery_attempt_id is not null;
create index delivery_metadata_outcome_idx on public.delivery_document_metadata_audits(outcome_id) where outcome_id is not null;
create index delivery_metadata_event_idx on public.delivery_document_metadata_audits(source_event_id) where source_event_id is not null;
alter table public.delivery_document_metadata_audits enable row level security;
revoke all on public.delivery_document_metadata_audits from public,anon,authenticated,service_role;
grant select on public.delivery_document_metadata_audits to authenticated;
create policy delivery_metadata_operator_read on public.delivery_document_metadata_audits for select to authenticated
 using(auth.uid() is not null and public.is_tenant_operator_or_admin(tenant_id));
create trigger preserve_delivery_metadata_audit before update or delete on public.delivery_document_metadata_audits
 for each row execute function public._preserve_delivery_document_outcome();

create function public._delivery_admin_fields(_meta jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $fn$
 select jsonb_build_object('rec_canhoto',coalesce(nullif(_meta->'rec_canhoto','null'::jsonb),'false'::jsonb),
  'payment_method',coalesce(nullif(_meta->'payment_method','null'::jsonb),'""'::jsonb),
  'oco_01',coalesce(nullif(_meta->'oco_01','null'::jsonb),'""'::jsonb),
  'oco_02',coalesce(nullif(_meta->'oco_02','null'::jsonb),'""'::jsonb),
  'resp_oco',coalesce(nullif(_meta->'resp_oco','null'::jsonb),'""'::jsonb));
$fn$;
revoke all on function public._delivery_admin_fields(jsonb) from public,anon,authenticated,service_role;

create function public._validate_delivery_admin_patch(_changes jsonb) returns void
language plpgsql immutable security invoker set search_path='' as $fn$
declare p record;begin
 if jsonb_typeof(_changes) is distinct from 'object' or _changes='{}'::jsonb then
  raise exception 'invalid_document_metadata_patch' using errcode='22023';end if;
 for p in select key,value from jsonb_each(_changes) loop
  if p.key='rec_canhoto' then
   if jsonb_typeof(p.value)<>'boolean' then raise exception 'invalid_document_metadata_patch' using errcode='22023';end if;
  elsif p.key='payment_method' then
   if jsonb_typeof(p.value)<>'string' or p.value#>>'{}' not in('','a_vista','a_prazo','boleto','pix','transferencia','dinheiro','cartao_credito','cartao_debito','cheque','faturado') then
    raise exception 'invalid_document_metadata_patch' using errcode='22023';end if;
  elsif p.key in('oco_01','oco_02') then
   if jsonb_typeof(p.value)<>'string' or p.value#>>'{}' not in('','01','02','03','04','05','06','07','08','09') then
    raise exception 'invalid_document_metadata_patch' using errcode='22023';end if;
  elsif p.key='resp_oco' then
   if jsonb_typeof(p.value)<>'string' or p.value#>>'{}' not in('','transportadora','cliente','destinatario','remetente','motorista','embarcador') then
    raise exception 'invalid_document_metadata_patch' using errcode='22023';end if;
  else raise exception 'document_metadata_field_not_editable' using errcode='22023';end if;
 end loop;
end;$fn$;
revoke all on function public._validate_delivery_admin_patch(jsonb) from public,anon,authenticated,service_role;

create function public._delivery_document_metadata_context(_tenant uuid,_load uuid,_document uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $fn$
declare f public.fiscal_documents%rowtype;h public.delivery_document_outcomes%rowtype;c jsonb;
begin
 select * into f from public.fiscal_documents where tenant_id=_tenant and id=_document and load_id=_load
  and document_type='inbound' and deleted_at is null;
 if not found then return null;end if;
 select * into h from public.active_delivery_document_outcomes where tenant_id=_tenant and fiscal_document_id=f.id order by recorded_at desc,id desc limit 1;
 c:=jsonb_build_object('tenant_id',_tenant,'load_id',_load,'document_id',f.id,'attempt_id',f.current_delivery_attempt_id,
  'outcome_id',h.id,'status',f.status,'fields',public._delivery_admin_fields(f.delivery_meta),
  'can_receive_receipt',h.id is not null and h.outcome in('delivered','partial_delivery','returned','refused','failed','not_delivered'));
 -- Hash the complete server metadata too: never overwrite a concurrent source/contact/result edit.
 return c||jsonb_build_object('revision',encode(sha256(convert_to((c||jsonb_build_object('raw_metadata',f.delivery_meta))::text,'UTF8')),'hex'));
end;$fn$;
revoke all on function public._delivery_document_metadata_context(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public._validate_delivery_metadata_audit() returns trigger
language plpgsql security invoker set search_path='' as $fn$
declare f public.fiscal_documents%rowtype;v_outcome uuid;
begin
 if auth.uid() is null or new.actor_id is distinct from auth.uid() or not coalesce(public.is_tenant_operator_or_admin(new.tenant_id),false) then
  raise exception 'not_authorized' using errcode='42501';end if;
 select * into strict f from public.fiscal_documents where id=new.fiscal_document_id for update nowait;
 select id into v_outcome from public.active_delivery_document_outcomes where fiscal_document_id=f.id order by recorded_at desc,id desc limit 1;
 perform public._validate_delivery_admin_patch(new.changes);
 if f.tenant_id is distinct from new.tenant_id or f.load_id is distinct from new.load_id
  or f.current_delivery_attempt_id is distinct from new.delivery_attempt_id or f.document_type<>'inbound' or f.deleted_at is not null
  or new.outcome_id is distinct from v_outcome or new.before_fields is distinct from public._delivery_admin_fields(f.delivery_meta)
  or new.after_fields is distinct from new.before_fields||new.changes or new.before_fields=new.after_fields
  or new.transaction_id is distinct from pg_current_xact_id()::text then
  raise exception 'invalid_document_metadata_audit' using errcode='23514';end if;
 if new.source='operator' then
  if new.source_event_id is not null then raise exception 'invalid_document_metadata_audit' using errcode='23514';end if;
  if new.changes->'rec_canhoto'='true'::jsonb and v_outcome is null then
   raise exception 'receipt_requires_recorded_outcome' using errcode='23514';end if;
 elsif new.source='outcome_correction' then
  if new.changes is distinct from '{"rec_canhoto":false}'::jsonb or not exists(select 1 from public.dispatch_events e
   where e.id=new.source_event_id and e.tenant_id=new.tenant_id and e.created_by=new.actor_id
    and e.event_type='operation_document_correction' and e.payload->>'document_id'=f.id::text and e.payload->>'correction_of'=v_outcome::text) then
   raise exception 'invalid_document_metadata_audit' using errcode='23514';end if;
 end if;
 return new;
end;$fn$;
revoke all on function public._validate_delivery_metadata_audit() from public,anon,authenticated,service_role;
create trigger validate_delivery_metadata_audit before insert on public.delivery_document_metadata_audits
 for each row execute function public._validate_delivery_metadata_audit();

create function public._guard_delivery_admin_write() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare b jsonb;a jsonb;begin
 if new.document_type is distinct from 'inbound' and (tg_op='INSERT' or old.document_type is distinct from 'inbound') then return new;end if;
 a:=public._delivery_admin_fields(new.delivery_meta);
 if tg_op='INSERT' then
  if a->'rec_canhoto' is distinct from 'false'::jsonb or a->>'oco_01'<>'' or a->>'oco_02'<>'' or a->>'resp_oco'<>'' then
   raise exception 'new_invoice_cannot_adopt_delivery_conference' using errcode='23514';end if;
  return new;
 end if;
 b:=public._delivery_admin_fields(old.delivery_meta);if a=b then return new;end if;
 if old.id is distinct from new.id or old.tenant_id is distinct from new.tenant_id then
  raise exception 'document_metadata_identity_changed' using errcode='23514';end if;
 if new.current_delivery_attempt_id is distinct from old.current_delivery_attempt_id
  and new.current_delivery_attempt_id is not null and new.load_id is null and new.status='confirmed'
  and a=b||'{"rec_canhoto":false,"oco_01":"","oco_02":"","resp_oco":""}'::jsonb then
  return new; -- Independent attempt guards authenticate/validate the immutable source snapshot and chain.
 end if;
 if new.load_id is not distinct from old.load_id and new.current_delivery_attempt_id is not distinct from old.current_delivery_attempt_id
  and exists(select 1 from public.delivery_document_metadata_audits e where e.fiscal_document_id=old.id and e.tenant_id=old.tenant_id
   and e.load_id=old.load_id and e.delivery_attempt_id is not distinct from old.current_delivery_attempt_id
   and e.transaction_id=pg_current_xact_id()::text and e.before_fields=b and e.after_fields=a) then return new;end if;
 raise exception 'document_metadata_requires_audited_api' using errcode='55000';
end;$fn$;
revoke all on function public._guard_delivery_admin_write() from public,anon,authenticated,service_role;
create trigger guard_delivery_admin_write before insert or update on public.fiscal_documents
 for each row execute function public._guard_delivery_admin_write();

-- The original, unrecorded attempt also must not acquire delivery facts through a legacy JSON writer.
-- Deferred so the canonical outcome transaction can write its snapshot/history after the document row.
create function public._guard_unrecorded_delivery_metadata() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare f public.fiscal_documents%rowtype;h public.delivery_document_outcomes%rowtype;k text;v_before jsonb;v_after jsonb;
begin
 select * into f from public.fiscal_documents where id=new.id;
 if not found or f.document_type is distinct from 'inbound' then return null;end if;
 select * into h from public.active_delivery_document_outcomes where fiscal_document_id=f.id order by recorded_at desc,id desc limit 1;
 if found then
  -- Legacy date aliases and release flags also cannot be forged after a recorded result.
  foreach k in array array['delivered_at','redelivery','redelivery_reason','redelivery_at','delivery_attempt_id'] loop
   if coalesce(f.delivery_meta->k,'null'::jsonb) is distinct from coalesce(h.document_snapshot->'delivery_meta'->k,'null'::jsonb) then
    raise exception 'delivery_result_requires_audited_api' using errcode='23514';end if;
  end loop;
  return null;
 end if;
 if f.current_delivery_attempt_id is not null then
  if coalesce(f.delivery_meta->'delivered_at','null'::jsonb)<>'null'::jsonb then
   raise exception 'New attempt cannot reuse a prior result alias' using errcode='23514';end if;
  return null; -- The existing attempt guard validates its identity, composition and canonical result fields.
 end if;
 if f.status in('delivered','partial_delivery','returned','refused','failed','not_delivered')
  and (tg_op='INSERT' or f.status is distinct from old.status) then
  raise exception 'delivery_result_requires_audited_api' using errcode='23514';end if;
 foreach k in array array['ne','ne_reason','ne_at','delivery_at','delivered_at','correction_of','returned_items',
  'redelivery','redelivery_reason','redelivery_at','delivery_attempt_id'] loop
  v_after:=coalesce(f.delivery_meta->k,'null'::jsonb);
  if tg_op='INSERT' then
   if v_after not in('null'::jsonb,'false'::jsonb,'""'::jsonb,'{}'::jsonb) then
    raise exception 'delivery_result_requires_audited_api' using errcode='23514';end if;
  else
   v_before:=coalesce(old.delivery_meta->k,'null'::jsonb);
   if v_after is distinct from v_before then raise exception 'delivery_result_requires_audited_api' using errcode='23514';end if;
  end if;
 end loop;
 return null;
end;$fn$;
revoke all on function public._guard_unrecorded_delivery_metadata() from public,anon,authenticated,service_role;
create constraint trigger guard_unrecorded_delivery_metadata after insert or update on public.fiscal_documents
 deferrable initially deferred for each row execute function public._guard_unrecorded_delivery_metadata();

create function public._apply_delivery_admin_patch(_tenant uuid,_document uuid,_changes jsonb,_reason text,_request uuid,_source text,_event uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $fn$
declare f public.fiscal_documents%rowtype;b jsonb;a jsonb;v_id uuid;v_outcome uuid;
begin
 select * into strict f from public.fiscal_documents where id=_document and tenant_id=_tenant for update nowait;
 perform public._validate_delivery_admin_patch(_changes);b:=public._delivery_admin_fields(f.delivery_meta);a:=b||_changes;
 if a=b then return null;end if;
 select id into v_outcome from public.active_delivery_document_outcomes where fiscal_document_id=f.id and tenant_id=_tenant order by recorded_at desc,id desc limit 1;
 insert into public.delivery_document_metadata_audits(tenant_id,fiscal_document_id,delivery_attempt_id,load_id,outcome_id,actor_id,request_id,source,source_event_id,reason,changes,before_fields,after_fields)
 values(_tenant,f.id,f.current_delivery_attempt_id,f.load_id,v_outcome,auth.uid(),_request,_source,_event,_reason,_changes,b,a) returning id into v_id;
 update public.fiscal_documents set delivery_meta=coalesce(delivery_meta,'{}'::jsonb)||_changes,updated_at=clock_timestamp() where id=f.id;
 return v_id;
end;$fn$;
revoke all on function public._apply_delivery_admin_patch(uuid,uuid,jsonb,text,uuid,text,uuid) from public,anon,authenticated,service_role;

create function public.update_load_document_metadata(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_load uuid;v_trip uuid;v_after_trip uuid;v_request uuid;v_reason text;v_key text;v_hash text;
 v_cache public.idempotency_keys%rowtype;v_item jsonb;v_context jsonb;v_audit uuid;v_result jsonb;v_results jsonb:='[]'::jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or octet_length(_payload::text)>262144
  or exists(select 1 from jsonb_each(_payload) p where p.key not in('tenant_id','load_id','request_id','reason','items')
   or p.key<>'items' and jsonb_typeof(p.value)<>'string') then raise exception 'invalid_document_metadata_request' using errcode='22023';end if;
 v_tenant:=(_payload->>'tenant_id')::uuid;v_load:=(_payload->>'load_id')::uuid;v_request:=(_payload->>'request_id')::uuid;v_reason:=btrim(_payload->>'reason');
 if v_actor is null or not coalesce(public.is_tenant_operator_or_admin(v_tenant),false) then raise exception 'not_authorized' using errcode='42501';end if;
 if v_load is null or v_request is null or coalesce(length(v_reason),0)<5 or length(v_reason)>2000
  or jsonb_typeof(_payload->'items') is distinct from 'array' or jsonb_array_length(_payload->'items') not between 1 and 500 then
  raise exception 'invalid_document_metadata_request' using errcode='22023';end if;
 if (select count(distinct value->>'document_id') from jsonb_array_elements(_payload->'items'))<>jsonb_array_length(_payload->'items') then
  raise exception 'invalid_document_metadata_selection' using errcode='22023';end if;
 for v_item in select value from jsonb_array_elements(_payload->'items') loop
  if jsonb_typeof(v_item)<>'object' or exists(select 1 from jsonb_object_keys(v_item) k where k not in('document_id','attempt_id','revision','changes'))
   or jsonb_typeof(v_item->'document_id') is distinct from 'string' or (v_item->>'document_id')::uuid is null
   or not(v_item?'attempt_id') or jsonb_typeof(v_item->'attempt_id') not in('null','string')
   or jsonb_typeof(v_item->'revision') is distinct from 'string' or coalesce(v_item->>'revision','')!~'^[0-9a-f]{64}$' then raise exception 'invalid_document_metadata_item' using errcode='22023';end if;
  perform (v_item->>'attempt_id')::uuid;perform public._validate_delivery_admin_patch(v_item->'changes');
 end loop;
 v_key:='update_load_document_metadata:'||v_actor::text||':'||v_request::text;
 v_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('update_load_document_metadata'),hashtext(v_tenant::text||':'||v_key));
 perform tenant_id from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active and role::text in('owner','admin','operator') for share nowait;
 if not found then raise exception 'not_authorized' using errcode='42501';end if;
 select * into v_cache from public.idempotency_keys where tenant_id=v_tenant and key_value=v_key;
 if found then
  if v_cache.operation is distinct from 'update_load_document_metadata' or v_cache.payload_hash is distinct from v_hash then
   raise exception 'document_metadata_key_mismatch' using errcode='22023';end if;
  if v_cache.response_body->>'request_id' is distinct from v_request::text or v_cache.response_body->>'actor_id' is distinct from v_actor::text
   or v_cache.response_body->>'load_id' is distinct from v_load::text then raise exception 'document_metadata_reconciliation_required' using errcode='23514';end if;
  return v_cache.response_body;
 end if;
 select trip_id into v_trip from public.loads where id=v_load and tenant_id=v_tenant;
 if not found then raise exception 'document_metadata_load_not_found' using errcode='23514';end if;
 if v_trip is not null then perform public._lock_delivery_trip_graph(v_tenant,v_trip);
 else perform id from public.loads where id=v_load and tenant_id=v_tenant for update nowait;end if;
 select trip_id into v_after_trip from public.loads where id=v_load and tenant_id=v_tenant;
 if not found or v_after_trip is distinct from v_trip then raise exception 'document_metadata_context_changed' using errcode='40001';end if;
 perform id from public.fiscal_documents where tenant_id=v_tenant and id in(select (value->>'document_id')::uuid from jsonb_array_elements(_payload->'items')) order by id for update nowait;
 -- Validate the complete batch before the first audit or mutation.
 for v_item in select value from jsonb_array_elements(_payload->'items') loop
  v_context:=public._delivery_document_metadata_context(v_tenant,v_load,(v_item->>'document_id')::uuid);
  if v_context is null or v_context->>'revision' is distinct from v_item->>'revision' or v_context->'attempt_id' is distinct from v_item->'attempt_id' then
   raise exception 'document_metadata_context_changed' using errcode='40001';end if;
  if v_item#>'{changes,rec_canhoto}'='true'::jsonb and (v_context->>'can_receive_receipt')::boolean is distinct from true then
   raise exception 'receipt_requires_recorded_outcome' using errcode='23514';end if;
 end loop;
 for v_item in select value from jsonb_array_elements(_payload->'items') order by value->>'document_id' loop
  v_audit:=public._apply_delivery_admin_patch(v_tenant,(v_item->>'document_id')::uuid,v_item->'changes',v_reason,v_request,'operator');
  v_context:=public._delivery_document_metadata_context(v_tenant,v_load,(v_item->>'document_id')::uuid);
  v_results:=v_results||jsonb_build_array(jsonb_build_object('document_id',v_item->'document_id','attempt_id',v_item->'attempt_id',
   'audit_id',v_audit,'fields',v_context->'fields','revision',v_context->'revision','changed',v_audit is not null));
 end loop;
 v_result:=jsonb_build_object('request_id',v_request,'tenant_id',v_tenant,'actor_id',v_actor,'load_id',v_load,
  'items',v_results,'document_count',jsonb_array_length(v_results),'status','confirmed','delivery_outcomes_preserved',true,'financial_values_preserved',true);
 insert into public.idempotency_keys(tenant_id,key_value,operation,idempotency_key,payload_hash,response_body)
  values(v_tenant,v_key,'update_load_document_metadata',v_request::text,v_hash,v_result);
 return v_result;
exception when lock_not_available then raise exception 'document_metadata_concurrent_change' using errcode='40001';
end;$fn$;
revoke all on function public.update_load_document_metadata(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.update_load_document_metadata(jsonb) to authenticated;

-- CANONICAL_ADAPTERS

-- Adapted canonical consumer: get_load_operational_documents(uuid,uuid)
CREATE OR REPLACE FUNCTION public.get_load_operational_documents(_tenant_id uuid, _load_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_rows jsonb;v_document public.fiscal_documents%rowtype;v_id uuid;v_allocation uuid;v_historical boolean;
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'not_authorized' using errcode='42501';end if;
 if not exists(select 1 from public.loads where id=_load_id and tenant_id=_tenant_id) then raise exception 'load_not_found' using errcode='42501';end if;
 v_rows:='[]'::jsonb;
 for v_id in select id from public.fiscal_documents where load_id=_load_id and tenant_id=_tenant_id
  union select fiscal_document_id from public.dispatch_stop_documents where load_id=_load_id and tenant_id=_tenant_id loop
  select * into strict v_document from public.fiscal_documents where id=v_id and tenant_id=_tenant_id;
  v_historical:=v_document.load_id is distinct from _load_id;
  v_allocation:=null;
  if v_historical then
   select id into strict v_allocation from public.dispatch_stop_documents where fiscal_document_id=v_id and load_id=_load_id and tenant_id=_tenant_id;
   v_document:=public._delivery_allocation_document(v_allocation);
  end if;
  v_rows:=v_rows||jsonb_build_array((select jsonb_object_agg(key,value) from jsonb_each(to_jsonb(v_document)) where key=any(array[
   'id','invoice_number','reference_number','document_type','status','remitter','remitter_cnpj','recipient','recipient_cnpj','recipient_city','recipient_state',
   'recipient_neighborhood','pallet_count','weight_kg','value','issue_date','freight_value','freight_value_original','freight_breakdown','freight_overridden',
   'freight_override_reason','freight_confirmed_at','delivery_meta','client_load_source','load_id','deleted_at','current_delivery_attempt_id']))
   ||jsonb_build_object('is_historical',v_historical,'allocation_id',v_allocation,'operational_metadata',case when v_historical or v_document.document_type<>'inbound' then null
    else public._delivery_document_metadata_context(_tenant_id,_load_id,v_id) end));
 end loop;
 return jsonb_build_object('actor_id',auth.uid(),'tenant_id',_tenant_id,'load_id',_load_id,'documents',v_rows);
end;
$function$
;


-- Adapted canonical consumer: record_operation_document_correction(jsonb)
CREATE OR REPLACE FUNCTION public.record_operation_document_correction(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tenant uuid;v_load uuid;v_doc uuid;v_stop uuid;v_previous uuid;v_request uuid;v_actor uuid:=auth.uid();v_trip uuid;
 v_outcome text;v_reason text;v_receiver text;v_time timestamptz;v_key text;v_hash text;v_context jsonb;v_result jsonb;
 v_cache public.idempotency_keys%rowtype;v_fd public.fiscal_documents%rowtype;v_s public.dispatch_stops%rowtype;
 v_h public.delivery_document_outcomes%rowtype;v_settlement public.driver_settlements%rowtype;
 v_event uuid;v_history uuid;v_correction uuid;v_pod uuid;v_stop_result text;v_snapshot jsonb;
 v_items jsonb;v_item record;v_quantity numeric;v_returned numeric:=0;v_total numeric;v_trip_row public.dispatch_trips%rowtype;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or octet_length(_payload::text)>131072 then raise exception 'invalid_operation_correction' using errcode='22023';end if;
 if exists(select 1 from jsonb_each(_payload) p where p.key not in('tenant_id','load_id','document_id','stop_id','request_id','occurred_at','outcome','reason','receiver_name','revision','correction_of','returned_items')
  or (p.key<>'returned_items' and jsonb_typeof(p.value)<>'string'))
  or coalesce(_payload->>'occurred_at','')!~*'(Z|[+-][0-9]{2}:[0-9]{2})$' then raise exception 'invalid_operation_correction' using errcode='22023';end if;
 v_tenant:=(_payload->>'tenant_id')::uuid;v_load:=(_payload->>'load_id')::uuid;v_doc:=(_payload->>'document_id')::uuid;
 v_stop:=(_payload->>'stop_id')::uuid;v_previous:=(_payload->>'correction_of')::uuid;v_request:=(_payload->>'request_id')::uuid;
 v_time:=(_payload->>'occurred_at')::timestamptz;v_outcome:=_payload->>'outcome';v_reason:=btrim(_payload->>'reason');
 v_receiver:=nullif(btrim(_payload->>'receiver_name'),'');v_items:=coalesce(_payload->'returned_items','{}'::jsonb);
 if v_actor is null or not coalesce(public.is_tenant_operator_or_admin(v_tenant),false) then raise exception 'not_authorized' using errcode='42501';end if;
 if v_load is null or v_doc is null or v_stop is null or v_previous is null or v_request is null or v_time is null or not isfinite(v_time)
  or v_outcome is null or v_outcome not in('delivered','partial_delivery','returned','refused','failed','not_delivered')
  or coalesce(length(v_reason),0)<5 or length(v_reason)>2000 or jsonb_typeof(v_items) is distinct from 'object'
  or (v_outcome in('delivered','partial_delivery') and (coalesce(length(v_receiver),0)<2 or length(v_receiver)>160))
  or coalesce(_payload->>'revision','')!~'^[0-9a-f]{64}$' then raise exception 'invalid_operation_correction' using errcode='22023';end if;
 v_key:='record_operation_document_correction:'||v_actor::text||':'||v_request::text;
 v_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('record_operation_document_correction'),hashtext(v_tenant::text||':'||v_key));
 perform tenant_id from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active and role::text in('owner','admin','operator') for share nowait;
 if not found then raise exception 'not_authorized' using errcode='42501';end if;
 select * into v_cache from public.idempotency_keys where tenant_id=v_tenant and key_value=v_key;
 if found then
  if v_cache.operation is distinct from 'record_operation_document_correction' or v_cache.payload_hash is distinct from v_hash then raise exception 'operation_correction_key_mismatch' using errcode='22023';end if;
  if v_cache.response_body->>'request_id' is distinct from v_request::text then raise exception 'operation_correction_reconciliation_required' using errcode='23514';end if;
  return v_cache.response_body;
 end if;
 select trip_id into v_trip from public.loads where id=v_load and tenant_id=v_tenant;
 if v_trip is null then raise exception 'operation_correction_requires_recorded_trip' using errcode='23514';end if;
 select * into v_trip_row from public._lock_delivery_trip_graph(v_tenant,v_trip);
 if v_trip_row.actual_start_at is null or v_trip_row.status is null or v_trip_row.status not in('in_transit','in_progress','completed') then
  raise exception 'operation_correction_requires_recorded_trip' using errcode='23514';end if;
 -- Lock the existing financial record before comparing the context revision.
 select * into v_settlement from public.driver_settlements where tenant_id=v_tenant and dispatch_trip_id=v_trip for update nowait;
 v_context:=public._operation_document_context(v_tenant,v_load,v_doc);
 if v_context is null or encode(sha256(convert_to(v_context::text,'UTF8')),'hex') is distinct from _payload->>'revision' then
  raise exception 'operation_correction_context_changed' using errcode='40001';end if;
 select * into strict v_fd from public.fiscal_documents where id=v_doc and tenant_id=v_tenant;
 select * into v_h from public.active_delivery_document_outcomes where id=v_previous and fiscal_document_id=v_doc and tenant_id=v_tenant
  and load_id=v_load and dispatch_stop_id=v_stop and dispatch_trip_id=v_trip;
 if not found or (select count(*) from public.active_delivery_document_outcomes where dispatch_stop_document_id=v_h.dispatch_stop_document_id)<>1 then
  raise exception 'operation_correction_requires_current_outcome' using errcode='23514';end if;
 select * into strict v_s from public.dispatch_stops where id=v_stop and tenant_id=v_tenant and dispatch_trip_id=v_trip;
 if v_s.actual_arrival_at is null or v_time<v_s.actual_arrival_at or v_time>clock_timestamp()+interval '2 minutes'
  or v_trip_row.actual_end_at is not null and v_time>v_trip_row.actual_end_at then raise exception 'operation_correction_invalid_time' using errcode='22023';end if;
 perform id from public.current_load_items where fiscal_document_id=v_doc order by id for share nowait;
 if not exists(select 1 from public.current_load_items where fiscal_document_id=v_doc and load_id=v_load and tenant_id=v_tenant)
  or exists(select 1 from public.current_load_items where fiscal_document_id=v_doc and (load_id is distinct from v_load or tenant_id is distinct from v_tenant or quantity is null or quantity<=0)) then
  raise exception 'operation_correction_invalid_items' using errcode='23514';end if;
 for v_item in select key,value from jsonb_each(v_items) loop
  if v_item.key!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(v_item.value)<>'number' then
   raise exception 'operation_correction_invalid_quantities' using errcode='22023';end if;
  select quantity into v_quantity from public.current_load_items where id=v_item.key::uuid and fiscal_document_id=v_doc and tenant_id=v_tenant and load_id=v_load;
  if not found or (v_item.value::text)::numeric<=0 or (v_item.value::text)::numeric>v_quantity then raise exception 'operation_correction_invalid_quantities' using errcode='22023';end if;
  v_returned:=v_returned+(v_item.value::text)::numeric;
 end loop;
 select sum(quantity) into v_total from public.current_load_items where fiscal_document_id=v_doc and load_id=v_load and tenant_id=v_tenant;
 if (v_outcome='partial_delivery' and (v_returned<=0 or v_returned>=v_total)) or (v_outcome<>'partial_delivery' and v_items<>'{}'::jsonb) then
  raise exception 'operation_correction_invalid_quantities' using errcode='22023';end if;
 v_snapshot:=case when v_settlement.id is null then '{}'::jsonb else jsonb_build_object('settlement',to_jsonb(v_settlement),
  'items',coalesce((select jsonb_agg(to_jsonb(x) order by id) from public.driver_settlement_items x where settlement_id=v_settlement.id),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(to_jsonb(x) order by id) from public.driver_settlement_payments x where settlement_id=v_settlement.id),'[]'::jsonb)) end;
 insert into public.dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,notes,payload,created_by,event_at)
  values(v_tenant,v_trip,v_stop,'operation_document_correction',v_reason,jsonb_build_object('source','operation','document_id',v_doc,
   'correction_of',v_previous,'outcome',v_outcome,'occurred_at',v_time,'request_id',v_request,'returned_items',v_items),v_actor,clock_timestamp()) returning id into v_event;
 perform public._apply_delivery_admin_patch(v_tenant,v_doc,'{"rec_canhoto":false}'::jsonb,v_reason,v_request,'outcome_correction',v_event);
 perform public._retire_delivery_proof(v_tenant,v_doc,v_event);
 if v_outcome in('delivered','partial_delivery') then
  v_pod:=public._prepare_delivery_proof(v_tenant,v_doc,v_trip,v_stop);
  update public.proof_of_delivery set proof_type='manual_receipt',status='pending',receiver_name=v_receiver,
   metadata=jsonb_build_object('source','operation','manual_attestation',true,'attested_at',v_time,'event_id',v_event,'reason',v_reason,'correction_of',v_previous,'returned_items',v_items),
   created_by=v_actor,updated_at=clock_timestamp() where id=v_pod;
 end if;
 update public.fiscal_documents set status=v_outcome,delivery_meta=coalesce(delivery_meta,'{}'::jsonb)||jsonb_build_object(
  'ne',v_outcome<>'delivered','ne_reason',case when v_outcome<>'delivered' then v_reason else '' end,
  'delivery_at',case when v_outcome in('delivered','partial_delivery') then to_jsonb(v_time) else 'null'::jsonb end,
  'ne_at',case when v_outcome<>'delivered' then to_jsonb(v_time) else 'null'::jsonb end,
  'correction_of',v_previous,'returned_items',v_items),updated_at=clock_timestamp() where id=v_doc;
 v_history:=public._snapshot_delivery_document_outcome(v_event,v_doc,'operation',v_time);
 insert into public.delivery_document_corrections(tenant_id,previous_outcome_id,corrected_outcome_id,financial_snapshot)
  values(v_tenant,v_previous,v_history,v_snapshot) returning id into v_correction;
 select public._delivery_result_from_statuses(array_agg(f.status)) into v_stop_result
  from public.dispatch_stop_documents d join public.delivery_allocation_documents f on f.allocation_id=d.id where d.dispatch_stop_id=v_stop;
 if v_stop_result is not null then update public.dispatch_stops set status=v_stop_result,updated_at=clock_timestamp() where id=v_stop;end if;
 perform public._derive_corrected_delivery_result(v_tenant,v_trip,v_event);
 if v_settlement.id is not null then
  -- Metadata flag only: retain approved/paid amounts, items, payments and snapshots.
  update public.driver_settlements set needs_recalculation=true,recalculation_reason='delivery_outcome_correction',source_updated_at=clock_timestamp() where id=v_settlement.id;
  perform public._log_settlement_event(v_settlement.id,'delivery_outcome_corrected',v_settlement.status,v_settlement.status,v_reason,
   jsonb_build_object('document_id',v_doc,'correction_id',v_correction,'previous_outcome_id',v_previous,'corrected_outcome_id',v_history,'financial_review_required',true));
 end if;
 perform public._log_entity_audit(v_tenant,'fiscal_document',v_doc,'operation_delivery_correction',to_jsonb(v_fd),
  jsonb_build_object('status',v_outcome,'history_id',v_history,'event_id',v_event,'correction_id',v_correction),'operation_document_correction');
 v_result:=jsonb_build_object('request_id',v_request,'tenant_id',v_tenant,'load_id',v_load,'document_id',v_doc,'stop_id',v_stop,
  'outcome',v_outcome,'correction_of',v_previous,'correction_id',v_correction,'event_id',v_event,'history_id',v_history,'pod_id',v_pod,
  'proof_pending',v_outcome in('delivered','partial_delivery'),'financial_review_required',v_settlement.id is not null,
  'settlement_id',v_settlement.id,'settlement_status',v_settlement.status,
  'stop_status',(select status from public.dispatch_stops where id=v_stop),'trip_completed',(select status='completed' from public.dispatch_trips where id=v_trip));
 insert into public.idempotency_keys(tenant_id,key_value,operation,idempotency_key,payload_hash,result_id,response_body)
  values(v_tenant,v_key,'record_operation_document_correction',v_request::text,v_hash,v_correction,v_result);
 return v_result;
exception when lock_not_available then raise exception 'operation_correction_concurrent_change' using errcode='40001';
end;
$function$
;


-- Adapted canonical consumer: request_document_redelivery(jsonb)
CREATE OR REPLACE FUNCTION public.request_document_redelivery(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_doc uuid;v_request uuid;v_reason text;v_key text;v_hash text;
 v_cache public.idempotency_keys%rowtype;v_context jsonb;v_row public.fiscal_documents%rowtype;v_trip uuid;
 v_attempt uuid:=gen_random_uuid();v_event uuid;v_recorded timestamptz;v_items jsonb:='[]'::jsonb;v_input jsonb;v_source jsonb;v_result jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or octet_length(_payload::text)>131072
  or exists(select 1 from jsonb_each(_payload) p where p.key not in('tenant_id','document_id','request_id','reason','revision','items')
   or (p.key<>'items' and jsonb_typeof(p.value)<>'string')) then raise exception 'invalid_redelivery_request' using errcode='22023';end if;
 v_tenant:=(_payload->>'tenant_id')::uuid;v_doc:=(_payload->>'document_id')::uuid;v_request:=(_payload->>'request_id')::uuid;v_reason:=btrim(_payload->>'reason');
 if v_actor is null or not coalesce(public.is_tenant_operator_or_admin(v_tenant),false) then raise exception 'not_authorized' using errcode='42501';end if;
 if v_doc is null or v_request is null or coalesce(length(v_reason),0)<5 or length(v_reason)>2000
  or coalesce(_payload->>'revision','')!~'^[0-9a-f]{64}$' or jsonb_typeof(_payload->'items') is distinct from 'array'
  or jsonb_array_length(_payload->'items')=0 then raise exception 'invalid_redelivery_request' using errcode='22023';end if;
 v_key:='request_document_redelivery:'||v_actor::text||':'||v_request::text;
 v_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('request_document_redelivery'),hashtext(v_tenant::text||':'||v_key));
 perform tenant_id from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active and role::text in('owner','admin','operator') for share nowait;
 if not found then raise exception 'not_authorized' using errcode='42501';end if;
 select * into v_cache from public.idempotency_keys where tenant_id=v_tenant and key_value=v_key;
 if found then
  if v_cache.operation is distinct from 'request_document_redelivery' or v_cache.payload_hash is distinct from v_hash then raise exception 'redelivery_key_mismatch' using errcode='22023';end if;
  if v_cache.response_body->>'request_id' is distinct from v_request::text or v_cache.response_body->>'document_id' is distinct from v_doc::text then
   raise exception 'redelivery_reconciliation_required' using errcode='23514';end if;
  return v_cache.response_body;
 end if;
 select l.trip_id into v_trip from public.fiscal_documents f join public.loads l on l.id=f.load_id and l.tenant_id=f.tenant_id where f.id=v_doc and f.tenant_id=v_tenant;
 if v_trip is null then raise exception 'redelivery_requires_recorded_outcome' using errcode='23514';end if;
 perform public._lock_delivery_trip_graph(v_tenant,v_trip);
 perform id from public.current_load_items where fiscal_document_id=v_doc order by id for update nowait;
 perform id from public.proof_of_delivery where fiscal_document_id=v_doc order by id for update nowait;
 perform id from public.driver_settlements where tenant_id=v_tenant and dispatch_trip_id=v_trip for update nowait;
 v_context:=public._redelivery_context(v_tenant,v_doc);
 if v_context is null or encode(sha256(convert_to(v_context::text,'UTF8')),'hex') is distinct from _payload->>'revision' then
  raise exception 'redelivery_context_changed' using errcode='40001';end if;
 if (v_context->>'can_request')::boolean is distinct from true then
  raise exception '%',coalesce(v_context->>'blocking_reason','redelivery_requires_undelivered_balance') using errcode='23514';end if;
 if (v_context->>'trip_id')::uuid is distinct from v_trip then raise exception 'redelivery_context_changed' using errcode='40001';end if;
 select * into strict v_row from public.fiscal_documents where id=v_doc and tenant_id=v_tenant;
 if jsonb_array_length(_payload->'items')<>jsonb_array_length(v_context#>'{remainder,items}')
  or (select count(distinct value->>'source_item_id') from jsonb_array_elements(_payload->'items'))<>jsonb_array_length(_payload->'items') then
  raise exception 'redelivery_requires_entire_balance' using errcode='22023';end if;
 for v_input in select value from jsonb_array_elements(_payload->'items') loop
  if jsonb_typeof(v_input) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v_input) k where k not in('source_item_id','item_description','pallet_count','weight_kg','volume_m3'))
   or jsonb_typeof(v_input->'source_item_id') is distinct from 'string'
   or jsonb_typeof(v_input->'item_description') is distinct from 'string' or length(btrim(v_input->>'item_description')) not between 1 and 2000
   or jsonb_typeof(v_input->'pallet_count') is distinct from 'number' or jsonb_typeof(v_input->'weight_kg') is distinct from 'number'
   or jsonb_typeof(v_input->'volume_m3') is distinct from 'number' then raise exception 'invalid_redelivery_items' using errcode='22023';end if;
  select value into v_source from jsonb_array_elements(v_context#>'{remainder,items}') where value->>'id'=v_input->>'source_item_id';
  if v_source is null then raise exception 'invalid_redelivery_items' using errcode='22023';end if;
  v_items:=v_items||jsonb_build_array(v_input||jsonb_build_object('id',gen_random_uuid(),'quantity',v_source->'remaining_quantity'));
 end loop;
 insert into public.dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,notes,payload,created_by,event_at)
  values(v_tenant,v_trip,(v_context->>'stop_id')::uuid,'redelivery_requested',v_reason,jsonb_build_object('source','operation','document_id',v_doc,
   'attempt_id',v_attempt,'source_outcome_id',v_context->'outcome_id','request_id',v_request),v_actor,clock_timestamp()) returning id into v_event;
 insert into public.delivery_attempts(id,tenant_id,fiscal_document_id,previous_attempt_id,previous_outcome_id,source_allocation_id,event_id,actor_id,reason,
  source_document_snapshot,source_items_snapshot,items,financial_snapshot)
 values(v_attempt,v_tenant,v_doc,v_row.current_delivery_attempt_id,(v_context->>'outcome_id')::uuid,(v_context#>>'{remainder,source_allocation_id}')::uuid,
  v_event,v_actor,v_reason,to_jsonb(v_row),v_context->'source_items_snapshot',v_items,v_context->'financial_snapshot') returning recorded_at into v_recorded;
 perform public._retire_delivery_proof(v_tenant,v_doc,v_event);
 update public.fiscal_documents set current_delivery_attempt_id=v_attempt,load_id=null,status='confirmed',
  delivery_meta=(coalesce(delivery_meta,'{}'::jsonb)-array['ne','ne_reason','ne_at','delivery_at','delivered_at','correction_of','returned_items','rec_canhoto','oco_01','oco_02','resp_oco'])
   ||jsonb_build_object('redelivery',true,'redelivery_reason',v_reason,'redelivery_at',v_recorded,'delivery_attempt_id',v_attempt),updated_at=clock_timestamp()
  where id=v_doc;
 perform public._log_entity_audit(v_tenant,'fiscal_document',v_doc,'request_redelivery',to_jsonb(v_row),
  jsonb_build_object('attempt_id',v_attempt,'event_id',v_event,'source_outcome_id',v_context->'outcome_id'),'request_document_redelivery');
 v_result:=jsonb_build_object('request_id',v_request,'tenant_id',v_tenant,'actor_id',v_actor,'document_id',v_doc,'attempt_id',v_attempt,'event_id',v_event,
  'source_load_id',v_row.load_id,'source_trip_id',v_trip,'source_stop_id',v_context->'stop_id','previous_outcome_id',v_context->'outcome_id',
  'status','confirmed','load_id',null,'item_count',jsonb_array_length(v_items),'historical_allocation_preserved',true,'financial_values_preserved',true);
 insert into public.idempotency_keys(tenant_id,key_value,operation,idempotency_key,payload_hash,result_id,response_body)
  values(v_tenant,v_key,'request_document_redelivery',v_request::text,v_hash,v_attempt,v_result);
 return v_result;
exception when lock_not_available then raise exception 'redelivery_concurrent_change' using errcode='40001';
end;
$function$
;
