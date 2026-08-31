-- LOCAL CANDIDATE: preparation edits cannot rewrite invoice identity or outcomes.
set local lock_timeout='3s';
set local statement_timeout='30s';
do $preflight$
declare c record;target oid;
begin
 if to_regprocedure('public.save_load_item_preparation(jsonb)') is not null then
  raise exception 'Load item preparation API already exists';end if;
 if not exists(select 1 from pg_attribute where attrelid='public.idempotency_keys'::regclass and attname='response_body'
   and atttypid='jsonb'::regtype and not attnotnull and not atthasdef and not attisdropped)
  or not exists(select 1 from pg_class where oid='public.idempotency_keys'::regclass and relrowsecurity)
  or exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polcmd<>'r')
  or not exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass and polname='agvlog_select_authenticated'
   and md5(replace(pg_get_expr(polqual,polrelid),E'\r\n',E'\n'))='a5e2fc2cb8bbeb71640ea0bc13d8b3a8') then
   raise exception 'Load item preparation requires protected response cache';end if;
 for c in select * from(values
  ('public.upsert_load_item_v3(uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,uuid)','62f819a77731d9fc694d7cd9bc4fe0db',true,false),
  ('public._lock_load_document_graph(uuid,uuid)','56f03495204150746ffd94a12a25b340',false,false),
  ('public._assert_load_replanning_graph(uuid,uuid[])','88587d953ac20149f3beb9a825d42275',false,false),
  ('public.recalc_load_totals()','7dc12046ecada4d2f04bb2942a92493d',false,true),
  ('public._sync_fiscal_document_load_mirror()','098af8ebf9e9defbc4153f7b6fba43e4',false,true)
 ) expected(signature,hash,authenticated,service_role) loop
  target:=to_regprocedure(c.signature);
  if md5(replace(pg_get_functiondef(target),E'\r\n',E'\n')) is distinct from c.hash
   or has_function_privilege('anon',target,'execute')
   or has_function_privilege('authenticated',target,'execute') is distinct from c.authenticated
   or has_function_privilege('service_role',target,'execute') is distinct from c.service_role then
    raise exception 'Load item preparation dependency changed: %',c.signature;
  end if;
 end loop;
end;
$preflight$;

create or replace function public.upsert_load_item_v3(
 p_tenant_id uuid,p_load_id uuid default null,p_item_id uuid default null,p_order_id uuid default null,
 p_item_description text default null,p_quantity numeric default null,p_pallet_count numeric default null,
 p_weight_kg numeric default null,p_volume_m3 numeric default null,p_status text default null,p_notes text default null,
 p_fiscal_document_id uuid default null)
returns uuid language plpgsql security definer set search_path=''
as $fn$
declare v_load uuid;v_item public.load_items%rowtype;v_next public.load_items%rowtype;v_number numeric;v_id uuid;
begin
 if auth.uid() is null or not coalesce(public.is_tenant_operator_or_admin(p_tenant_id),false) then
  raise exception 'not_authorized' using errcode='42501';end if;
 -- Shared barrier prevents recovery from replacing this writer during a commit.
 lock table public.idempotency_keys in access share mode;
 if p_item_id is not null then
  select load_id into v_load from public.load_items where id=p_item_id and tenant_id=p_tenant_id;
  if not found then raise exception 'load_item_not_found' using errcode='23514';end if;
  if p_load_id is not null and p_load_id<>v_load then raise exception 'load_change_requires_move_rpc' using errcode='23514';end if;
 else v_load:=p_load_id;end if;
 if v_load is null then raise exception 'load_not_found' using errcode='22023';end if;
 -- Parent graph first, then the item; never hold an item while waiting for a trip.
 perform public._lock_load_document_graph(p_tenant_id,v_load);
 if p_item_id is not null then
  select * into v_item from public.load_items where id=p_item_id and tenant_id=p_tenant_id and load_id=v_load for update nowait;
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
  perform id from public.proof_of_delivery where fiscal_document_id=v_item.fiscal_document_id order by id for update nowait;
  if exists(select 1 from public.proof_of_delivery where fiscal_document_id=v_item.fiscal_document_id and
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
  insert into public.load_items(tenant_id,load_id,order_id,item_description,quantity,pallet_count,weight_kg,volume_m3,status,notes)
   values(p_tenant_id,v_load,v_next.order_id,v_next.item_description,v_next.quantity,v_next.pallet_count,v_next.weight_kg,v_next.volume_m3,v_next.status,v_next.notes)
   returning * into v_next;
 else
  if v_next is not distinct from v_item then return v_item.id;end if;
  update public.load_items set order_id=v_next.order_id,item_description=v_next.item_description,quantity=v_next.quantity,
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
$fn$;
revoke all on function public.upsert_load_item_v3(uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.upsert_load_item_v3(uuid,uuid,uuid,uuid,text,numeric,numeric,numeric,numeric,text,text,uuid) to authenticated;

-- Recoverable frontend API. Expected values apply only to edited fields: an
-- unrelated update is preserved, but stale edits of the same field are rejected.
create function public.save_load_item_preparation(_payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $fn$
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
  select * into v_item from public.load_items where id=v_item_id and tenant_id=v_tenant and load_id=v_load for update nowait;
  if not found then raise exception 'composition_items_changed' using errcode='40001';end if;
  if not(to_jsonb(v_item) @> v_expected) then raise exception 'item_preparation_expected_changed' using errcode='40001';end if;
 end if;
 v_new_id:=public.upsert_load_item_v3(p_tenant_id=>v_tenant,p_load_id=>v_load,p_item_id=>v_item_id,
  p_order_id=>(v_values->>'order_id')::uuid,p_item_description=>v_values->>'item_description',p_quantity=>(v_values->>'quantity')::numeric,
  p_pallet_count=>(v_values->>'pallet_count')::numeric,p_weight_kg=>(v_values->>'weight_kg')::numeric,p_volume_m3=>(v_values->>'volume_m3')::numeric,
  p_status=>v_values->>'status',p_notes=>v_values->>'notes');
 select * into strict v_item from public.load_items where id=v_new_id;
 v_result:=jsonb_build_object('request_id',v_request,'tenant_id',v_tenant,'load_id',v_load,'item_id',v_new_id,
  'created',v_item_id is null,'totals_recalculated',true,'values',jsonb_build_object('order_id',v_item.order_id,
  'item_description',v_item.item_description,'quantity',v_item.quantity,'pallet_count',v_item.pallet_count,'weight_kg',v_item.weight_kg,
  'volume_m3',v_item.volume_m3,'status',v_item.status,'notes',v_item.notes));
 insert into public.idempotency_keys(tenant_id,key_value,operation,idempotency_key,payload_hash,result_id,response_body)
  values(v_tenant,v_key,'save_load_item_preparation',v_request::text,v_hash,v_new_id,v_result);
 return v_result;
exception when lock_not_available then raise exception 'composition_concurrent_change' using errcode='40001';
end;
$fn$;
revoke all on function public.save_load_item_preparation(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_load_item_preparation(jsonb) to authenticated;
