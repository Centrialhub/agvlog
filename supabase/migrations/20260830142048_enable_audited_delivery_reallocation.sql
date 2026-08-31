-- LOCAL CANDIDATE: audited redelivery; requires coordinated readers/UI cutover.
set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$ declare c record;begin
 if to_regprocedure('public._delivery_attempt_activation_gate()') is null or to_regprocedure('public.request_document_redelivery(jsonb)') is not null then
  raise exception 'Redelivery activation requires untouched attempt foundation';end if;
 for c in select * from(values ('public._sync_fiscal_document_load_mirror()','098af8ebf9e9defbc4153f7b6fba43e4'),
 ('public._load_replanning_snapshot(uuid,uuid[])','805fbe6706cde044e5904baaf6edea52'),
 ('public._assert_load_replanning_graph(uuid,uuid[])','88587d953ac20149f3beb9a825d42275'),
 ('public._lock_load_document_graph(uuid,uuid)','56f03495204150746ffd94a12a25b340'),
 ('public.dispatch_planned_route(jsonb)','7b9c529c986d872eb1ee06ba384ddd62'),
 ('public.replan_load_items(jsonb)','8dbd165b7b03de00262955d5a8d3082b'),
 ('public.move_load_items_between_loads(uuid,uuid,uuid,uuid[])','7ac9704abb7f610328b22b1e9f129d99'),
 ('public.upsert_load_item_v3(uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,uuid)','04a3da6fbb4fe20bf8fc0ef4d59d7908'),
 ('public.save_load_item_preparation(jsonb)','effc26025f50cecaa5dd5c44818de186'),
 ('public.delete_load_item_v3(uuid,uuid)','fe43393cb817dfaa323e226e35a54566'),
 ('public._prepare_delivery_proof(uuid,uuid,uuid,uuid)','3eb2c7514a4bc60281e8e9956daaa81d'),
 ('public._load_document_change_snapshot(uuid,uuid,uuid[])','3a6c5df0074fb6622405b64bdc397fd4'),
 ('public._change_load_documents(uuid,uuid,uuid[],text,jsonb,text,text)','4709abef93d37fd2f61aca104bb8ca77'),
 ('public._operation_document_context(uuid,uuid,uuid)','e6457abab0fc5bc8b663f7c097446153'),
 ('public._lock_delivery_trip_graph(uuid,uuid)','ffa8920db62358d266660d11685ed9c0'),
 ('public._derive_driver_delivery_result(uuid,uuid)','31a4a4ec4f9a00f7bf7df2f96ede223a'),
 ('public._derive_corrected_delivery_result(uuid,uuid,uuid)','bc1138378ce374615e7227b45bd22660'),
 ('public.driver_record_delivery_note(uuid,text,jsonb,uuid)','65c6456a38ade57bb4c7137bc81d1f16'),
 ('public.record_operation_document_outcome(jsonb)','bc9c55ae4aeea3a7fe53227ba34cbf30'),
 ('public.record_operation_document_correction(jsonb)','be885bd42fe5a3a6b97840d97d571173'),
 ('public._snapshot_delivery_document_outcome(uuid,uuid,text,timestamp with time zone)','87045bcd032515b747b8427f76d10626'),
 ('public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)','c3ce3d1b62954f5fc4d91567ad51f477'),
 ('public.get_client_portal_summary(uuid,date,date)','c8c0b69d52f86ccc8cedecaab9ef3d88'),
 ('public.search_client_portal_shipments(uuid,text,text[],date,date,text,text,boolean,boolean,integer,integer)','7619d324a55c4c922108ace1b1f354a8'),
 ('public.get_public_shipment_status(uuid)','76dbb1dd1befb1f9ee739309a8117bdf'),
 ('public.get_client_portal_summary_v2(uuid,uuid,date,date)','b85a4e5eda4167f04b75625cc8e5fd3d'),
 ('public.get_client_portal_upcoming_deliveries(uuid,uuid,integer)','ed1e9a246a51f1efec058fe6f99958af'),
 ('public.get_client_portal_alerts(uuid,uuid,integer)','acb2725b83d6129b354eb06705ded789'),
 ('public.get_client_portal_reports_summary(uuid,date,date)','8238ef5a4cd5e1edd7161ba0a7192fb1'),
 ('public.get_client_portal_tracking(uuid,uuid)','dece9861ad68fd8da1dc8bdd04a5680f'),
 ('public.search_client_portal_shipments_v2(uuid,uuid,text,text[],date,date,text,text,boolean,boolean,integer,integer)','0f5eca9d7d9e94f6120cbab7bdd894fb'),
 ('public.get_client_portal_reports_summary_v2(uuid,uuid,date,date)','fb440bceee6e9c39c4d4db5b5551d667'),
 ('public.get_client_portal_shipment_detail(uuid)','e945bca2973bbb0a4c55f7b0b1dc89c2'),
 ('public.get_client_portal_shipment_detail_v2(uuid)','c63051bee129c4c234ec9f9864de4aac'),
 ('public._guard_recorded_delivery_document()','aa2546392b8791f9ad25e70152a70925'),
 ('public._delivery_attempt_activation_gate()','5441120d6f1163d668706163577b0552'),
 ('public._delivery_allocation_document(uuid)','3ab397f23cc0cc4cf4c3d1b4dcca0f5a'),
 ('public._validate_delivery_attempt()','7bcb4f9710172675e277acb42d853a96'),
 ('public._guard_delivery_attempt_head()','e7dea2573244e3b63c50aecf7ac5bd79'),
 ('public._guard_delivery_allocation_rows()','2a5e943e94ba4a974f3be6f3fc97aa58'),
 ('public._delivery_redelivery_remainder(uuid)','5a800460fd21fe458e772ac44042c6e6'),
 ('public._delivery_attempt_financial_snapshot(uuid,uuid)','fa7fec65bbea50411d65e45064226039'),
 ('public._build_driver_settlement(uuid,uuid)','63b038ea6e61f0d53da3bc7f9b6839cd')) expected(signature,hash) loop
  if md5(replace(pg_get_functiondef(to_regprocedure(c.signature)),E'\r\n',E'\n')) is distinct from c.hash then
   raise exception 'Redelivery adapter dependency changed: %',c.signature;end if;
 end loop;end;$guard$;

create or replace function public._delivery_allocation_document(_allocation uuid)
returns public.fiscal_documents language plpgsql stable security invoker set search_path='' as $fn$
declare d public.dispatch_stop_documents%rowtype;f public.fiscal_documents%rowtype;j jsonb;
begin
 select * into strict d from public.dispatch_stop_documents where id=_allocation;
 select * into strict f from public.fiscal_documents where id=d.fiscal_document_id;
 if d.tenant_id is distinct from f.tenant_id then raise exception 'Delivery allocation tenant mismatch' using errcode='23514';end if;
 if d.delivery_attempt_id is not distinct from f.current_delivery_attempt_id then return f;end if;
 select source_document_snapshot into strict j from public.delivery_attempts where source_allocation_id=d.id
  and tenant_id=d.tenant_id and fiscal_document_id=d.fiscal_document_id;
 if j->>'id' is distinct from f.id::text or j->>'tenant_id' is distinct from d.tenant_id::text
  or j->>'load_id' is distinct from d.load_id::text then raise exception 'Historical delivery allocation mismatch' using errcode='23514';end if;
 return jsonb_populate_record(null::public.fiscal_documents,j);
end;
$fn$;

create function public._delivery_items_for_stop(_stop uuid)
returns setof public.load_items language sql stable security invoker set search_path='' as $fn$
 select i.* from public.load_items i join public.dispatch_stop_documents d
  on d.fiscal_document_id=i.fiscal_document_id and d.load_id=i.load_id
   and d.delivery_attempt_id is not distinct from i.delivery_attempt_id
  where d.dispatch_stop_id=_stop and d.tenant_id=i.tenant_id;
$fn$;
revoke all on function public._delivery_items_for_stop(uuid) from public,anon,authenticated,service_role;

create function public._redelivery_context(_tenant uuid,_document uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $fn$
declare f public.fiscal_documents%rowtype;h public.delivery_document_outcomes%rowtype;r jsonb;v_can boolean;v_block text;
begin
 select * into f from public.fiscal_documents where id=_document and tenant_id=_tenant and document_type='inbound' and deleted_at is null;
 if not found then return null;end if;
 select * into h from public.active_delivery_document_outcomes where fiscal_document_id=f.id and tenant_id=_tenant order by recorded_at desc,id desc limit 1;
 v_can:=h.id is not null and h.outcome in('returned','refused','failed','not_delivered','partial_delivery');
 if v_can and (f.cte_emitted_at is not null or f.cte_emitted_outbound_id is not null or f.nfse_emitted_at is not null) then
  v_can:=false;v_block:='redelivery_requires_fiscal_review';
 end if;
 if v_can then r:=public._delivery_redelivery_remainder(h.id);
 else v_block:=coalesce(v_block,case when h.id is null then 'redelivery_requires_recorded_outcome' else 'redelivery_requires_undelivered_balance' end);end if;
 return jsonb_build_object('tenant_id',_tenant,'document_id',f.id,'load_id',f.load_id,'trip_id',h.dispatch_trip_id,'stop_id',h.dispatch_stop_id,
  'outcome_id',h.id,'attempt_id',f.current_delivery_attempt_id,'document_status',f.status,'invoice_number',f.invoice_number,
  'can_request',v_can,'blocking_reason',v_block,'remainder',r,
  'source_document_snapshot',to_jsonb(f),'source_items_snapshot',coalesce((select jsonb_agg(to_jsonb(i) order by id) from public.current_load_items i where fiscal_document_id=f.id),'[]'::jsonb),
  'proof_snapshot',coalesce((select jsonb_agg(to_jsonb(p) order by id) from public.proof_of_delivery p where fiscal_document_id=f.id),'[]'::jsonb),
  'financial_snapshot',public._delivery_attempt_financial_snapshot(_tenant,h.dispatch_trip_id));
end;
$fn$;
revoke all on function public._redelivery_context(uuid,uuid) from public,anon,authenticated,service_role;

create function public.get_redelivery_context(_tenant_id uuid,_document_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $fn$
declare c jsonb;
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'not_authorized' using errcode='42501';end if;
 c:=public._redelivery_context(_tenant_id,_document_id);
 if c is null then raise exception 'redelivery_document_not_found' using errcode='23514';end if;
 return (c-array['source_document_snapshot','source_items_snapshot','proof_snapshot','financial_snapshot'])||jsonb_build_object(
  'actor_id',auth.uid(),'revision',encode(sha256(convert_to(c::text,'UTF8')),'hex'),
  'financial_review',case when c#>>'{financial_snapshot,settlement,id}' is null then null else jsonb_build_object(
   'id',c#>'{financial_snapshot,settlement,id}','status',c#>'{financial_snapshot,settlement,status}',
   'total_paid_amount',c#>'{financial_snapshot,settlement,total_paid_amount}',
   'needs_recalculation',c#>'{financial_snapshot,settlement,needs_recalculation}') end);
end;
$fn$;
revoke all on function public.get_redelivery_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_redelivery_context(uuid,uuid) to authenticated;

create function public.request_document_redelivery(_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
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
  delivery_meta=(coalesce(delivery_meta,'{}'::jsonb)-array['ne','ne_reason','ne_at','delivery_at','correction_of','returned_items'])
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
$fn$;
revoke all on function public.request_document_redelivery(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.request_document_redelivery(jsonb) to authenticated;

-- GENERATED ADAPTER: _sync_fiscal_document_load_mirror
CREATE OR REPLACE FUNCTION public._sync_fiscal_document_load_mirror()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_document_id uuid;
  v_load_count integer;
  v_load_id uuid;
BEGIN
  FOR v_document_id IN
    SELECT DISTINCT document_id
    FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.fiscal_document_id ELSE NULL END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.fiscal_document_id ELSE NULL END
    ]) AS affected(document_id)
    WHERE document_id IS NOT NULL
  LOOP
    SELECT count(DISTINCT load_id), (array_agg(DISTINCT load_id ORDER BY load_id))[1]
    INTO v_load_count, v_load_id
    FROM public.current_load_items
    WHERE fiscal_document_id = v_document_id;

    IF v_load_count > 1 THEN
      RAISE EXCEPTION 'Documento fiscal % não pode pertencer a mais de uma carga', v_document_id;
    END IF;

    UPDATE public.fiscal_documents
    SET load_id = v_load_id,
        updated_at = now()
    WHERE id = v_document_id
      AND load_id IS DISTINCT FROM v_load_id;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- GENERATED ADAPTER: _load_replanning_snapshot
CREATE OR REPLACE FUNCTION public._load_replanning_snapshot(_tenant_id uuid, _load_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
      from public.current_load_items i where i.load_id in(select id from graph_loads) and i.tenant_id=_tenant_id
  ), doc_ids as (
    select fiscal_document_id id from item_rows where fiscal_document_id is not null
    union select d.fiscal_document_id from public.current_dispatch_stop_documents d where d.dispatch_stop_id in(select id from stop_rows)
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
    'stop_documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public.current_dispatch_stop_documents d
      where d.dispatch_stop_id in(select id from stop_rows)),'[]'::jsonb),
    'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from item_rows i),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from (
      select id,tenant_id,load_id,document_type,status,deleted_at from public.fiscal_documents
      where id in(select id from doc_ids) and tenant_id=_tenant_id) d),'[]'::jsonb));
$function$;

-- GENERATED ADAPTER: _assert_load_replanning_graph
CREATE OR REPLACE FUNCTION public._assert_load_replanning_graph(_tenant_id uuid, _load_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if exists(select 1 from public.current_load_items i left join public.fiscal_documents d on d.id=i.fiscal_document_id
    left join public.loads l on l.id=i.load_id where i.load_id=any(v_loads)
      and (i.tenant_id is distinct from _tenant_id or l.tenant_id is distinct from _tenant_id
        or (i.fiscal_document_id is not null and (d.tenant_id is distinct from _tenant_id or d.load_id is distinct from i.load_id
          or d.document_type is distinct from 'inbound' or d.deleted_at is not null or d.status='deleted')))) then
    raise exception 'composition_document_mismatch' using errcode='23514';
  end if;
  if exists(select 1 from public.current_load_items i join public.dispatch_trip_loads x on x.load_id=i.load_id
    where x.dispatch_trip_id=any(v_roots) and (i.fiscal_document_id is null or (select count(*) from public.current_dispatch_stop_documents d
      join public.dispatch_stops s on s.id=d.dispatch_stop_id where d.fiscal_document_id=i.fiscal_document_id
        and d.tenant_id=_tenant_id and d.load_id=i.load_id and s.dispatch_trip_id=x.dispatch_trip_id)<>1)) then
    raise exception 'composition_stop_coverage_mismatch' using errcode='23514';
  end if;
  if exists(select 1 from public.current_dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
    left join public.fiscal_documents f on f.id=d.fiscal_document_id where s.dispatch_trip_id=any(v_roots)
      and (d.tenant_id is distinct from _tenant_id or s.tenant_id is distinct from _tenant_id or f.tenant_id is distinct from _tenant_id
        or d.load_id is distinct from f.load_id or not exists(select 1 from public.current_load_items i
          join public.dispatch_trip_loads x on x.load_id=i.load_id where i.fiscal_document_id=f.id and i.load_id=d.load_id
            and x.dispatch_trip_id=s.dispatch_trip_id)))
    or exists(select 1 from public.dispatch_stops s where s.dispatch_trip_id=any(v_roots)
      and (s.tenant_id is distinct from _tenant_id or s.actual_arrival_at is not null or s.actual_departure_at is not null
        or s.status is null or s.status not in('pending','cancelled')
        or (s.status='pending' and not exists(select 1 from public.current_dispatch_stop_documents where dispatch_stop_id=s.id))
        or (s.status='cancelled' and exists(select 1 from public.current_dispatch_stop_documents where dispatch_stop_id=s.id)))) then
    raise exception 'composition_stop_graph_mismatch' using errcode='23514';
  end if;
  if exists(select 1 from public.current_dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
    where d.fiscal_document_id in(select fiscal_document_id from public.current_load_items where load_id=any(v_loads))
      and not(s.dispatch_trip_id=any(v_roots))) then
    raise exception 'composition_stop_graph_mismatch' using errcode='23514';
  end if;
end;
$function$;

-- GENERATED ADAPTER: _lock_load_document_graph
CREATE OR REPLACE FUNCTION public._lock_load_document_graph(_tenant_id uuid, _load_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_before jsonb;v_trips uuid[];v_loads uuid[];v_stops uuid[];
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
  raise exception 'not_authorized' using errcode='42501';end if;
 perform tenant_id from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active
  and role::text in('owner','admin','operator') for share nowait;
 if not found then raise exception 'not_authorized' using errcode='42501';end if;
 if _load_id is null then raise exception 'invalid_load' using errcode='22023';end if;
 perform public._assert_load_replanning_graph(_tenant_id,array[_load_id]);
 v_before:=public._load_replanning_snapshot(_tenant_id,array[_load_id]);
 select coalesce(array_agg((x->>'id')::uuid),array[]::uuid[]) into v_trips from jsonb_array_elements(v_before->'trips') x;
 select array_agg((x->>'id')::uuid) into v_loads from jsonb_array_elements(v_before->'loads') x;
 select coalesce(array_agg((x->>'id')::uuid),array[]::uuid[]) into v_stops from jsonb_array_elements(v_before->'stops') x;
 perform id from public.dispatch_trips where id=any(v_trips) order by id for update nowait;
 perform id from public.dispatch_trip_loads where dispatch_trip_id=any(v_trips) order by load_id,id for update nowait;
 perform id from public.loads where id=any(v_loads) order by id for update nowait;
 perform id from public.dispatch_stops where id=any(v_stops) order by id for update nowait;
 perform id from public.current_dispatch_stop_documents where dispatch_stop_id=any(v_stops) order by id for update nowait;
 perform id from public.fiscal_documents where id in(select (x->>'id')::uuid from jsonb_array_elements(v_before->'documents') x) order by id for update nowait;
 perform id from public.current_load_items where load_id=any(v_loads) order by id for update nowait;
 if public._load_replanning_snapshot(_tenant_id,array[_load_id]) is distinct from v_before then
  raise exception 'composition_concurrent_change' using errcode='40001';end if;
 perform public._assert_load_replanning_graph(_tenant_id,array[_load_id]);
 return v_before;
exception when lock_not_available then raise exception 'composition_concurrent_change' using errcode='40001';
end;
$function$;

-- GENERATED ADAPTER: dispatch_planned_route
CREATE OR REPLACE FUNCTION public.dispatch_planned_route(_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform id from public.current_load_items where load_id=any(v_load_ids) order by load_id,id for update nowait;
  if exists(select 1 from public.current_load_items where load_id=any(v_load_ids) and tenant_id is distinct from v_tenant) then
    raise exception 'load_item_ownership_mismatch' using errcode='23514';
  end if;
  if exists(select 1 from public.loads l where l.id=any(v_load_ids) and not exists(
    select 1 from public.current_load_items i where i.load_id=l.id and i.fiscal_document_id is not null))
    or exists(select 1 from public.current_load_items where load_id=any(v_load_ids) and fiscal_document_id is null) then
    -- Manual cargo needs its own canonical stop/proof flow; do not silently
    -- create a route that the current document-based driver API cannot close.
    raise exception 'dispatch_requires_documented_items' using errcode='23514';
  end if;
  select array_agg(distinct fiscal_document_id order by fiscal_document_id) into v_doc_ids
    from public.current_load_items where load_id=any(v_load_ids);
  perform id from public.fiscal_documents where id=any(v_doc_ids) order by id for update nowait;
  if exists(select 1 from unnest(v_doc_ids) wanted(id) left join public.fiscal_documents f on f.id=wanted.id
    where f.id is null or f.tenant_id is distinct from v_tenant or f.document_type is distinct from 'inbound') then
    raise exception 'invalid_dispatch_document' using errcode='23514';
  end if;
  if exists(select 1 from public.current_load_items where fiscal_document_id=any(v_doc_ids)
      group by fiscal_document_id having count(distinct load_id)<>1 or bool_or(tenant_id is distinct from v_tenant))
    or exists(select 1 from public.fiscal_documents f join public.current_load_items i on i.fiscal_document_id=f.id
      where f.id=any(v_doc_ids) and f.load_id is distinct from i.load_id) then
    raise exception 'dispatch_document_load_mismatch' using errcode='23514';
  end if;
  if exists(select 1 from public.current_dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
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
    select array_agg(distinct load_id order by load_id) into v_actual_loads from public.current_load_items where fiscal_document_id=any(v_stop_docs);
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
    insert into public.current_dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id,load_id)
      select distinct v_tenant,v_stop_id,i.fiscal_document_id,i.load_id from public.current_load_items i
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

-- GENERATED ADAPTER: replan_load_items
CREATE OR REPLACE FUNCTION public.replan_load_items(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform id from public.current_dispatch_stop_documents where dispatch_stop_id=any(v_stops) order by id for update nowait;
  perform id from public.fiscal_documents where id in(select (x->>'id')::uuid from jsonb_array_elements(v_before->'documents') x)
    order by id for update nowait;
  perform id from public.current_load_items where load_id=any(v_loads) order by id for update nowait;
  if public._load_replanning_snapshot(v_tenant,array[v_source,v_target]) is distinct from v_before then
    raise exception 'composition_concurrent_change' using errcode='40001';end if;
  if encode(sha256(convert_to(v_before::text,'UTF8')),'hex') is distinct from _payload->>'revision' then
    raise exception 'replanning_revision_changed' using errcode='40001';end if;
  perform public._assert_load_replanning_graph(v_tenant,array[v_source,v_target]);
  select trip_id into v_source_trip from public.loads where id=v_source;
  select trip_id into v_target_trip from public.loads where id=v_target;
  select count(*),coalesce(array_agg(distinct fiscal_document_id order by fiscal_document_id)
    filter(where fiscal_document_id is not null),array[]::uuid[]) into v_count,v_docs
    from public.current_load_items where id=any(v_items) and load_id=v_source and tenant_id=v_tenant;
  if v_count<>cardinality(v_items) then raise exception 'composition_items_changed' using errcode='23514';end if;
  select coalesce(array_agg(value::uuid order by value::uuid),array[]::uuid[]) into v_expected_docs
    from jsonb_array_elements_text(_payload->'expected_document_ids');
  if v_expected_docs is distinct from v_docs then raise exception 'composition_items_changed' using errcode='23514';end if;
  if exists(select 1 from public.current_load_items where fiscal_document_id=any(v_docs) and not(id=any(v_items))) then
    raise exception 'composition_document_split_not_allowed' using errcode='23514';end if;
  if v_target_trip is not null and exists(select 1 from public.current_load_items where id=any(v_items) and fiscal_document_id is null) then
    raise exception 'manual_stop_assignment_required' using errcode='23514';end if;
  perform id from public.current_delivery_proofs where fiscal_document_id=any(v_docs) order by id for update nowait;
  if exists(select 1 from public.current_delivery_proofs where fiscal_document_id=any(v_docs)
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

  update public.current_load_items set load_id=v_target,updated_at=clock_timestamp() where id=any(v_items);
  if v_target_stop is not null then
    update public.current_dispatch_stop_documents set dispatch_stop_id=v_target_stop,load_id=v_target
      where fiscal_document_id=any(v_docs) and dispatch_stop_id=any(v_stops);
    insert into public.current_dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id,load_id)
      select v_tenant,v_target_stop,d,v_target from unnest(v_docs) d where not exists(
        select 1 from public.current_dispatch_stop_documents where fiscal_document_id=d and dispatch_stop_id=v_target_stop);
  else
    delete from public.current_dispatch_stop_documents where fiscal_document_id=any(v_docs) and dispatch_stop_id=any(v_stops);
  end if;
  -- Preserve stop IDs and references from messages/occurrences; cancellation is
  -- planning history, not a fabricated delivery, arrival or physical departure.
  with retired as(update public.dispatch_stops s set status='cancelled',updated_at=clock_timestamp(),
    notes=concat_ws(E'\n',nullif(s.notes,''),'Replanejamento: '||v_reason)
    where s.id=any(v_stops) and s.status='pending' and not exists(select 1 from public.current_dispatch_stop_documents where dispatch_stop_id=s.id)
    returning id) select coalesce(array_agg(id order by id),array[]::uuid[]) into v_retired from retired;
  if v_source_trip is not null and not exists(select 1 from public.current_load_items where load_id=v_source) then
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
$function$;

-- GENERATED ADAPTER: move_load_items_between_loads
CREATE OR REPLACE FUNCTION public.move_load_items_between_loads(_tenant_id uuid, _source_load_id uuid, _target_load_id uuid, _item_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_actor uuid:=auth.uid();v_items uuid[];v_docs uuid[];v_actual_docs uuid[];v_roots uuid[];v_actual_roots uuid[];
  v_source_trip uuid;v_target_trip uuid;v_count int;v_moved int;v_source_removed boolean;
begin
  if v_actor is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then
    raise exception 'not_authorized' using errcode='42501';
  end if;
  if _source_load_id is null or _target_load_id is null or _source_load_id=_target_load_id
    or coalesce(cardinality(_item_ids),0)=0 or cardinality(_item_ids)<>(select count(distinct id) from unnest(_item_ids) ids(id)) then
    raise exception 'invalid_composition_request' using errcode='22023';
  end if;
  select array_agg(id order by id) into v_items from unnest(_item_ids) ids(id);
  perform tenant_id from public.tenant_memberships where tenant_id=_tenant_id and user_id=v_actor
    and active and role::text in('owner','admin','operator') for share nowait;
  if not found then raise exception 'not_authorized' using errcode='42501';end if;
  -- Acquire the same parent order as departure/delivery. Never hold child locks
  -- while waiting for another planner, allocation or composition transaction.
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_roots from (
    select trip_id id from public.loads where id in(_source_load_id,_target_load_id) and trip_id is not null
    union select dispatch_trip_id from public.dispatch_trip_loads where load_id in(_source_load_id,_target_load_id)
    union select id from public.dispatch_trips where load_id in(_source_load_id,_target_load_id)
  ) roots;
  perform id from public.dispatch_trips where id=any(v_roots) order by id for update nowait;
  perform id from public.loads where id in(_source_load_id,_target_load_id) and tenant_id=_tenant_id order by id for update nowait;
  get diagnostics v_count=row_count;
  if v_count<>2 then raise exception 'load_ownership_mismatch' using errcode='23514';end if;
  select coalesce(array_agg(id order by id),array[]::uuid[]) into v_actual_roots from (
    select trip_id id from public.loads where id in(_source_load_id,_target_load_id) and trip_id is not null
    union select dispatch_trip_id from public.dispatch_trip_loads where load_id in(_source_load_id,_target_load_id)
    union select id from public.dispatch_trips where load_id in(_source_load_id,_target_load_id)
  ) roots;
  if v_actual_roots is distinct from v_roots then raise exception 'composition_concurrent_change' using errcode='40001';end if;
  if public._load_is_locked(_source_load_id) or public._load_is_locked(_target_load_id) then
    raise exception 'load_locked' using errcode='23514';
  end if;
  if exists(select 1 from public.loads where id in(_source_load_id,_target_load_id)
    and (status is null or status not in('planned','assembling','ready','loading','loaded','divergent'))) then
    raise exception 'load_not_eligible_for_composition' using errcode='23514';
  end if;
  -- A different trip requires an explicit destination-stop/replanning request.
  -- For the SAME unstarted trip, preserve each invoice's original destination.
  select min(link.dispatch_trip_id::text)::uuid into v_source_trip from public.dispatch_trip_loads link
    join public.dispatch_trips t on t.id=link.dispatch_trip_id where link.load_id=_source_load_id and t.status is distinct from 'cancelled';
  select min(link.dispatch_trip_id::text)::uuid into v_target_trip from public.dispatch_trip_loads link
    join public.dispatch_trips t on t.id=link.dispatch_trip_id where link.load_id=_target_load_id and t.status is distinct from 'cancelled';
  if v_source_trip is distinct from v_target_trip then
    raise exception 'composition_requires_replanning' using errcode='23514';
  end if;
  if exists(select 1 from public.loads where id in(_source_load_id,_target_load_id) and trip_id is distinct from v_source_trip)
    or (v_source_trip is not null and exists(select 1 from public.dispatch_trip_loads link
      join public.dispatch_trips t on t.id=link.dispatch_trip_id where link.load_id in(_source_load_id,_target_load_id)
      and t.status is distinct from 'cancelled' and t.id<>v_source_trip)) then
    raise exception 'composition_trip_graph_mismatch' using errcode='23514';
  end if;
  select coalesce(array_agg(distinct fiscal_document_id order by fiscal_document_id) filter(where fiscal_document_id is not null),array[]::uuid[])
    into v_docs from public.current_load_items where id=any(v_items) and load_id=_source_load_id and tenant_id=_tenant_id;
  perform id from public.fiscal_documents where id=any(v_docs) order by id for update nowait;
  perform id from public.current_load_items where id=any(v_items) and load_id=_source_load_id and tenant_id=_tenant_id order by id for update nowait;
  get diagnostics v_count=row_count;
  if v_count<>cardinality(v_items) then raise exception 'composition_items_changed' using errcode='23514';end if;
  select coalesce(array_agg(distinct fiscal_document_id order by fiscal_document_id) filter(where fiscal_document_id is not null),array[]::uuid[])
    into v_actual_docs from public.current_load_items where id=any(v_items);
  if v_actual_docs is distinct from v_docs then raise exception 'composition_concurrent_change' using errcode='40001';end if;
  if exists(select 1 from public.current_load_items where fiscal_document_id=any(v_docs) and not(id=any(v_items))) then
    raise exception 'composition_document_split_not_allowed' using errcode='23514';
  end if;
  if exists(select 1 from unnest(v_docs) wanted(id) left join public.fiscal_documents f on f.id=wanted.id
    where f.id is null or f.tenant_id is distinct from _tenant_id or f.load_id is distinct from _source_load_id or f.document_type is distinct from 'inbound') then
    raise exception 'composition_document_mismatch' using errcode='23514';
  end if;
  if v_source_trip is not null and (exists(select 1 from public.current_dispatch_stop_documents d
    join public.dispatch_stops s on s.id=d.dispatch_stop_id where d.fiscal_document_id=any(v_docs)
      and (s.dispatch_trip_id<>v_source_trip or d.tenant_id<>_tenant_id or d.load_id<>_source_load_id))
    or exists(select 1 from unnest(v_docs) wanted(id) where (select count(*) from public.current_dispatch_stop_documents d
      join public.dispatch_stops s on s.id=d.dispatch_stop_id where d.fiscal_document_id=wanted.id and s.dispatch_trip_id=v_source_trip)<>1)) then
    raise exception 'composition_stop_graph_mismatch' using errcode='23514';
  end if;
  update public.current_load_items set load_id=_target_load_id,updated_at=clock_timestamp()
    where id=any(v_items) and tenant_id=_tenant_id and load_id=_source_load_id;
  get diagnostics v_moved=row_count;
  if v_moved<>cardinality(v_items) then raise exception 'composition_items_changed' using errcode='40001';end if;
  if v_source_trip is not null then
    update public.current_dispatch_stop_documents d set load_id=_target_load_id from public.dispatch_stops s
      where s.id=d.dispatch_stop_id and s.dispatch_trip_id=v_source_trip and d.fiscal_document_id=any(v_docs);
    if not exists(select 1 from public.current_load_items where load_id=_source_load_id) then
      delete from public.dispatch_trip_loads where dispatch_trip_id=v_source_trip and load_id=_source_load_id and tenant_id=_tenant_id;
      perform public.delete_load_if_empty(_source_load_id);
    end if;
  end if;
  select not exists(select 1 from public.loads where id=_source_load_id) into v_source_removed;
  perform public._log_entity_audit(_tenant_id,'load',_source_load_id,'move_items_out',null,
    jsonb_build_object('target_load_id',_target_load_id,'item_ids',v_items,'document_ids',v_docs,'source_removed',v_source_removed),'composition_rpc');
  perform public._log_entity_audit(_tenant_id,'load',_target_load_id,'move_items_in',null,
    jsonb_build_object('source_load_id',_source_load_id,'item_ids',v_items,'document_ids',v_docs),'composition_rpc');
  return jsonb_build_object('moved',v_moved,'source_load_id',_source_load_id,'target_load_id',_target_load_id,
    'document_ids',v_docs,'source_removed',v_source_removed);
exception when lock_not_available then
  raise exception 'composition_concurrent_change' using errcode='40001',hint='Atualize ambas as cargas e repita a movimentação completa.';
end;
$function$;

-- GENERATED ADAPTER: upsert_load_item_v3
CREATE OR REPLACE FUNCTION public.upsert_load_item_v3(p_tenant_id uuid, p_load_id uuid DEFAULT NULL::uuid, p_item_id uuid DEFAULT NULL::uuid, p_order_id uuid DEFAULT NULL::uuid, p_item_description text DEFAULT NULL::text, p_quantity numeric DEFAULT NULL::numeric, p_pallet_count numeric DEFAULT NULL::numeric, p_weight_kg numeric DEFAULT NULL::numeric, p_volume_m3 numeric DEFAULT NULL::numeric, p_status text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_fiscal_document_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_load uuid;v_item public.load_items%rowtype;v_next public.load_items%rowtype;v_number numeric;v_id uuid;
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(p_tenant_id),false) then
  raise exception 'not_authorized' using errcode='42501';end if;
 -- Shared barrier prevents recovery from replacing this writer during a commit.
 lock table public.idempotency_keys in access share mode;
 if p_item_id is not null then
  select load_id into v_load from public.current_load_items where id=p_item_id and tenant_id=p_tenant_id;
  if not found then raise exception 'load_item_not_found' using errcode='23514';end if;
  if p_load_id is not null and p_load_id<>v_load then raise exception 'load_change_requires_move_rpc' using errcode='23514';end if;
 else v_load:=p_load_id;end if;
 if v_load is null then raise exception 'load_not_found' using errcode='22023';end if;
 -- Parent graph first, then the item; never hold an item while waiting for a trip.
 perform public._lock_load_document_graph(p_tenant_id,v_load);
 if p_item_id is not null then
  select * into v_item from public.current_load_items where id=p_item_id and tenant_id=p_tenant_id and load_id=v_load for update nowait;
  if not found then raise exception 'composition_items_changed' using errcode='40001';end if;
  if p_fiscal_document_id is not null and p_fiscal_document_id is distinct from v_item.fiscal_document_id then
   raise exception 'load_item_document_identity_immutable' using errcode='23514';end if;
 else
  if p_fiscal_document_id is not null then raise exception 'load_item_use_document_composition_api' using errcode='23514';end if;
  -- A manual item needs its own canonical stop/POD contract before entering a route.
  if exists(select 1 from public.loads where id=v_load and trip_id is not null) then
   raise exception 'manual_item_requires_stop_planning' using errcode='23514';end if;
 end if;
 v_next:=v_item;
 v_next.order_id:=coalesce(p_order_id,v_item.order_id);
 v_next.item_description:=coalesce(p_item_description,v_item.item_description,'');
 v_next.quantity:=coalesce(p_quantity,v_item.quantity,0);
 v_next.pallet_count:=coalesce(v_item.pallet_count,0);
 v_next.weight_kg:=case when p_item_id is null then coalesce(p_weight_kg,0) else coalesce(p_weight_kg,v_item.weight_kg) end;
 v_next.volume_m3:=case when p_item_id is null then coalesce(p_volume_m3,0) else coalesce(p_volume_m3,v_item.volume_m3) end;
 v_next.status:=coalesce(p_status,v_item.status,'pending');
 v_next.notes:=coalesce(p_notes,v_item.notes);
 foreach v_number in array array[v_next.quantity,coalesce(p_pallet_count,v_next.pallet_count),v_next.weight_kg,v_next.volume_m3] loop
  if v_number<0 or v_number::text in('NaN','Infinity','-Infinity') then
   raise exception 'invalid_load_item_metrics' using errcode='22023';end if;
 end loop;
 if p_pallet_count is not null then
  if p_pallet_count<>trunc(p_pallet_count) or p_pallet_count>2147483647 then
   raise exception 'invalid_load_item_pallet_count' using errcode='22023';end if;
  v_next.pallet_count:=p_pallet_count::integer;
 end if;
 if v_next.status not in('pending','waiting_conference','in_stock','picking','ready_for_load','in_loading','loaded','divergence') then
  raise exception 'load_item_status_requires_operational_outcome' using errcode='23514';end if;
 if v_item.status is not null and v_item.status not in('pending','waiting_conference','in_stock','picking','ready_for_load','in_loading','loaded','divergence') then
  raise exception 'load_item_existing_outcome_requires_reconciliation' using errcode='23514';end if;
 if v_next.order_id is not null then
  perform id from public.orders where id=v_next.order_id and tenant_id=p_tenant_id for share nowait;
  if not found then raise exception 'order_not_found' using errcode='23514';end if;
 end if;
 if v_item.fiscal_document_id is not null then
  perform id from public.current_delivery_proofs where fiscal_document_id=v_item.fiscal_document_id order by id for update nowait;
  if exists(select 1 from public.current_delivery_proofs where fiscal_document_id=v_item.fiscal_document_id and
   (tenant_id is distinct from p_tenant_id or status in('uploaded','validated') or storage_path is not null or photo_url is not null or signature_url is not null or received_at is not null))
   or exists(select 1 from public.fiscal_documents where id=v_item.fiscal_document_id and status in('delivered','returned','refused','failed','cancelled','partial_delivery','not_delivered')) then
   raise exception 'load_item_existing_outcome_requires_reconciliation' using errcode='23514';end if;
  if row(v_next.quantity,v_next.pallet_count,v_next.weight_kg,v_next.volume_m3,v_next.order_id)
    is distinct from row(v_item.quantity,v_item.pallet_count,v_item.weight_kg,v_item.volume_m3,v_item.order_id)
   and exists(select 1 from public.fiscal_documents where id=v_item.fiscal_document_id
    and (cte_emitted_at is not null or cte_emitted_outbound_id is not null or nfse_emitted_at is not null)) then
   raise exception 'load_item_metrics_require_fiscal_review' using errcode='23514';end if;
 end if;
 if p_item_id is null then
  insert into public.current_load_items(tenant_id,load_id,order_id,item_description,quantity,pallet_count,weight_kg,volume_m3,status,notes)
   values(p_tenant_id,v_load,v_next.order_id,v_next.item_description,v_next.quantity,v_next.pallet_count,v_next.weight_kg,v_next.volume_m3,v_next.status,v_next.notes)
   returning * into v_next;
 else
  if v_next is not distinct from v_item then return v_item.id;end if;
  update public.current_load_items set order_id=v_next.order_id,item_description=v_next.item_description,quantity=v_next.quantity,
   pallet_count=v_next.pallet_count,weight_kg=v_next.weight_kg,volume_m3=v_next.volume_m3,status=v_next.status,notes=v_next.notes,
   updated_at=clock_timestamp() where id=v_item.id returning * into v_next;
 end if;
 v_id:=v_next.id;
 -- The existing totals/mirror triggers own those writes. Do not rewrite the
 -- fiscal timestamp or recompute totals a second time from this API.
 perform public._assert_load_replanning_graph(p_tenant_id,array[v_load]);
 perform public._log_entity_audit(p_tenant_id,'load_item',v_id,case when p_item_id is null then 'create' else 'update' end,
  case when p_item_id is null then null else to_jsonb(v_item) end,to_jsonb(v_next),'item_preparation');
 return v_id;
exception when lock_not_available then raise exception 'composition_concurrent_change' using errcode='40001';
end;
$function$;

-- GENERATED ADAPTER: save_load_item_preparation
CREATE OR REPLACE FUNCTION public.save_load_item_preparation(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tenant uuid;v_load uuid;v_item_id uuid;v_request uuid;v_actor uuid:=auth.uid();v_key text;v_hash text;
 v_values jsonb;v_expected jsonb;v_cached public.idempotency_keys%rowtype;v_item public.load_items%rowtype;v_result jsonb;k text;v_new_id uuid;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'invalid_item_preparation' using errcode='22023';end if;
 v_tenant:=(_payload->>'tenant_id')::uuid;v_load:=(_payload->>'load_id')::uuid;v_item_id:=(_payload->>'item_id')::uuid;
 v_request:=(_payload->>'request_id')::uuid;v_values:=_payload->'values';v_expected:=_payload->'expected';
 if v_actor is null or not coalesce(public.is_tenant_operator_or_admin(v_tenant),false) then raise exception 'not_authorized' using errcode='42501';end if;
 if v_load is null or v_request is null or jsonb_typeof(v_values) is distinct from 'object' or v_values='{}'::jsonb then
  raise exception 'invalid_item_preparation' using errcode='22023';end if;
 for k in select jsonb_object_keys(v_values) loop
  if k not in('order_id','item_description','quantity','pallet_count','weight_kg','volume_m3','status','notes')
   or jsonb_typeof(v_values->k) is distinct from (case when k in('quantity','pallet_count','weight_kg','volume_m3') then 'number' else 'string' end) then
   raise exception 'invalid_item_preparation_field' using errcode='22023';end if;
 end loop;
 if v_item_id is null then
  if v_expected is distinct from 'null'::jsonb then raise exception 'invalid_item_preparation_expected' using errcode='22023';end if;
 else
  if jsonb_typeof(v_expected) is distinct from 'object' then raise exception 'invalid_item_preparation_expected' using errcode='22023';end if;
  for k in select jsonb_object_keys(v_values) loop
   if not(v_expected?k) then raise exception 'invalid_item_preparation_expected' using errcode='22023';end if;
  end loop;
  if exists(select 1 from jsonb_object_keys(v_expected) e(k) where e.k not in('order_id','item_description','quantity','pallet_count','weight_kg','volume_m3','status','notes')) then
   raise exception 'invalid_item_preparation_expected' using errcode='22023';end if;
 end if;
 v_key:='save_load_item_preparation:'||v_actor::text||':'||v_request::text;
 v_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('save_load_item_preparation'),hashtext(v_tenant::text||':'||v_key));
 perform tenant_id from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active
  and role::text in('owner','admin','operator') for share nowait;
 if not found then raise exception 'not_authorized' using errcode='42501';end if;
 select * into v_cached from public.idempotency_keys where tenant_id=v_tenant and key_value=v_key;
 if found then
  if v_cached.operation is distinct from 'save_load_item_preparation' or v_cached.payload_hash is distinct from v_hash then
   raise exception 'item_preparation_idempotency_mismatch' using errcode='22023';end if;
  if v_cached.response_body->>'request_id' is distinct from v_request::text then raise exception 'item_preparation_replay_requires_reconciliation' using errcode='23514';end if;
  return v_cached.response_body;
 end if;
 perform public._lock_load_document_graph(v_tenant,v_load);
 if v_item_id is not null then
  select * into v_item from public.current_load_items where id=v_item_id and tenant_id=v_tenant and load_id=v_load for update nowait;
  if not found then raise exception 'composition_items_changed' using errcode='40001';end if;
  if not(to_jsonb(v_item) @> v_expected) then raise exception 'item_preparation_expected_changed' using errcode='40001';end if;
 end if;
 v_new_id:=public.upsert_load_item_v3(p_tenant_id=>v_tenant,p_load_id=>v_load,p_item_id=>v_item_id,
  p_order_id=>(v_values->>'order_id')::uuid,p_item_description=>v_values->>'item_description',p_quantity=>(v_values->>'quantity')::numeric,
  p_pallet_count=>(v_values->>'pallet_count')::numeric,p_weight_kg=>(v_values->>'weight_kg')::numeric,p_volume_m3=>(v_values->>'volume_m3')::numeric,
  p_status=>v_values->>'status',p_notes=>v_values->>'notes');
 select * into strict v_item from public.current_load_items where id=v_new_id;
 v_result:=jsonb_build_object('request_id',v_request,'tenant_id',v_tenant,'load_id',v_load,'item_id',v_new_id,
  'created',v_item_id is null,'totals_recalculated',true,'values',jsonb_build_object('order_id',v_item.order_id,
  'item_description',v_item.item_description,'quantity',v_item.quantity,'pallet_count',v_item.pallet_count,'weight_kg',v_item.weight_kg,
  'volume_m3',v_item.volume_m3,'status',v_item.status,'notes',v_item.notes));
 insert into public.idempotency_keys(tenant_id,key_value,operation,idempotency_key,payload_hash,result_id,response_body)
  values(v_tenant,v_key,'save_load_item_preparation',v_request::text,v_hash,v_new_id,v_result);
 return v_result;
exception when lock_not_available then raise exception 'composition_concurrent_change' using errcode='40001';
end;
$function$;

-- GENERATED ADAPTER: delete_load_item_v3
CREATE OR REPLACE FUNCTION public.delete_load_item_v3(p_tenant_id uuid, p_item_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_load uuid;v_item public.load_items%rowtype;
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(p_tenant_id),false) then raise exception 'not_authorized' using errcode='42501';end if;
 select load_id into v_load from public.current_load_items where id=p_item_id and tenant_id=p_tenant_id;
 if not found then return false;end if;
 perform public._lock_load_document_graph(p_tenant_id,v_load);
 select * into v_item from public.current_load_items where id=p_item_id and tenant_id=p_tenant_id and load_id=v_load for update nowait;
 if not found then raise exception 'composition_items_changed' using errcode='40001';end if;
 if v_item.fiscal_document_id is not null then
  if (select count(*) from public.current_load_items where fiscal_document_id=v_item.fiscal_document_id)>1 then
   raise exception 'document_remove_requires_document_api' using errcode='23514';end if;
  perform public._change_load_documents(p_tenant_id,v_load,array[v_item.fiscal_document_id],'detach',null,'Remoção do item documental pela operação',null);
 else
  delete from public.current_load_items where id=p_item_id;
  perform public._log_entity_audit(p_tenant_id,'load_item',p_item_id,'delete',to_jsonb(v_item),null,'delete_load_item_v3');
  perform public.delete_load_if_empty(v_load);
 end if;
 return true;
exception when lock_not_available then raise exception 'composition_concurrent_change' using errcode='40001';
end;
$function$;

-- GENERATED ADAPTER: _prepare_delivery_proof
CREATE OR REPLACE FUNCTION public._prepare_delivery_proof(_tenant uuid, _document uuid, _trip uuid, _stop uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare f public.fiscal_documents%rowtype;p public.proof_of_delivery%rowtype;v_version integer;v_id uuid;
begin
 -- The caller owns the trip graph first; the document lock also serializes versions.
 select * into f from public.fiscal_documents where id=_document and tenant_id=_tenant for update;
 if not found or f.load_id is null or f.document_type is distinct from 'inbound' or f.deleted_at is not null
  or not exists(select 1 from public.dispatch_stops s join public.current_dispatch_stop_documents d on d.dispatch_stop_id=s.id
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
$function$;

-- GENERATED ADAPTER: _load_document_change_snapshot
CREATE OR REPLACE FUNCTION public._load_document_change_snapshot(_tenant_id uuid, _load_id uuid, _document_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('graph',public._load_replanning_snapshot(_tenant_id,array[_load_id]),
  'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from (
   select id,tenant_id,load_id,document_type,status,deleted_at,updated_at,invoice_number,product_summary,pallet_count,weight_kg,
    cte_emitted_at,cte_emitted_outbound_id,nfse_emitted_at,current_delivery_attempt_id
   from public.fiscal_documents where id=any(_document_ids) and tenant_id=_tenant_id) d),'[]'::jsonb));
$function$;

-- GENERATED ADAPTER: _change_load_documents
CREATE OR REPLACE FUNCTION public._change_load_documents(_tenant_id uuid, _load_id uuid, _document_ids uuid[], _action text, _target_stop jsonb, _reason text, _revision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_graph jsonb;v_before jsonb;v_trip uuid;v_stop uuid;v_stops uuid[];v_docs uuid[];v_effective uuid[];v_remaining uuid[];
 v_client uuid;v_lat numeric;v_lng numeric;v_destination text;v_mode text;v_count int;v_items int:=0;
 v_retired uuid[]:=array[]::uuid[];v_cancelled uuid[]:=array[]::uuid[];v_result jsonb;
begin
 if _action is null or _action not in('attach','detach') or nullif(btrim(_reason),'') is null or length(_reason)>2000
  or coalesce(cardinality(_document_ids),0)=0 or cardinality(_document_ids)<>(select count(distinct id) from unnest(_document_ids) ids(id)) then
  raise exception 'invalid_document_change' using errcode='22023';end if;
 -- Includes legacy wrappers in the recovery barrier, even without a request key.
 lock table public.idempotency_keys in access share mode;
 select array_agg(id order by id) into v_docs from unnest(_document_ids) ids(id);
 v_graph:=public._lock_load_document_graph(_tenant_id,_load_id);
 select trip_id into v_trip from public.loads where id=_load_id;
 select coalesce(array_agg((x->>'id')::uuid),array[]::uuid[]) into v_stops from jsonb_array_elements(v_graph->'stops') x;
 perform id from public.fiscal_documents where id=any(v_docs) and tenant_id=_tenant_id order by id for update nowait;
 get diagnostics v_count=row_count;
 if v_count<>cardinality(v_docs) then raise exception 'document_ownership_mismatch' using errcode='23514';end if;
 perform id from public.current_load_items where fiscal_document_id=any(v_docs) order by id for update nowait;
 perform id from public.proof_of_delivery where fiscal_document_id=any(v_docs) order by id for update nowait;
 v_before:=public._load_document_change_snapshot(_tenant_id,_load_id,v_docs);
 if _revision is not null and encode(sha256(convert_to(v_before::text,'UTF8')),'hex') is distinct from _revision then
  raise exception 'document_change_revision_changed' using errcode='40001';end if;
 if exists(select 1 from public.fiscal_documents where id=any(v_docs) and
  (document_type is distinct from 'inbound' or deleted_at is not null or status='deleted')) then
  raise exception 'invalid_inbound_document' using errcode='23514';end if;
 if exists(select 1 from public.proof_of_delivery where fiscal_document_id=any(v_docs) and
  (tenant_id is distinct from _tenant_id or (is_active and (status in('uploaded','validated') or storage_path is not null or photo_url is not null or signature_url is not null or received_at is not null)))) then
  raise exception 'replanning_has_delivery_evidence' using errcode='23514';end if;
 if exists(select 1 from public.fiscal_documents where id=any(v_docs) and (status in('delivered','returned','refused','failed','cancelled','partial_delivery','not_delivered')
  or cte_emitted_at is not null or cte_emitted_outbound_id is not null or nfse_emitted_at is not null)) then
  raise exception 'replanning_requires_fiscal_review' using errcode='23514';end if;
 if exists(select 1 from public.current_load_items where fiscal_document_id=any(v_docs) and (load_id<>_load_id or tenant_id<>_tenant_id)) then
  raise exception 'document_already_linked' using errcode='23514';end if;

 if _action='attach' then
  if exists(select 1 from public.fiscal_documents where id=any(v_docs) and load_id is not null and load_id<>_load_id) then
   raise exception 'document_already_linked' using errcode='23514';end if;
  select coalesce(array_agg(d.id order by d.id),array[]::uuid[]) into v_effective from public.fiscal_documents d
   where d.id=any(v_docs) and not exists(select 1 from public.current_load_items i where i.fiscal_document_id=d.id);
  if exists(select 1 from public.current_dispatch_stop_documents where fiscal_document_id=any(v_effective)) then
   raise exception 'document_history_requires_reconciliation' using errcode='23514';end if;
  v_mode:=_target_stop->>'mode';
  if v_trip is not null and cardinality(v_effective)>0 then
   if v_mode='existing' then
    v_stop:=(_target_stop->>'stop_id')::uuid;
    if not exists(select 1 from public.dispatch_stops where id=v_stop and tenant_id=_tenant_id and dispatch_trip_id=v_trip
      and status='pending' and actual_arrival_at is null and actual_departure_at is null) then
     raise exception 'invalid_replanning_target_stop' using errcode='23514';end if;
   elsif v_mode='new' then
    v_destination:=nullif(btrim(_target_stop->>'destination'),'');v_lat:=(_target_stop->>'latitude')::numeric;v_lng:=(_target_stop->>'longitude')::numeric;
    v_client:=nullif(_target_stop->>'client_id','')::uuid;
    if v_destination is null or v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
     raise exception 'replanning_destination_and_coordinates_required' using errcode='22023';end if;
    if v_client is not null then
     perform id from public.clients where id=v_client and tenant_id=_tenant_id and active for share nowait;
     if not found then raise exception 'invalid_client_for_tenant' using errcode='23514';end if;
    end if;
    insert into public.dispatch_stops(tenant_id,dispatch_trip_id,stop_order,destination,client_id,status,latitude,longitude,notes)
     select _tenant_id,v_trip,coalesce(max(stop_order),0)+1,v_destination,v_client,'pending',v_lat,v_lng,_reason from public.dispatch_stops
     where dispatch_trip_id=v_trip returning id into v_stop;
   else raise exception 'explicit_document_stop_required' using errcode='23514';end if;
  elsif v_trip is null and ((_revision is not null and v_mode is distinct from 'unassigned') or (v_mode is not null and v_mode<>'unassigned')) then
   raise exception 'replanning_target_unassigned' using errcode='22023';
  end if;
  -- Existing attachments are a no-op; never relocate them through this endpoint.
  if _revision is not null and cardinality(v_effective)<>cardinality(v_docs) then
   raise exception 'document_already_linked' using errcode='23514';end if;
  insert into public.current_load_items(id,tenant_id,load_id,fiscal_document_id,delivery_attempt_id,source_delivery_item_id,item_description,quantity,pallet_count,weight_kg,volume_m3)
   select gen_random_uuid(),_tenant_id,_load_id,f.id,null,null,coalesce(nullif(f.product_summary,''),'Documento '||coalesce(f.invoice_number,f.id::text)),
    1,coalesce(f.pallet_count,0),coalesce(f.weight_kg,0),0 from public.fiscal_documents f where f.id=any(v_effective) and f.current_delivery_attempt_id is null
   union all
   select (item->>'id')::uuid,_tenant_id,_load_id,f.id,a.id,(item->>'source_item_id')::uuid,item->>'item_description',
    (item->>'quantity')::numeric,(item->>'pallet_count')::integer,(item->>'weight_kg')::numeric,(item->>'volume_m3')::numeric
   from public.fiscal_documents f join public.delivery_attempts a on a.id=f.current_delivery_attempt_id and a.tenant_id=f.tenant_id and a.fiscal_document_id=f.id
   cross join lateral jsonb_array_elements(a.items) item where f.id=any(v_effective);
  get diagnostics v_items=row_count;
  if v_stop is not null then insert into public.current_dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id,load_id)
   select _tenant_id,v_stop,id,_load_id from unnest(v_effective) docs(id);end if;
 else
  if exists(select 1 from public.fiscal_documents d where d.id=any(v_docs) and
    (d.load_id is distinct from _load_id or not exists(select 1 from public.current_load_items i where i.fiscal_document_id=d.id and i.load_id=_load_id))) then
   raise exception 'document_selection_changed' using errcode='23514';end if;
  delete from public.current_dispatch_stop_documents where fiscal_document_id=any(v_docs) and dispatch_stop_id=any(v_stops);
  with retired as(update public.dispatch_stops s set status='cancelled',updated_at=clock_timestamp(),
   notes=concat_ws(E'\n',nullif(s.notes,''),'Remoção de documentos: '||_reason)
   where s.id=any(v_stops) and s.status='pending' and not exists(select 1 from public.current_dispatch_stop_documents where dispatch_stop_id=s.id)
   returning id) select coalesce(array_agg(id order by id),array[]::uuid[]) into v_retired from retired;
  -- Detach a soon-empty load BEFORE mirror-trigger cleanup can remove it.
  if v_trip is not null and not exists(select 1 from public.current_load_items where load_id=_load_id
    and (fiscal_document_id is null or not(fiscal_document_id=any(v_docs)))) then
   delete from public.dispatch_trip_loads where load_id=_load_id and dispatch_trip_id=v_trip;
   if not exists(select 1 from public.dispatch_trip_loads where dispatch_trip_id=v_trip) then
    update public.dispatch_trips set status='cancelled',updated_at=clock_timestamp() where id=v_trip;v_cancelled:=array[v_trip];
   end if;
  end if;
  delete from public.current_load_items where fiscal_document_id=any(v_docs) and load_id=_load_id and tenant_id=_tenant_id;
  get diagnostics v_items=row_count;
  perform public.delete_load_if_empty(_load_id);
 end if;
 select coalesce(array_agg(id),array[]::uuid[]) into v_remaining from public.loads where id in(select (x->>'id')::uuid from jsonb_array_elements(v_graph->'loads') x);
 if cardinality(v_remaining)>0 then perform public._assert_load_replanning_graph(_tenant_id,v_remaining);end if;
 v_result:=jsonb_build_object('action',_action,'load_id',_load_id,'document_ids',v_docs,'document_count',cardinality(v_docs),
  'updated',case when _action='attach' then cardinality(v_docs) else 0 end,'removed',case when _action='detach' then v_items else 0 end,
  'added',case when _action='attach' then v_items else 0 end,'load_removed',not exists(select 1 from public.loads where id=_load_id),
  'target_stop_id',v_stop,'retired_stop_ids',v_retired,'cancelled_trip_ids',v_cancelled,'totals_recalculated',true);
 if v_items>0 then perform public._log_entity_audit(_tenant_id,'load',_load_id,
  case when _action='attach' then 'assign_documents' else 'remove_documents' end,v_before,
  jsonb_build_object('result',v_result,'reason',_reason),'document_composition');end if;
 return v_result;
exception when lock_not_available then raise exception 'composition_concurrent_change' using errcode='40001';
end;
$function$;

-- GENERATED ADAPTER: _operation_document_context
CREATE OR REPLACE FUNCTION public._operation_document_context(_tenant uuid, _load uuid, _document uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('tenant_id',f.tenant_id,'load_id',l.id,'document_id',f.id,'document_status',f.status,
  'delivery_meta',f.delivery_meta,
  'current_outcome_id',(select h.id from public.active_delivery_document_outcomes h where h.fiscal_document_id=f.id and h.load_id=l.id order by h.recorded_at desc,h.id desc limit 1),
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',li.id,'description',li.item_description,'quantity',li.quantity) order by li.id) from public.current_load_items li where li.fiscal_document_id=f.id and li.load_id=l.id and li.tenant_id=_tenant),'[]'::jsonb),
  'settlement',(select jsonb_build_object('id',s.id,'status',s.status,'needs_recalculation',s.needs_recalculation,'updated_at',s.updated_at) from public.driver_settlements s where s.dispatch_trip_id=t.id and s.tenant_id=_tenant),'trip_id',t.id,'trip_status',t.status,'actual_start_at',t.actual_start_at,
  'stops',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'destination',s.destination,
   'actual_arrival_at',s.actual_arrival_at,'actual_departure_at',s.actual_departure_at) order by s.id)
   from public.dispatch_stops s join public.current_dispatch_stop_documents d on d.dispatch_stop_id=s.id
   where d.fiscal_document_id=f.id and d.load_id=l.id and d.tenant_id=_tenant and s.dispatch_trip_id=t.id),'[]'::jsonb),
  'proofs',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'status',p.status,'updated_at',p.updated_at) order by p.id)
   from public.current_delivery_proofs p where p.fiscal_document_id=f.id and p.tenant_id=_tenant),'[]'::jsonb),
  'history',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'source',h.source,'outcome',h.outcome,
   'occurred_at',h.occurred_at,'recorded_at',h.recorded_at,'reason',h.reason,'attempt_id',h.delivery_attempt_id,'is_current',h.delivery_attempt_id is not distinct from f.current_delivery_attempt_id and not exists(select 1 from public.delivery_document_corrections c where c.previous_outcome_id=h.id),'superseded_by',(select c.corrected_outcome_id from public.delivery_document_corrections c where c.previous_outcome_id=h.id)) order by h.recorded_at,h.id)
   from public.delivery_document_outcomes h where h.fiscal_document_id=f.id and h.tenant_id=_tenant),'[]'::jsonb))
 from public.fiscal_documents f join public.loads l on l.id=f.load_id and l.tenant_id=f.tenant_id
 left join public.dispatch_trips t on t.id=l.trip_id and t.tenant_id=l.tenant_id
 where f.id=_document and f.tenant_id=_tenant and l.id=_load and f.document_type='inbound' and f.deleted_at is null;
$function$;

-- GENERATED ADAPTER: _lock_delivery_trip_graph
CREATE OR REPLACE FUNCTION public._lock_delivery_trip_graph(_tenant_id uuid, _trip_id uuid)
 RETURNS dispatch_trips
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_trip public.dispatch_trips%rowtype;
begin
  select * into v_trip from public.dispatch_trips
  where id=_trip_id and tenant_id=_tenant_id for update;
  if not found then raise exception 'Viagem não encontrada' using errcode='P0002'; end if;
  -- Parent FK locks prevent new links while the trip is locked, but do not stop
  -- deletion or non-key updates of existing links. Lock those rows explicitly.
  perform tl.id from public.dispatch_trip_loads tl where tl.dispatch_trip_id=_trip_id
    order by tl.load_id,tl.id for update;
  if exists(select 1 from public.dispatch_trip_loads tl left join public.loads l on l.id=tl.load_id
    where tl.dispatch_trip_id=_trip_id and (l.id is null or tl.tenant_id is distinct from _tenant_id or l.tenant_id is distinct from _tenant_id)) then
    raise exception 'Vínculo de carga fora do tenant' using errcode='23514';
  end if;
  perform l.id from public.loads l join public.dispatch_trip_loads tl on tl.load_id=l.id
    where tl.dispatch_trip_id=_trip_id and tl.tenant_id=_tenant_id order by l.id for update of l;
  if exists(select 1 from public.loads l join public.dispatch_trip_loads tl on tl.load_id=l.id
    where tl.dispatch_trip_id=_trip_id and l.trip_id is not null and l.trip_id<>_trip_id) then
    raise exception 'Carga reatribuída a outra viagem; solicite revisão' using errcode='23514';
  end if;
  if v_trip.load_id is not null and not exists(select 1 from public.dispatch_trip_loads
    where dispatch_trip_id=_trip_id and tenant_id=_tenant_id and load_id=v_trip.load_id) then
    raise exception 'Vínculo canônico da carga ausente' using errcode='23514';
  end if;
  perform id from public.dispatch_stops where dispatch_trip_id=_trip_id order by id for update;
  if exists(select 1 from public.dispatch_stops where dispatch_trip_id=_trip_id and tenant_id<>_tenant_id) then
    raise exception 'Parada fora do tenant' using errcode='23514';
  end if;
  perform d.id from public.dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
    where s.dispatch_trip_id=_trip_id order by d.id for update of d;
  perform f.id from public.fiscal_documents f where f.id in (
    select d.fiscal_document_id from public.dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
    where s.dispatch_trip_id=_trip_id) order by f.id for update;
  -- Delivery results apply to inbound cargo invoices, not issued fiscal output.
  -- Marking an outbound CT-e as failed would invoke fiscal release triggers.
  if exists(select 1 from public.dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
    join public.delivery_allocation_documents f on f.allocation_id=d.id
    where s.dispatch_trip_id=_trip_id and f.document_type is distinct from 'inbound') then
    raise exception 'Parada contém documento fiscal que não é nota de entrada; revise o vínculo na operação' using errcode='23514';
  end if;
  if exists(select 1 from public.dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
    where s.dispatch_trip_id=_trip_id group by d.fiscal_document_id having count(*)>1) then
    raise exception 'Documento vinculado a mais de uma parada nesta viagem' using errcode='23514';
  end if;
  if exists(select 1 from public.dispatch_stop_documents d join public.dispatch_stops s on s.id=d.dispatch_stop_id
    left join public.delivery_allocation_documents f on f.allocation_id=d.id
    where s.dispatch_trip_id=_trip_id and (d.tenant_id<>_tenant_id or f.id is null or f.tenant_id<>_tenant_id
      or (d.load_id is not null and f.load_id is not null and d.load_id<>f.load_id)
      or (coalesce(d.load_id,f.load_id) is null and (select count(*) from public.dispatch_trip_loads where dispatch_trip_id=_trip_id)<>1)
      or (coalesce(d.load_id,f.load_id) is not null and not exists(select 1 from public.dispatch_trip_loads tl
        where tl.dispatch_trip_id=_trip_id and tl.tenant_id=_tenant_id and tl.load_id=coalesce(d.load_id,f.load_id))))) then
    raise exception 'Documento da parada sem vínculo válido com a carga' using errcode='23514';
  end if;
  return v_trip;
end;
$function$;

-- GENERATED ADAPTER: _derive_driver_delivery_result
CREATE OR REPLACE FUNCTION public._derive_driver_delivery_result(p_tenant_id uuid, p_trip_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      join public.delivery_allocation_documents f on f.allocation_id=d.id
      where d.dispatch_stop_id=s.id and coalesce(d.load_id,f.load_id) is not null)) then
    raise exception 'Parada sem carga identificada; revise os vínculos antes de concluir' using errcode='23514';
  end if;
  for v_load in select l.* from public.loads l join public.dispatch_trip_loads tl on tl.load_id=l.id
    where tl.dispatch_trip_id=p_trip_id and tl.tenant_id=p_tenant_id order by l.id loop
    -- A partial stop can fully deliver one document/load and return another.
    -- Use document outcomes for that stop, not its aggregate label for every load.
    select array_agg(case when s.status='partial_delivery' then (
      select public._delivery_result_from_statuses(array_agg(f.status))
      from public.dispatch_stop_documents d join public.delivery_allocation_documents f on f.allocation_id=d.id
      where d.dispatch_stop_id=s.id and d.tenant_id=p_tenant_id
        and (v_count=1 or coalesce(d.load_id,f.load_id)=v_load.id)
    ) else s.status end) into v_statuses from public.dispatch_stops s
    where s.dispatch_trip_id=p_trip_id and s.tenant_id=p_tenant_id and not (s.status='cancelled' and s.actual_arrival_at is null and s.actual_departure_at is null and not exists(select 1 from public.dispatch_stop_documents retired where retired.dispatch_stop_id=s.id)) and (v_count=1 or exists(
      select 1 from public.dispatch_stop_documents d join public.delivery_allocation_documents f on f.allocation_id=d.id
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
$function$;

-- GENERATED ADAPTER: _derive_corrected_delivery_result
CREATE OR REPLACE FUNCTION public._derive_corrected_delivery_result(p_tenant_id uuid, p_trip_id uuid, _event uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_trip public.dispatch_trips%rowtype; v_load public.loads%rowtype; v_count integer;
  v_statuses text[]; v_result text; v_all_terminal boolean; v_missing boolean := false;
begin
  if not exists(select 1 from public.dispatch_events e join public.delivery_document_outcomes h on h.event_id=e.id
    join public.delivery_document_corrections c on c.corrected_outcome_id=h.id
    where e.id=_event and e.tenant_id=p_tenant_id and e.dispatch_trip_id=p_trip_id
     and e.event_type='operation_document_correction' and e.created_by=auth.uid()) then
    raise exception 'Invalid correction aggregate event' using errcode='42501';end if;
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
    where s.dispatch_trip_id=p_trip_id and not exists(select 1 from public.dispatch_stop_documents d
      join public.delivery_allocation_documents f on f.allocation_id=d.id
      where d.dispatch_stop_id=s.id and coalesce(d.load_id,f.load_id) is not null)) then
    raise exception 'Parada sem carga identificada; revise os vínculos antes de concluir' using errcode='23514';
  end if;
  for v_load in select l.* from public.loads l join public.dispatch_trip_loads tl on tl.load_id=l.id
    where tl.dispatch_trip_id=p_trip_id and tl.tenant_id=p_tenant_id order by l.id loop
    -- A partial stop can fully deliver one document/load and return another.
    -- Use document outcomes for that stop, not its aggregate label for every load.
    select array_agg(case when s.status='partial_delivery' then (
      select public._delivery_result_from_statuses(array_agg(f.status))
      from public.dispatch_stop_documents d join public.delivery_allocation_documents f on f.allocation_id=d.id
      where d.dispatch_stop_id=s.id and d.tenant_id=p_tenant_id
        and (v_count=1 or coalesce(d.load_id,f.load_id)=v_load.id)
    ) else s.status end) into v_statuses from public.dispatch_stops s
    where s.dispatch_trip_id=p_trip_id and s.tenant_id=p_tenant_id and (v_count=1 or exists(
      select 1 from public.dispatch_stop_documents d join public.delivery_allocation_documents f on f.allocation_id=d.id
      where d.dispatch_stop_id=s.id and d.tenant_id=p_tenant_id and coalesce(d.load_id,f.load_id)=v_load.id));
    v_result := public._delivery_result_from_statuses(v_statuses);
    if coalesce(cardinality(v_statuses),0)=0 or (v_all_terminal and v_result is null) then v_missing:=true; end if;
    if v_result is not null and v_load.status is distinct from v_result then
      update public.loads set status=v_result,updated_at=clock_timestamp() where id=v_load.id and tenant_id=p_tenant_id;
      perform public._log_entity_audit(p_tenant_id,'load',v_load.id,'status_change',
        jsonb_build_object('status',v_load.status),jsonb_build_object('status',v_result,'trip_id',p_trip_id),'operation_document_correction');
    end if;
  end loop;
  if v_all_terminal then
    if v_missing then raise exception 'Carga sem parada identificada; revise os vínculos antes de concluir' using errcode='23514'; end if;
    if v_trip.actual_start_at is null then raise exception 'Viagem sem início registrado' using errcode='23514'; end if;
    update public.dispatch_trips set status='completed',actual_end_at=coalesce(actual_end_at,clock_timestamp()),updated_at=clock_timestamp()
      where id=p_trip_id and tenant_id=p_tenant_id and status<>'completed';
  end if;
end;
$function$;

-- GENERATED ADAPTER: driver_record_delivery_note
CREATE OR REPLACE FUNCTION public.driver_record_delivery_note(_stop_id uuid, _event_type text, _details jsonb, _client_event_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_stop public.dispatch_stops%rowtype; v_existing public.dispatch_events%rowtype;
  v_request jsonb; v_result jsonb; v_photos jsonb; v_signature text; v_path text; v_prefix text;
  v_note text; v_occurrence uuid; v_event uuid; v_loads uuid[]; v_single_load uuid;
begin
  select * into v_stop from public._lock_driver_delivery_stop(_stop_id);
  if _client_event_id is null or _event_type is null or _event_type not in('avaria','solicitar_desconto','atualizar_boleto','coleta_realizada','outros')
    or _details is null or jsonb_typeof(_details)<>'object' or octet_length(_details::text)>131072 then
    raise exception 'Dados da comunicação inválidos' using errcode='22023'; end if;
  v_request:=jsonb_build_object('kind','note','event_type',_event_type,'details',_details);
  select * into v_existing from public.dispatch_events where tenant_id=v_stop.tenant_id and created_by=auth.uid()
    and payload->>'client_event_id'=_client_event_id::text and payload ? 'delivery_result'
    and event_type in('delivery_note','delivery_delivered','stop_partial_delivery','stop_returned','stop_refused','stop_failed','stop_skipped','stop_cancelled')
    order by event_at desc,id desc limit 1;
  if found then
    if v_existing.dispatch_stop_id<>_stop_id or v_existing.payload->'delivery_request' is distinct from v_request then
      raise exception 'Identificador reutilizado para outra comunicação' using errcode='23505'; end if;
    return (v_existing.payload->'delivery_result') || jsonb_build_object('replayed',true);
  end if;
  if exists(select 1 from jsonb_each(_details) x where x.key in('notes','return_reason','event_label','signature_path')
    and jsonb_typeof(x.value) not in('string','null')) then
    raise exception 'Texto da comunicação inválido' using errcode='22023'; end if;
  v_note:=nullif(btrim(_details->>'notes'),'');
  if v_note is null or length(v_note)<3 or length(v_note)>2000 then
    raise exception 'Descreva a comunicação para a operação' using errcode='22023'; end if;
  v_photos:=coalesce(_details->'photo_paths','[]'::jsonb);
  v_signature:=nullif(btrim(_details->>'signature_path'),'');
  if jsonb_typeof(v_photos)<>'array' or jsonb_array_length(v_photos)>5 then
    raise exception 'Fotos inválidas' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(v_photos) p where jsonb_typeof(p)<>'string') then
    raise exception 'Caminho de foto inválido' using errcode='22023'; end if;
  if _event_type in('avaria','coleta_realizada') and jsonb_array_length(v_photos)=0 then
    raise exception 'Adicione uma foto da ocorrência' using errcode='22023'; end if;
  v_prefix:=v_stop.tenant_id::text || '/deliveries/' || v_stop.dispatch_trip_id::text || '/' || _stop_id::text || '/';
  for v_path in select value from jsonb_array_elements_text(v_photos) union all select v_signature where v_signature is not null loop
    if length(v_path)>500 or position('..' in v_path)>0 or left(v_path,length(v_prefix))<>v_prefix
      or not exists(select 1 from storage.objects where bucket_id='receipts' and name=v_path) then
      raise exception 'Comprovante inexistente ou fora desta entrega' using errcode='42501'; end if;
  end loop;
  select case when count(*)=1 then (array_agg(load_id))[1] end into v_single_load
    from public.dispatch_trip_loads where dispatch_trip_id=v_stop.dispatch_trip_id and tenant_id=v_stop.tenant_id;
  select array_agg(distinct coalesce(d.load_id,f.load_id,v_single_load)) into v_loads
    from public.dispatch_stop_documents d join public.delivery_allocation_documents f on f.allocation_id=d.id where d.dispatch_stop_id=_stop_id;
  if v_loads is null and v_single_load is not null then v_loads:=array[v_single_load]; end if;
  v_occurrence:=public.driver_create_operational_occurrence(v_stop.dispatch_trip_id,_event_type,v_note,'medium',_stop_id,null);
  update public.operational_events set load_id=case when cardinality(v_loads)=1 then v_loads[1] else null end,
    report_details=_details || jsonb_build_object('label',coalesce(_details->>'event_label',_event_type),
      'has_photo',jsonb_array_length(v_photos)>0,'has_signature',v_signature is not null,'stop_name',v_stop.destination),
    payload=payload || jsonb_build_object('load_ids',coalesce(to_jsonb(v_loads),'[]'::jsonb),'approval_granted',false)
    where id=v_occurrence and tenant_id=v_stop.tenant_id;
  v_result:=jsonb_build_object('operational_event_id',v_occurrence,'replayed',false);
  insert into public.dispatch_events(tenant_id,dispatch_trip_id,dispatch_stop_id,event_type,notes,payload,created_by)
    values(v_stop.tenant_id,v_stop.dispatch_trip_id,_stop_id,'delivery_note',v_note,
      _details || jsonb_build_object('client_event_id',_client_event_id,'delivery_request',v_request),auth.uid()) returning id into v_event;
  v_result:=v_result || jsonb_build_object('event_id',v_event);
  update public.dispatch_events set payload=payload || jsonb_build_object('delivery_result',v_result) where id=v_event;
  return v_result;
end;
$function$;

-- GENERATED ADAPTER: record_operation_document_outcome
CREATE OR REPLACE FUNCTION public.record_operation_document_outcome(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_tenant uuid;v_load uuid;v_doc uuid;v_stop uuid;v_request uuid;v_actor uuid:=auth.uid();v_trip uuid;
 v_outcome text;v_reason text;v_receiver text;v_time timestamptz;v_key text;v_hash text;v_context jsonb;v_result jsonb;
 v_cache public.idempotency_keys%rowtype;v_fd public.fiscal_documents%rowtype;v_s public.dispatch_stops%rowtype;
 v_event uuid;v_history uuid;v_pod uuid;v_stop_result text;
begin
 if _payload ? 'correction_of' or _payload ? 'returned_items' then raise exception 'operation_outcome_requires_correction_api' using errcode='22023';end if;
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
 if v_fd.status in('delivered','partial_delivery','returned','refused','failed','cancelled','not_delivered') or exists(select 1 from public.active_delivery_document_outcomes h where h.fiscal_document_id=v_doc and h.dispatch_stop_id=v_stop) then
  raise exception 'operation_outcome_requires_correction' using errcode='23514';end if;
 perform id from public.current_load_items where fiscal_document_id=v_doc order by id for share nowait;
 if not exists(select 1 from public.current_load_items where fiscal_document_id=v_doc and load_id=v_load and tenant_id=v_tenant)
  or exists(select 1 from public.current_load_items where fiscal_document_id=v_doc and (load_id<>v_load or tenant_id<>v_tenant)) then
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
  from public.dispatch_stop_documents d join public.delivery_allocation_documents f on f.allocation_id=d.id where d.dispatch_stop_id=v_stop;
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
$function$;

-- GENERATED ADAPTER: record_operation_document_correction
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
$function$;

-- GENERATED ADAPTER: _snapshot_delivery_document_outcome
CREATE OR REPLACE FUNCTION public._snapshot_delivery_document_outcome(_event uuid, _document uuid, _source text, _occurred timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare e public.dispatch_events%rowtype;d public.dispatch_stop_documents%rowtype;f public.fiscal_documents%rowtype;v_id uuid;
begin
 select * into strict e from public.dispatch_events where id=_event;
 select * into strict d from public.current_dispatch_stop_documents where dispatch_stop_id=e.dispatch_stop_id and fiscal_document_id=_document;
 select * into strict f from public.fiscal_documents where id=_document;
 d.load_id:=coalesce(d.load_id,f.load_id);
 if e.created_by is null or e.created_by is distinct from auth.uid() or e.tenant_id<>d.tenant_id or f.tenant_id<>d.tenant_id
  or d.load_id is null or d.load_id is distinct from f.load_id then raise exception 'Invalid delivery history graph' using errcode='23514';end if;
 insert into public.delivery_document_outcomes(tenant_id,dispatch_trip_id,dispatch_stop_id,dispatch_stop_document_id,load_id,
  fiscal_document_id,event_id,source,outcome,occurred_at,actor_id,reason,document_snapshot,items_snapshot,proof_snapshot,delivery_attempt_id)
 values(e.tenant_id,e.dispatch_trip_id,d.dispatch_stop_id,d.id,d.load_id,f.id,e.id,_source,f.status,_occurred,e.created_by,e.notes,
  jsonb_build_object('id',f.id,'load_id',f.load_id,'status',f.status,'invoice_number',f.invoice_number,'delivery_meta',f.delivery_meta),
  coalesce((select jsonb_agg(to_jsonb(li) order by li.id) from public.current_load_items li where li.load_id=d.load_id and li.fiscal_document_id=f.id),'[]'::jsonb),
  coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from public.proof_of_delivery p where p.fiscal_document_id=f.id
    and p.tenant_id=e.tenant_id and p.dispatch_stop_id=d.dispatch_stop_id),'[]'::jsonb),f.current_delivery_attempt_id) returning id into v_id;
 return v_id;
end;
$function$;

-- GENERATED ADAPTER: driver_record_delivery_outcome
CREATE OR REPLACE FUNCTION public.driver_record_delivery_outcome(_stop_id uuid, _outcome text, _details jsonb DEFAULT '{}'::jsonb, _client_event_id uuid DEFAULT NULL::uuid, _expected_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    where d.dispatch_stop_id=_stop_id and d.fiscal_document_id=li.fiscal_document_id and d.load_id=li.load_id
     and d.delivery_attempt_id is not distinct from li.delivery_attempt_id) order by li.id for share;
  if exists(select 1 from public._delivery_items_for_stop(_stop_id) li join public.fiscal_documents f on f.id=li.fiscal_document_id
    join public.dispatch_stop_documents d on d.fiscal_document_id=f.id where d.dispatch_stop_id=_stop_id
    and (li.tenant_id is distinct from v_stop.tenant_id or (li.load_id is not null and coalesce(d.load_id,f.load_id) is not null
      and li.load_id<>coalesce(d.load_id,f.load_id)))) then
    raise exception 'Itens fora do vínculo de carga da parada' using errcode='23514'; end if;
  -- History is immutable. A legacy current-status edit cannot silently become
  -- a second attempt or change the meaning of an already recorded outcome.
  if exists(select 1 from public.current_delivery_document_outcomes h
    join public.delivery_allocation_documents f on f.allocation_id=h.dispatch_stop_document_id
    where h.dispatch_stop_id=_stop_id and (h.tenant_id is distinct from v_stop.tenant_id or h.outcome is distinct from f.status)) then
    raise exception 'Histórico da nota diverge do estado atual; solicite revisão à operação' using errcode='23514';end if;
  select coalesce(array_agg(distinct f.id),array[]::uuid[]) into v_preserved
    from public.dispatch_stop_documents d join public.delivery_allocation_documents f on f.allocation_id=d.id
    where d.dispatch_stop_id=_stop_id and d.tenant_id=v_stop.tenant_id
      and f.status in('delivered','returned','refused','partial_delivery','failed','cancelled','not_delivered')
      and exists(select 1 from public.current_delivery_document_outcomes h where h.dispatch_stop_id=_stop_id
        and h.fiscal_document_id=f.id and h.tenant_id=v_stop.tenant_id and h.outcome=f.status);
  if exists(select 1 from jsonb_object_keys(v_items) k join public._delivery_items_for_stop(_stop_id) li on li.id::text=k
    join public.current_delivery_document_outcomes h on h.fiscal_document_id=li.fiscal_document_id
    where h.dispatch_stop_id=_stop_id) then
    raise exception 'Itens com resultado já registrado não podem ser devolvidos novamente' using errcode='23514';end if;
  for v_item in select key,value from jsonb_each(v_items) loop
    if v_item.key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      or jsonb_typeof(v_item.value)<>'number' then raise exception 'Item devolvido inválido' using errcode='22023'; end if;
    select li.quantity into v_quantity from public._delivery_items_for_stop(_stop_id) li
      where li.id=v_item.key::uuid and li.tenant_id=v_stop.tenant_id and exists(select 1 from public.dispatch_stop_documents d
        where d.dispatch_stop_id=_stop_id and d.tenant_id=v_stop.tenant_id and d.fiscal_document_id=li.fiscal_document_id) for share;
    if not found or v_quantity is null or (v_item.value::text)::numeric<=0 or (v_item.value::text)::numeric>v_quantity then
      raise exception 'Quantidade devolvida fora dos itens desta parada' using errcode='22023'; end if;
    v_returned:=v_returned+(v_item.value::text)::numeric;
  end loop;
  if _outcome in('delivered','failed','skipped','cancelled') and v_returned>0 then
    raise exception 'Resultado incompatível com itens devolvidos' using errcode='22023'; end if;
  if _outcome='partial_delivery' then
    select sum(li.quantity) into v_total from public._delivery_items_for_stop(_stop_id) li where li.tenant_id=v_stop.tenant_id
      and not(li.fiscal_document_id=any(v_preserved)) and exists(
      select 1 from public.dispatch_stop_documents d where d.dispatch_stop_id=_stop_id and d.fiscal_document_id=li.fiscal_document_id and d.tenant_id=v_stop.tenant_id);
    if v_returned<=0 or v_total is null or v_returned>=v_total then
      raise exception 'Entrega parcial exige quantidade devolvida menor que o total' using errcode='22023'; end if;
  end if;
  if _outcome in('returned','refused') and v_returned>0 then
    if exists(select 1 from public._delivery_items_for_stop(_stop_id) li where not(li.fiscal_document_id=any(v_preserved)) and exists(select 1 from public.dispatch_stop_documents d
      where d.dispatch_stop_id=_stop_id and d.fiscal_document_id=li.fiscal_document_id)
      and (li.quantity is null or li.quantity<=0 or coalesce((v_items->>li.id::text)::numeric,0)<>li.quantity)) then
      raise exception 'Devolução total exige todos os itens, ou apenas o motivo quando não detalhados' using errcode='22023'; end if;
  end if;
  select case when count(*)=1 then (array_agg(load_id))[1] end into v_single_load
    from public.dispatch_trip_loads where dispatch_trip_id=v_trip.id and tenant_id=v_stop.tenant_id;
  select array_agg(distinct fiscal_document_id) into v_docs from public.dispatch_stop_documents
    where dispatch_stop_id=_stop_id and tenant_id=v_stop.tenant_id;
  select array_agg(distinct coalesce(d.load_id,f.load_id,v_single_load)) filter(where coalesce(d.load_id,f.load_id,v_single_load) is not null)
    into v_loads from public.dispatch_stop_documents d join public.delivery_allocation_documents f on f.allocation_id=d.id
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
    join public.delivery_allocation_documents f on f.allocation_id=d.id
    where d.dispatch_stop_id=_stop_id and d.tenant_id=v_stop.tenant_id order by f.id loop
    -- Operation can confirm notes individually. Preserve those canonical results
    -- and proofs while the driver confirms only the remaining cargo.
    if v_fd.id=any(v_preserved) then continue;end if;
    v_doc_outcome:=case when _outcome='skipped' then 'not_delivered' else _outcome end;
    if _outcome='partial_delivery' then
      select sum(li.quantity),sum(coalesce((v_items->>li.id::text)::numeric,0)) into v_doc_total,v_doc_returned
        from public._delivery_items_for_stop(_stop_id) li where li.fiscal_document_id=v_fd.id and li.tenant_id=v_stop.tenant_id;
      if v_doc_total is null or v_doc_total<=0 or exists(select 1 from public._delivery_items_for_stop(_stop_id)
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
      into v_stop_outcome from public.dispatch_stop_documents d join public.delivery_allocation_documents f on f.allocation_id=d.id
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
$function$;

-- GENERATED ADAPTER: get_client_portal_summary
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
                   JOIN public.current_dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
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
                          JOIN public.current_dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                          JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                          WHERE ds.planned_arrival_at::date = CURRENT_DATE),
    'deliveries_tomorrow', (SELECT count(*) FROM fds fd
                             JOIN public.current_dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                             JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                             WHERE ds.planned_arrival_at::date = CURRENT_DATE + 1)
  ) INTO _result;
  RETURN _result;
END; $function$;

-- GENERATED ADAPTER: search_client_portal_shipments
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
            OR oe.dispatch_stop_id IN (SELECT dsd.dispatch_stop_id FROM public.current_dispatch_stop_documents dsd WHERE dsd.fiscal_document_id = fd.id)
            OR (oe.client_id IS NOT NULL AND oe.client_id = fd.client_id
                AND (oe.fiscal_document_id IS NULL OR oe.fiscal_document_id = fd.id))
          )
      ) AS has_open_occurrence,
      public.get_public_shipment_status(fd.id) AS public_status
    FROM public.fiscal_documents fd
    LEFT JOIN public.loads l ON l.id = fd.load_id
    LEFT JOIN public.current_dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
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

-- GENERATED ADAPTER: get_public_shipment_status
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
  FROM public.current_dispatch_stop_documents dsd
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
          SELECT dsd.dispatch_stop_id FROM public.current_dispatch_stop_documents dsd
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

-- GENERATED ADAPTER: get_client_portal_summary_v2
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
                JOIN public.current_dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
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
                         JOIN public.current_dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                         JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                         WHERE ds.planned_arrival_at::date = CURRENT_DATE),
    'deliveries_tomorrow', (SELECT count(*) FROM fds fd
                            JOIN public.current_dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                            JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                            WHERE ds.planned_arrival_at::date = CURRENT_DATE + 1),
    'documents_last_7_days', (SELECT count(*) FROM fds WHERE issue_date >= CURRENT_DATE - 7)
  ) INTO _result;

  RETURN _result;
END;
$function$;

-- GENERATED ADAPTER: get_client_portal_upcoming_deliveries
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
    LEFT JOIN public.current_dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
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

-- GENERATED ADAPTER: get_client_portal_alerts
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
      JOIN public.current_dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
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

-- GENERATED ADAPTER: get_client_portal_reports_summary
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
      SELECT 1 FROM public.current_dispatch_stop_documents dsd
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
    JOIN public.current_dispatch_stop_documents dsd ON dsd.fiscal_document_id = f.id
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

-- GENERATED ADAPTER: get_client_portal_tracking
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
             SELECT ds3.planned_arrival_at FROM public.current_dispatch_stop_documents dsd3
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

-- GENERATED ADAPTER: search_client_portal_shipments_v2
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
            OR oe.dispatch_stop_id IN (SELECT dsd.dispatch_stop_id FROM public.current_dispatch_stop_documents dsd WHERE dsd.fiscal_document_id = fd.id)
            OR (oe.client_id IS NOT NULL AND oe.client_id = fd.client_id
                AND (oe.fiscal_document_id IS NULL OR oe.fiscal_document_id = fd.id)))
      ) AS has_open_occurrence,
      public.get_public_shipment_status(fd.id) AS public_status
    FROM public.fiscal_documents fd
    LEFT JOIN public.loads l ON l.id = fd.load_id
    LEFT JOIN public.current_dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
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

-- GENERATED ADAPTER: get_client_portal_reports_summary_v2
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
      SELECT 1 FROM public.current_dispatch_stop_documents dsd
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
    JOIN public.current_dispatch_stop_documents dsd ON dsd.fiscal_document_id = f.id
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

-- GENERATED ADAPTER: get_client_portal_shipment_detail
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
  FROM public.current_dispatch_stop_documents dsd
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

-- GENERATED ADAPTER: get_client_portal_shipment_detail_v2
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
  FROM public.current_dispatch_stop_documents dsd
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

-- CANONICAL ADAPTERS

-- READ MODELS AND FINANCIAL PROJECTION

create function public._delivery_trip_financial_documents(_tenant uuid,_trip uuid)
returns setof public.fiscal_documents language plpgsql stable security invoker set search_path='' as $fn$
declare v_doc uuid;d public.dispatch_stop_documents%rowtype;f public.fiscal_documents%rowtype;
begin
 for v_doc in select distinct id from(
  select x.id from public.fiscal_documents x where x.tenant_id=_tenant and x.load_id in(select load_id from public.dispatch_trip_loads where dispatch_trip_id=_trip and tenant_id=_tenant)
  union select x.fiscal_document_id from public.dispatch_stop_documents x join public.dispatch_stops s on s.id=x.dispatch_stop_id
   where s.dispatch_trip_id=_trip and s.tenant_id=_tenant and x.tenant_id=_tenant) ids order by id loop
  select x.* into d from public.dispatch_stop_documents x join public.dispatch_stops s on s.id=x.dispatch_stop_id
   where s.dispatch_trip_id=_trip and x.fiscal_document_id=v_doc and x.tenant_id=_tenant order by x.id limit 1;
  if found then f:=public._delivery_allocation_document(d.id);
  else select * into strict f from public.fiscal_documents where id=v_doc and tenant_id=_tenant;end if;
  if f.current_delivery_attempt_id is not null then
   -- Reuse identity, never automatically charge the freight from a prior leg.
   f.delivery_meta:=coalesce(f.delivery_meta,'{}'::jsonb)||jsonb_build_object('redelivery_freight_review_required',true,'original_freight_value',f.freight_value);
   f.freight_value:=0;
   select coalesce(sum(i.weight_kg),0) into f.weight_kg from public.load_items i where i.fiscal_document_id=f.id and i.load_id=f.load_id
    and i.delivery_attempt_id is not distinct from f.current_delivery_attempt_id;
  end if;
  return next f;
 end loop;
end;
$fn$;
revoke all on function public._delivery_trip_financial_documents(uuid,uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public._build_driver_settlement(_tenant_id uuid, _dispatch_trip_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trip record;
  v_settlement_id uuid;
  v_existing_status text;
  v_was_new boolean := false;
  v_loads_count int := 0;
  v_stops_count int := 0;
  v_documents_count int := 0;
  v_total_goods numeric := 0;
  v_total_freight_rev numeric := 0;
  v_total_weight numeric := 0;
  v_estimated_km numeric;
  v_appr numeric := 0;
  v_pend numeric := 0;
  v_rej numeric := 0;
  v_exp_total numeric := 0;
  v_appr_reimb numeric := 0;
  v_adj_credits numeric := 0;
  v_adj_debits numeric := 0;
  v_route_origin text;
  v_route_destination text;
  v_route_name text;
  v_total_paid numeric := 0;
  v_payable numeric := 0;
  v_route_result numeric := 0;
  v_snapshot jsonb;
  v_documents jsonb;v_has_redelivery boolean;v_requires_redelivery_review boolean;
BEGIN
  SELECT dt.* INTO v_trip
  FROM public.dispatch_trips dt
  WHERE dt.id = _dispatch_trip_id AND dt.tenant_id = _tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'trip_not_found'; END IF;

  SELECT id, status INTO v_settlement_id, v_existing_status
  FROM public.driver_settlements
  WHERE tenant_id = _tenant_id AND dispatch_trip_id = _dispatch_trip_id;

  IF v_settlement_id IS NOT NULL AND v_existing_status NOT IN ('pending_review','in_review','reopened') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;

  -- Materialize the trip-specific snapshot without caller-owned temp objects.
  select coalesce(jsonb_agg(to_jsonb(f) order by f.id),'[]'::jsonb),coalesce(bool_or(f.current_delivery_attempt_id is not null),false)
   into v_documents,v_has_redelivery from public._delivery_trip_financial_documents(_tenant_id,_dispatch_trip_id) f;
  v_requires_redelivery_review:=v_has_redelivery and (v_settlement_id is null or v_existing_status is distinct from 'in_review');

  SELECT
    (SELECT count(DISTINCT load_id) FROM (
       SELECT v_trip.load_id AS load_id WHERE v_trip.load_id IS NOT NULL
       UNION
       SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
     ) x WHERE load_id IS NOT NULL),
    (SELECT count(*) FROM public.dispatch_stops WHERE dispatch_trip_id = _dispatch_trip_id),
    jsonb_array_length(v_documents),
    COALESCE((SELECT sum(fd.value) FROM jsonb_populate_recordset(null::public.fiscal_documents,v_documents) fd
              WHERE COALESCE(fd.document_type,'nfe') NOT IN ('cte','ct-e','CTe')), 0),
    COALESCE((SELECT sum(COALESCE(NULLIF(fd.freight_value,0),
                          CASE WHEN COALESCE(fd.document_type,'nfe') IN ('cte','ct-e','CTe') THEN fd.value ELSE 0 END))
              FROM jsonb_populate_recordset(null::public.fiscal_documents,v_documents) fd), 0),
    COALESCE(NULLIF((SELECT sum(fd.weight_kg) FROM jsonb_populate_recordset(null::public.fiscal_documents,v_documents) fd),0),
             COALESCE((SELECT sum(l.total_weight_kg) FROM public.loads l WHERE l.id IN (
                SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
                UNION SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
             )),0))
  INTO v_loads_count, v_stops_count, v_documents_count, v_total_goods, v_total_freight_rev, v_total_weight;

  SELECT (tr.distance_meters / 1000.0) INTO v_estimated_km
  FROM public.trip_routes tr
  WHERE tr.tenant_id = _tenant_id AND tr.trip_id = _dispatch_trip_id
  ORDER BY (tr.provider = 'osrm') DESC, tr.created_at DESC LIMIT 1;

  -- Expenses split: total approved (route cost) vs. approved-AND-reimbursable (driver payable)
  SELECT
    COALESCE(sum(amount) FILTER (WHERE approval_status='approved'),0),
    COALESCE(sum(amount) FILTER (WHERE approval_status='pending'),0),
    COALESCE(sum(amount) FILTER (WHERE approval_status='rejected'),0),
    COALESCE(sum(amount),0),
    COALESCE(sum(amount) FILTER (WHERE approval_status='approved' AND COALESCE(reimbursable,true)=true),0)
  INTO v_appr, v_pend, v_rej, v_exp_total, v_appr_reimb
  FROM public.driver_expenses
  WHERE tenant_id = _tenant_id AND dispatch_trip_id = _dispatch_trip_id;

  -- Origin: prefer first linked load's origin; else null
  SELECT l.origin INTO v_route_origin
  FROM public.loads l
  WHERE l.id IN (
    SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
    UNION SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
  ) AND l.origin IS NOT NULL
  ORDER BY l.created_at ASC NULLS LAST
  LIMIT 1;

  -- If no load origin, use first stop destination as origin proxy
  IF v_route_origin IS NULL THEN
    SELECT ds.destination INTO v_route_origin
    FROM public.dispatch_stops ds
    WHERE ds.dispatch_trip_id = _dispatch_trip_id
    ORDER BY ds.stop_order ASC NULLS LAST, ds.created_at ASC NULLS LAST
    LIMIT 1;
  END IF;

  -- Destination: last stop's destination; fallback to load destination
  SELECT ds.destination INTO v_route_destination
  FROM public.dispatch_stops ds
  WHERE ds.dispatch_trip_id = _dispatch_trip_id
  ORDER BY ds.stop_order DESC NULLS LAST, ds.created_at DESC NULLS LAST
  LIMIT 1;

  IF v_route_destination IS NULL THEN
    SELECT l.destination INTO v_route_destination
    FROM public.loads l
    WHERE l.id IN (
      SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
      UNION SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
    ) AND l.destination IS NOT NULL
    ORDER BY l.created_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  v_route_name := v_trip.notes;
  v_route_result := COALESCE(v_total_freight_rev,0) - COALESCE(v_appr,0);

  IF v_settlement_id IS NULL THEN
    v_was_new := true;
    INSERT INTO public.driver_settlements (
      tenant_id, dispatch_trip_id, driver_id, vehicle_id, status,
      trip_started_at, trip_completed_at, route_name, route_origin, route_destination,
      loads_count, stops_count, documents_count,
      total_invoice_value, total_freight_value, total_weight_kg,
      total_goods_value, total_freight_revenue, route_result,
      estimated_km,
      approved_expenses_total, pending_expenses_total, rejected_expenses_total, expenses_total,
      driver_reimbursement_total,
      invoice_balance, operational_balance,
      last_recalculated_at, needs_recalculation, recalculation_reason
    ) VALUES (
      _tenant_id, _dispatch_trip_id, v_trip.driver_id, v_trip.vehicle_id, 'pending_review',
      v_trip.actual_start_at, v_trip.actual_end_at, v_route_name, v_route_origin, v_route_destination,
      v_loads_count, v_stops_count, v_documents_count,
      v_total_goods, v_total_freight_rev, v_total_weight,
      v_total_goods, v_total_freight_rev, v_route_result,
      v_estimated_km,
      v_appr, v_pend, v_rej, v_exp_total,
      v_appr_reimb,
      v_total_goods - v_appr, v_route_result,
      now(), false, NULL
    ) RETURNING id INTO v_settlement_id;
  END IF;

  SELECT
    COALESCE(sum(amount) FILTER (WHERE nature='credit'),0),
    COALESCE(sum(amount) FILTER (WHERE nature='debit'),0)
  INTO v_adj_credits, v_adj_debits
  FROM public.driver_settlement_items
  WHERE settlement_id = v_settlement_id AND item_type='adjustment';

  SELECT COALESCE(sum(amount),0) INTO v_total_paid
  FROM public.driver_settlement_payments WHERE settlement_id = v_settlement_id;

  v_payable := v_adj_credits + v_appr_reimb - v_adj_debits;

  -- Snapshot (fotografia)
  v_snapshot := jsonb_build_object(
    'calculation_version', 'driver_settlement_v3_attempts',
    'redelivery_review_required',v_requires_redelivery_review,
    'generated_at', now(),
    'trip', jsonb_build_object('id', v_trip.id, 'status', v_trip.status, 'started_at', v_trip.actual_start_at, 'ended_at', v_trip.actual_end_at, 'notes', v_trip.notes),
    'driver_id', v_trip.driver_id, 'vehicle_id', v_trip.vehicle_id,
    'route', jsonb_build_object('origin', v_route_origin, 'destination', v_route_destination, 'estimated_km', v_estimated_km),
    'loads', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM public.loads l WHERE l.id IN (
        SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
        UNION SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
      )), '[]'::jsonb),
    'documents', COALESCE((SELECT jsonb_agg(to_jsonb(fd)) FROM jsonb_populate_recordset(null::public.fiscal_documents,v_documents) fd), '[]'::jsonb),
    'expenses', COALESCE((SELECT jsonb_agg(to_jsonb(de)) FROM public.driver_expenses de WHERE de.tenant_id = _tenant_id AND de.dispatch_trip_id = _dispatch_trip_id), '[]'::jsonb),
    'totals', jsonb_build_object(
      'total_goods_value', v_total_goods,
      'total_freight_revenue', v_total_freight_rev,
      'approved_expenses_total', v_appr,
      'driver_reimbursement_total', v_appr_reimb,
      'route_result', v_route_result,
      'driver_credits_total', v_adj_credits,
      'driver_debits_total', v_adj_debits,
      'driver_payable_amount', v_payable,
      'total_paid_amount', v_total_paid,
      'payment_balance', v_payable - v_total_paid
    )
  );

  UPDATE public.driver_settlements SET
    driver_id = v_trip.driver_id,
    vehicle_id = v_trip.vehicle_id,
    trip_started_at = v_trip.actual_start_at,
    trip_completed_at = v_trip.actual_end_at,
    route_name = v_route_name,
    route_origin = v_route_origin,
    route_destination = v_route_destination,
    loads_count = v_loads_count,
    stops_count = v_stops_count,
    documents_count = v_documents_count,
    total_invoice_value = v_total_goods,
    total_freight_value = v_total_freight_rev,
    total_weight_kg = v_total_weight,
    total_goods_value = v_total_goods,
    total_freight_revenue = v_total_freight_rev,
    route_result = v_route_result,
    estimated_km = v_estimated_km,
    approved_expenses_total = v_appr,
    pending_expenses_total = v_pend,
    rejected_expenses_total = v_rej,
    expenses_total = v_exp_total,
    driver_reimbursement_total = v_appr_reimb,
    driver_credits_total = v_adj_credits,
    driver_debits_total = v_adj_debits,
    driver_payable_amount = v_payable,
    manual_adjustments_total = v_adj_credits - v_adj_debits,
    total_paid_amount = v_total_paid,
    payment_balance = v_payable - v_total_paid,
    invoice_balance = v_total_goods - v_appr,
    operational_balance = v_route_result,
    final_amount = v_payable,
    last_recalculated_at = now(),
    needs_recalculation = v_requires_redelivery_review,
    recalculation_reason = case when v_requires_redelivery_review then 'redelivery_pricing_review' else null end,
    snapshot_json = v_snapshot
  WHERE id = v_settlement_id;

  DELETE FROM public.driver_settlement_items
   WHERE settlement_id = v_settlement_id AND item_type <> 'adjustment';

  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
  SELECT _tenant_id, v_settlement_id, 'load', 'loads', l.id,
         COALESCE(l.load_number, l.origin || ' → ' || l.destination), 0, l.total_weight_kg,
         jsonb_build_object('origin', l.origin, 'destination', l.destination, 'status', l.status, 'pallets', l.total_pallet_count)
  FROM public.loads l
  WHERE l.id IN (
    SELECT v_trip.load_id WHERE v_trip.load_id IS NOT NULL
    UNION
    SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = _dispatch_trip_id
  );

  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
  SELECT _tenant_id, v_settlement_id, 'fiscal_document', 'fiscal_documents', fd.id,
         COALESCE(fd.invoice_number, fd.access_key), fd.value, fd.weight_kg,
         jsonb_build_object('document_type', fd.document_type, 'freight_value', fd.freight_value, 'recipient', fd.recipient, 'recipient_city', fd.recipient_city, 'recipient_state', fd.recipient_state, 'status', fd.status)
  FROM jsonb_populate_recordset(null::public.fiscal_documents,v_documents) fd;

  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
  SELECT _tenant_id, v_settlement_id, 'expense', 'driver_expenses', de.id,
         de.category, de.amount, NULL,
         jsonb_build_object('approval_status', de.approval_status, 'expense_at', de.expense_at, 'receipt_url', de.receipt_url, 'notes', de.notes,
                            'reimbursable', COALESCE(de.reimbursable, true), 'payment_source', COALESCE(de.payment_source,'driver'))
  FROM public.driver_expenses de
  WHERE de.tenant_id = _tenant_id AND de.dispatch_trip_id = _dispatch_trip_id;

  IF v_estimated_km IS NOT NULL THEN
    INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
    VALUES (_tenant_id, v_settlement_id, 'km', 'trip_routes', NULL, 'KM estimado (mapa)', 0, v_estimated_km, jsonb_build_object('provider','osrm'));
  END IF;

  PERFORM public._log_settlement_event(
    v_settlement_id,
    CASE WHEN v_was_new THEN 'generated' ELSE 'recalculated' END,
    NULL, NULL, NULL,
    jsonb_build_object('loads', v_loads_count, 'documents', v_documents_count, 'freight', v_total_freight_rev, 'goods', v_total_goods, 'expenses_approved', v_appr, 'driver_reimbursement', v_appr_reimb)
  );

  RETURN v_settlement_id;
END;
$function$
;

create function public.get_driver_delivery_items(_stop_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare s public.dispatch_stops%rowtype;
begin
 if auth.uid() is null then raise exception 'not_authorized' using errcode='42501';end if;
 select * into s from public.dispatch_stops where id=_stop_id;
 if not found then raise exception 'delivery_stop_not_found' using errcode='42501';end if;
 perform public._assert_driver_owns_trip(s.dispatch_trip_id);
 return jsonb_build_object('actor_id',auth.uid(),'tenant_id',s.tenant_id,'trip_id',s.dispatch_trip_id,'stop_id',s.id,
  'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'item_description',i.item_description,'quantity',i.quantity,
   'weight_kg',i.weight_kg,'volume_m3',i.volume_m3,'fiscal_document_id',i.fiscal_document_id,'document_status',f.status,
   'attempt_id',i.delivery_attempt_id,'is_historical',i.delivery_attempt_id is distinct from current_f.current_delivery_attempt_id) order by i.id)
   from public._delivery_items_for_stop(s.id) i join public.dispatch_stop_documents d on d.dispatch_stop_id=s.id and d.fiscal_document_id=i.fiscal_document_id
    and d.load_id=i.load_id and d.delivery_attempt_id is not distinct from i.delivery_attempt_id
   join public.delivery_allocation_documents f on f.allocation_id=d.id join public.fiscal_documents current_f on current_f.id=i.fiscal_document_id
   where i.tenant_id=s.tenant_id),'[]'::jsonb));
end;
$fn$;
revoke all on function public.get_driver_delivery_items(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_driver_delivery_items(uuid) to authenticated;

create function public.get_load_operational_documents(_tenant_id uuid,_load_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
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
   ||jsonb_build_object('is_historical',v_historical,'allocation_id',v_allocation));
 end loop;
 return jsonb_build_object('actor_id',auth.uid(),'tenant_id',_tenant_id,'load_id',_load_id,'documents',v_rows);
end;
$fn$;
revoke all on function public.get_load_operational_documents(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_load_operational_documents(uuid,uuid) to authenticated;

-- ACTIVATION: appended only after canonical adaptation and integrity guards.
create or replace function public._guard_recorded_delivery_document() returns trigger
language plpgsql security definer set search_path='' as $fn$
declare f public.fiscal_documents%rowtype;h public.delivery_document_outcomes%rowtype;a public.delivery_attempts%rowtype;k text;v_load uuid;
begin
 select * into f from public.fiscal_documents where id=new.id;
 if not found then return null;end if;
 if f.current_delivery_attempt_id is not null then
  select * into a from public.delivery_attempts where id=f.current_delivery_attempt_id;
  if not found or a.tenant_id is distinct from f.tenant_id or a.fiscal_document_id is distinct from f.id then
   raise exception 'Invalid current delivery attempt identity' using errcode='23514';end if;
  if f.delivery_meta->'redelivery' is distinct from 'true'::jsonb
   or f.delivery_meta->>'redelivery_reason' is distinct from a.reason
   or f.delivery_meta->'redelivery_at' is distinct from to_jsonb(a.recorded_at)
   or f.delivery_meta->>'delivery_attempt_id' is distinct from a.id::text then
   raise exception 'Delivery attempt metadata requires its audited identity' using errcode='23514';end if;
 end if;
 select * into h from public.active_delivery_document_outcomes where fiscal_document_id=f.id order by recorded_at desc,id desc limit 1;
 if not found then
  if f.current_delivery_attempt_id is null then return null;end if;
  select (array_agg(distinct load_id))[1] into v_load from public.current_load_items where fiscal_document_id=f.id;
  if f.status is distinct from 'confirmed' or f.load_id is distinct from v_load
   or (select count(distinct load_id) from public.current_load_items where fiscal_document_id=f.id)>1 then
   raise exception 'Unrecorded delivery attempt must retain its current composition' using errcode='23514';end if;
  foreach k in array array['ne','ne_reason','ne_at','delivery_at','correction_of','returned_items'] loop
   if coalesce(f.delivery_meta->k,'null'::jsonb)<>'null'::jsonb then raise exception 'New attempt cannot reuse a prior result' using errcode='23514';end if;
  end loop;
  return null;
 end if;
 if f.load_id is distinct from h.load_id or f.tenant_id is distinct from h.tenant_id or f.status is distinct from h.outcome then
  raise exception 'Recorded result requires audited correction or a new attempt' using errcode='23514';end if;
 foreach k in array array['ne','ne_reason','ne_at','delivery_at','correction_of','returned_items'] loop
  if coalesce(f.delivery_meta->k,'null'::jsonb) is distinct from coalesce(h.document_snapshot->'delivery_meta'->k,'null'::jsonb) then
   raise exception 'Recorded result metadata requires audited correction' using errcode='23514';end if;
 end loop;
 return null;
end;
$fn$;

create or replace function public._delivery_attempt_activation_gate() returns trigger
language plpgsql security invoker set search_path='' as $fn$
begin
 if tg_op='INSERT' then
  if new.current_delivery_attempt_id is not null then raise exception 'New invoice cannot adopt an existing delivery attempt' using errcode='23514';end if;
 elsif new.current_delivery_attempt_id is distinct from old.current_delivery_attempt_id then
  if new.current_delivery_attempt_id is null or new.load_id is not null or new.status is distinct from 'confirmed'
   or new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id then
   raise exception 'Delivery release must start unassigned with its audited identity' using errcode='23514';end if;
  -- The separate head guard validates actor, immutable source snapshot and chain.
 end if;
 return new;
end;
$fn$;
