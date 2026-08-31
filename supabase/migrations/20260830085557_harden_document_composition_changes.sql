-- Local candidate: atomic invoice attachment/detachment, including planned stops.
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
declare c record;
begin
 for c in select * from(values
  ('public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])','5ad09d2beee5b419d9af5ebd5eb96753'),
  ('public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])','1dfac4d7f001d60ac388f7767609a3cf'),
  ('public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])','cb97d4e58d535240efc9be062cbd1593'),
  ('public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])','385f77f83284de737f01eeba4d466f53'),
  ('public.delete_load_item_v3(uuid,uuid)','4d28b1e151579934386be2ec0b8833c5'),
  ('public._assert_load_replanning_graph(uuid,uuid[])','88587d953ac20149f3beb9a825d42275'),
  ('public._load_replanning_snapshot(uuid,uuid[])','805fbe6706cde044e5904baaf6edea52'),
  ('public.delete_load_if_empty(uuid)','7e103b5a3c3c898aed492644c527c993'),
  ('public.is_tenant_operator_or_admin(uuid)','682f66029dc9bb798f9f329b4e8f95aa')
 ) contracts(signature,hash) loop
  if md5(replace(pg_get_functiondef(to_regprocedure(c.signature)),E'\r\n',E'\n')) is distinct from c.hash then
   raise exception 'Document composition dependency changed: %',c.signature;
  end if;
 end loop;
 if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in(
  '_lock_load_document_graph','_load_document_change_snapshot','_change_load_documents',
  'get_load_document_change_context','change_load_documents')) then raise exception 'Document composition API already exists';end if;
 if not exists(select 1 from pg_attribute where attrelid='public.idempotency_keys'::regclass and attname='response_body' and atttypid='jsonb'::regtype and not attisdropped)
  or not exists(select 1 from pg_class where oid='public.idempotency_keys'::regclass and relrowsecurity)
  or exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polcmd<>'r')
  or not exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polname='agvlog_select_authenticated'
    and md5(replace(pg_get_expr(polqual,polrelid),E'\r\n',E'\n'))='a5e2fc2cb8bbeb71640ea0bc13d8b3a8') then
  raise exception 'Document composition requires protected response cache';
 end if;
end;
$preflight$;

create function public._lock_load_document_graph(_tenant_id uuid,_load_id uuid)
returns jsonb language plpgsql security invoker set search_path=''
as $fn$
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
 perform id from public.dispatch_stop_documents where dispatch_stop_id=any(v_stops) order by id for update nowait;
 perform id from public.fiscal_documents where id in(select (x->>'id')::uuid from jsonb_array_elements(v_before->'documents') x) order by id for update nowait;
 perform id from public.load_items where load_id=any(v_loads) order by id for update nowait;
 if public._load_replanning_snapshot(_tenant_id,array[_load_id]) is distinct from v_before then
  raise exception 'composition_concurrent_change' using errcode='40001';end if;
 perform public._assert_load_replanning_graph(_tenant_id,array[_load_id]);
 return v_before;
exception when lock_not_available then raise exception 'composition_concurrent_change' using errcode='40001';
end;
$fn$;
revoke all on function public._lock_load_document_graph(uuid,uuid) from public,anon,authenticated,service_role;

create function public._load_document_change_snapshot(_tenant_id uuid,_load_id uuid,_document_ids uuid[])
returns jsonb language sql stable security invoker set search_path=''
as $fn$
 select jsonb_build_object('graph',public._load_replanning_snapshot(_tenant_id,array[_load_id]),
  'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from (
   select id,tenant_id,load_id,document_type,status,deleted_at,updated_at,invoice_number,product_summary,pallet_count,weight_kg,
    cte_emitted_at,cte_emitted_outbound_id,nfse_emitted_at
   from public.fiscal_documents where id=any(_document_ids) and tenant_id=_tenant_id) d),'[]'::jsonb));
$fn$;
revoke all on function public._load_document_change_snapshot(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;

create function public.get_load_document_change_context(_tenant_id uuid,_load_id uuid,_document_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
declare v_snapshot jsonb;
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(_tenant_id),false) then raise exception 'not_authorized' using errcode='42501';end if;
 if coalesce(cardinality(_document_ids),0)=0 or cardinality(_document_ids)<>(select count(distinct id) from unnest(_document_ids) ids(id)) then
  raise exception 'invalid_document_selection' using errcode='22023';end if;
 perform public._assert_load_replanning_graph(_tenant_id,array[_load_id]);
 if (select count(*) from public.fiscal_documents where id=any(_document_ids) and tenant_id=_tenant_id)<>cardinality(_document_ids) then
  raise exception 'document_ownership_mismatch' using errcode='23514';end if;
 v_snapshot:=public._load_document_change_snapshot(_tenant_id,_load_id,_document_ids);
 return v_snapshot||jsonb_build_object('revision',encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex'));
end;
$fn$;
revoke all on function public.get_load_document_change_context(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_load_document_change_context(uuid,uuid,uuid[]) to authenticated;

create function public._change_load_documents(_tenant_id uuid,_load_id uuid,_document_ids uuid[],_action text,
 _target_stop jsonb,_reason text,_revision text)
returns jsonb language plpgsql security invoker set search_path=''
as $fn$
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
 perform id from public.load_items where fiscal_document_id=any(v_docs) order by id for update nowait;
 perform id from public.proof_of_delivery where fiscal_document_id=any(v_docs) order by id for update nowait;
 v_before:=public._load_document_change_snapshot(_tenant_id,_load_id,v_docs);
 if _revision is not null and encode(sha256(convert_to(v_before::text,'UTF8')),'hex') is distinct from _revision then
  raise exception 'document_change_revision_changed' using errcode='40001';end if;
 if exists(select 1 from public.fiscal_documents where id=any(v_docs) and
  (document_type is distinct from 'inbound' or deleted_at is not null or status='deleted')) then
  raise exception 'invalid_inbound_document' using errcode='23514';end if;
 if exists(select 1 from public.proof_of_delivery where fiscal_document_id=any(v_docs) and
  (tenant_id is distinct from _tenant_id or status in('uploaded','validated') or storage_path is not null or photo_url is not null or signature_url is not null or received_at is not null)) then
  raise exception 'replanning_has_delivery_evidence' using errcode='23514';end if;
 if exists(select 1 from public.fiscal_documents where id=any(v_docs) and (status in('delivered','returned','refused','failed','cancelled','partial_delivery','not_delivered')
  or cte_emitted_at is not null or cte_emitted_outbound_id is not null or nfse_emitted_at is not null)) then
  raise exception 'replanning_requires_fiscal_review' using errcode='23514';end if;
 if exists(select 1 from public.load_items where fiscal_document_id=any(v_docs) and (load_id<>_load_id or tenant_id<>_tenant_id)) then
  raise exception 'document_already_linked' using errcode='23514';end if;

 if _action='attach' then
  if exists(select 1 from public.fiscal_documents where id=any(v_docs) and load_id is not null and load_id<>_load_id) then
   raise exception 'document_already_linked' using errcode='23514';end if;
  select coalesce(array_agg(d.id order by d.id),array[]::uuid[]) into v_effective from public.fiscal_documents d
   where d.id=any(v_docs) and not exists(select 1 from public.load_items i where i.fiscal_document_id=d.id);
  if exists(select 1 from public.dispatch_stop_documents where fiscal_document_id=any(v_effective)) then
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
  insert into public.load_items(tenant_id,load_id,fiscal_document_id,item_description,pallet_count,weight_kg,volume_m3)
   select _tenant_id,_load_id,id,coalesce(nullif(product_summary,''),'Documento '||coalesce(invoice_number,id::text)),
    coalesce(pallet_count,0),coalesce(weight_kg,0),0 from public.fiscal_documents where id=any(v_effective);
  get diagnostics v_items=row_count;
  if v_stop is not null then insert into public.dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id,load_id)
   select _tenant_id,v_stop,id,_load_id from unnest(v_effective) docs(id);end if;
 else
  if exists(select 1 from public.fiscal_documents d where d.id=any(v_docs) and
    (d.load_id is distinct from _load_id or not exists(select 1 from public.load_items i where i.fiscal_document_id=d.id and i.load_id=_load_id))) then
   raise exception 'document_selection_changed' using errcode='23514';end if;
  delete from public.dispatch_stop_documents where fiscal_document_id=any(v_docs) and dispatch_stop_id=any(v_stops);
  with retired as(update public.dispatch_stops s set status='cancelled',updated_at=clock_timestamp(),
   notes=concat_ws(E'\n',nullif(s.notes,''),'Remoção de documentos: '||_reason)
   where s.id=any(v_stops) and s.status='pending' and not exists(select 1 from public.dispatch_stop_documents where dispatch_stop_id=s.id)
   returning id) select coalesce(array_agg(id order by id),array[]::uuid[]) into v_retired from retired;
  -- Detach a soon-empty load BEFORE mirror-trigger cleanup can remove it.
  if v_trip is not null and not exists(select 1 from public.load_items where load_id=_load_id
    and (fiscal_document_id is null or not(fiscal_document_id=any(v_docs)))) then
   delete from public.dispatch_trip_loads where load_id=_load_id and dispatch_trip_id=v_trip;
   if not exists(select 1 from public.dispatch_trip_loads where dispatch_trip_id=v_trip) then
    update public.dispatch_trips set status='cancelled',updated_at=clock_timestamp() where id=v_trip;v_cancelled:=array[v_trip];
   end if;
  end if;
  delete from public.load_items where fiscal_document_id=any(v_docs) and load_id=_load_id and tenant_id=_tenant_id;
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
$fn$;
revoke all on function public._change_load_documents(uuid,uuid,uuid[],text,jsonb,text,text) from public,anon,authenticated,service_role;

create function public.change_load_documents(_payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
declare v_tenant uuid;v_load uuid;v_actor uuid:=auth.uid();v_request uuid;v_key text;v_hash text;v_docs uuid[];
 v_cached public.idempotency_keys%rowtype;v_result jsonb;
begin
 if jsonb_typeof(_payload) is distinct from 'object' then raise exception 'invalid_document_change' using errcode='22023';end if;
 v_tenant:=(_payload->>'tenant_id')::uuid;v_load:=(_payload->>'load_id')::uuid;v_request:=(_payload->>'request_id')::uuid;
 if v_actor is null or not coalesce(public.is_tenant_operator_or_admin(v_tenant),false) then raise exception 'not_authorized' using errcode='42501';end if;
 if v_request is null or v_load is null or jsonb_typeof(_payload->'document_ids') is distinct from 'array'
  or coalesce(_payload->>'revision','')!~'^[0-9a-f]{64}$' then raise exception 'invalid_document_change' using errcode='22023';end if;
 select array_agg(value::uuid order by value::uuid) into v_docs from jsonb_array_elements_text(_payload->'document_ids');
 v_key:='change_load_documents:'||v_actor::text||':'||v_request::text;
 v_hash:=encode(sha256(convert_to((_payload-'request_id')::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('change_load_documents'),hashtext(v_tenant::text||':'||v_key));
 perform tenant_id from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active
  and role::text in('owner','admin','operator') for share nowait;
 if not found then raise exception 'not_authorized' using errcode='42501';end if;
 select * into v_cached from public.idempotency_keys where tenant_id=v_tenant and key_value=v_key;
 if found then
  if v_cached.operation is distinct from 'change_load_documents' or v_cached.payload_hash is distinct from v_hash then
   raise exception 'document_change_idempotency_mismatch' using errcode='22023';end if;
  if v_cached.response_body->>'request_id' is distinct from v_request::text then
   raise exception 'document_change_replay_requires_reconciliation' using errcode='23514';end if;
  return v_cached.response_body;
 end if;
 if _payload->>'action'='attach' and jsonb_typeof(_payload->'target_stop') is distinct from 'object' then
  raise exception 'explicit_document_stop_required' using errcode='22023';end if;
 v_result:=public._change_load_documents(v_tenant,v_load,v_docs,_payload->>'action',_payload->'target_stop',_payload->>'reason',_payload->>'revision')
  ||jsonb_build_object('request_id',v_request);
 insert into public.idempotency_keys(tenant_id,key_value,operation,idempotency_key,payload_hash,result_id,response_body)
  values(v_tenant,v_key,'change_load_documents',v_request::text,v_hash,v_request,v_result);
 return v_result;
exception when lock_not_available then raise exception 'composition_concurrent_change' using errcode='40001';
end;
$fn$;
revoke all on function public.change_load_documents(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.change_load_documents(jsonb) to authenticated;

-- Preserve legacy signatures and result fields. New attachments to planned routes
-- require the explicit API; retrying an existing attachment is a genuine no-op.
create or replace function public.assign_fiscal_documents_to_load(_tenant_id uuid,_load_id uuid,_document_ids uuid[])
returns jsonb language plpgsql security definer set search_path=''
as $fn$
begin return public._change_load_documents(_tenant_id,_load_id,_document_ids,'attach',null,'Inclusão pela operação',null);end;
$fn$;
create or replace function public.assign_fiscal_documents_to_load_v2(_tenant_id uuid,_load_id uuid,_document_ids uuid[])
returns jsonb language sql security definer set search_path=''
as $fn$ select public.assign_fiscal_documents_to_load(_tenant_id,_load_id,_document_ids); $fn$;
create or replace function public.remove_fiscal_documents_from_load(_tenant_id uuid,_load_id uuid,_document_ids uuid[])
returns jsonb language plpgsql security definer set search_path=''
as $fn$
begin return public._change_load_documents(_tenant_id,_load_id,_document_ids,'detach',null,'Remoção pela operação',null);end;
$fn$;
create or replace function public.remove_fiscal_documents_from_load_v2(_tenant_id uuid,_load_id uuid,_document_ids uuid[])
returns jsonb language sql security definer set search_path=''
as $fn$ select public.remove_fiscal_documents_from_load(_tenant_id,_load_id,_document_ids); $fn$;
revoke all on function public.assign_fiscal_documents_to_load(uuid,uuid,uuid[]),public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[]),
 public.remove_fiscal_documents_from_load(uuid,uuid,uuid[]),public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.assign_fiscal_documents_to_load(uuid,uuid,uuid[]),public.remove_fiscal_documents_from_load(uuid,uuid,uuid[]) to authenticated,service_role;
grant execute on function public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[]),public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[]) to authenticated;

create or replace function public.delete_load_item_v3(p_tenant_id uuid,p_item_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $fn$
declare v_load uuid;v_item public.load_items%rowtype;
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(p_tenant_id),false) then raise exception 'not_authorized' using errcode='42501';end if;
 select load_id into v_load from public.load_items where id=p_item_id and tenant_id=p_tenant_id;
 if not found then return false;end if;
 perform public._lock_load_document_graph(p_tenant_id,v_load);
 select * into v_item from public.load_items where id=p_item_id and tenant_id=p_tenant_id and load_id=v_load for update nowait;
 if not found then raise exception 'composition_items_changed' using errcode='40001';end if;
 if v_item.fiscal_document_id is not null then
  if (select count(*) from public.load_items where fiscal_document_id=v_item.fiscal_document_id)>1 then
   raise exception 'document_remove_requires_document_api' using errcode='23514';end if;
  perform public._change_load_documents(p_tenant_id,v_load,array[v_item.fiscal_document_id],'detach',null,'Remoção do item documental pela operação',null);
 else
  delete from public.load_items where id=p_item_id;
  perform public._log_entity_audit(p_tenant_id,'load_item',p_item_id,'delete',to_jsonb(v_item),null,'delete_load_item_v3');
  perform public.delete_load_if_empty(v_load);
 end if;
 return true;
exception when lock_not_available then raise exception 'composition_concurrent_change' using errcode='40001';
end;
$fn$;
revoke all on function public.delete_load_item_v3(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.delete_load_item_v3(uuid,uuid) to authenticated;
