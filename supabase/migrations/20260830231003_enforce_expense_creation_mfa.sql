-- Forward correction: preserves all expense/receipt evidence and request identities.
-- Deploy with the gateway change: receipt authorization uses the caller JWT.
set local lock_timeout='3s';set local statement_timeout='30s';
do $preflight$
declare c record;p record;
begin
 if to_regnamespace('expense_creation_private') is not null then raise exception 'Expense MFA migration already installed';end if;
 if not pg_try_advisory_xact_lock(hashtext('driver-expense-release'),1) then raise exception 'expense_creation_release_active_requests' using errcode='55000';end if;
 for c in select * from(values
 ('public.get_expense_creation_context(uuid,text,uuid)','d6035e659b850c3ff558f437ef1c4e82'),
 ('public.get_expense_receipt_status(uuid,uuid,text,uuid,jsonb)','f68b48fe31fdf8c13213e6bbfed12152'),
 ('public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb)','d5d7d0bb8c3a9fd2c7b961fae5c33491'),
 ('public.create_driver_expense_command(jsonb)','4dab9fd4989cd43c467424ad95eba0ae'),
 ('public.list_driver_expenses(uuid,integer)','6b0769db140992572d563bf0b9fc1619'),
 ('public.list_driver_expense_sources(uuid,integer)','07590bc808ebc42cb429494937a24577'),
 ('public.recalculate_manual_expense_settlement(uuid,uuid)','b8fedb8e21d723b2825758696c0e8b0f')
 ) expected(signature,hash) loop
  select * into p from pg_proc where oid=to_regprocedure(c.signature);
  if p.oid is null or not p.prosecdef or md5(replace(p.prosrc,E'\r\n',E'\n'))<>c.hash then
   raise exception 'Expense MFA preflight: unexpected implementation %',c.signature;end if;
  if has_function_privilege('anon',p.oid,'execute')
   or has_function_privilege('authenticated',p.oid,'execute') is distinct from (c.signature not like 'public.inspect_expense_receipt_upload%')
   or has_function_privilege('service_role',p.oid,'execute') is distinct from (c.signature like 'public.inspect_expense_receipt_upload%') then
   raise exception 'Expense MFA preflight: release/grants changed %',c.signature;end if;
 end loop;
end;$preflight$;
create schema expense_creation_private;
revoke all on schema expense_creation_private from public,anon,authenticated,service_role;
grant usage on schema expense_creation_private to authenticated;

create function expense_creation_private.require_session(_tenant uuid,_actor uuid) returns void
language plpgsql stable security invoker set search_path='' as $fn$
declare v_role text;
begin
 if auth.uid() is null or _actor is distinct from auth.uid() then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 select role::text into v_role from public.tenant_memberships where tenant_id=_tenant and user_id=_actor and active;
 if v_role is null or v_role not in('owner','admin','operator','driver') then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 if v_role in('owner','admin') and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then
  raise exception 'expense_creation_mfa_required' using errcode='42501';end if;
end;$fn$;
revoke all on function expense_creation_private.require_session(uuid,uuid) from public,anon,authenticated,service_role;

create function expense_creation_private.session_allowed(_tenant uuid) returns boolean
language sql stable security definer set search_path='' as $fn$
 select auth.uid() is not null and exists(select 1 from public.tenant_memberships m
  where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role::text in('owner','admin','operator','driver')
  and (m.role::text not in('owner','admin') or coalesce(auth.jwt()->>'aal','aal1')='aal2'));
$fn$;
revoke all on function expense_creation_private.session_allowed(uuid) from public,anon,authenticated,service_role;
grant execute on function expense_creation_private.session_allowed(uuid) to authenticated;
alter function public.get_expense_creation_context(uuid,text,uuid) set schema expense_creation_private;
create or replace function expense_creation_private.get_expense_creation_context(_tenant_id uuid,_source_type text,_source_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $fn$
begin
 perform expense_creation_private.require_session(_tenant_id,auth.uid());
 perform public._guard_expense_creation_release();
 return public._expense_creation_source(_tenant_id,auth.uid(),_source_type,_source_id)-'evidence';
end;
$fn$;
revoke all on function expense_creation_private.get_expense_creation_context(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function expense_creation_private.get_expense_creation_context(uuid,text,uuid) to authenticated;
create function public.get_expense_creation_context(_tenant_id uuid,_source_type text,_source_id uuid) returns jsonb
language sql volatile security invoker set search_path='' as $fn$
 select expense_creation_private.get_expense_creation_context(_tenant_id,_source_type,_source_id);
$fn$;
revoke all on function public.get_expense_creation_context(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_expense_creation_context(uuid,text,uuid) to authenticated;
alter function public.get_expense_receipt_status(uuid,uuid,text,uuid,jsonb) set schema expense_creation_private;
create or replace function expense_creation_private.get_expense_receipt_status(_tenant_id uuid,_request_id uuid,_source_type text,_source_id uuid,_receipt jsonb) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
begin
 perform expense_creation_private.require_session(_tenant_id,auth.uid());
 perform public._expense_creation_source(_tenant_id,auth.uid(),_source_type,_source_id);
 return public._expense_receipt_status(_tenant_id,auth.uid(),_request_id,_source_type,_source_id,_receipt)-'metadata';
end;$fn$;
revoke all on function expense_creation_private.get_expense_receipt_status(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function expense_creation_private.get_expense_receipt_status(uuid,uuid,text,uuid,jsonb) to authenticated;
create function public.get_expense_receipt_status(_tenant_id uuid,_request_id uuid,_source_type text,_source_id uuid,_receipt jsonb) returns jsonb
language sql stable security invoker set search_path='' as $fn$
 select expense_creation_private.get_expense_receipt_status(_tenant_id,_request_id,_source_type,_source_id,_receipt);
$fn$;
revoke all on function public.get_expense_receipt_status(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_expense_receipt_status(uuid,uuid,text,uuid,jsonb) to authenticated;
alter function public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb) set schema expense_creation_private;
create or replace function expense_creation_private.inspect_expense_receipt_upload(_tenant_id uuid,_actor_id uuid,_request_id uuid,_source_type text,_source_id uuid,_receipt jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $fn$
declare v_source jsonb;begin
 perform expense_creation_private.require_session(_tenant_id,_actor_id);
 perform public._guard_expense_creation_release();
 v_source:=public._expense_creation_source(_tenant_id,_actor_id,_source_type,_source_id);
 if not (v_source->>'can_create')::boolean then raise exception 'expense_creation_source_locked' using errcode='23514';end if;
 return public._expense_receipt_status(_tenant_id,_actor_id,_request_id,_source_type,_source_id,_receipt);
end;$fn$;
revoke all on function expense_creation_private.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function expense_creation_private.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb) to authenticated;
create function public.inspect_expense_receipt_upload(_tenant_id uuid,_actor_id uuid,_request_id uuid,_source_type text,_source_id uuid,_receipt jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $fn$
 select expense_creation_private.inspect_expense_receipt_upload(_tenant_id,_actor_id,_request_id,_source_type,_source_id,_receipt);
$fn$;
revoke all on function public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb) to authenticated;
alter function public.create_driver_expense_command(jsonb) set schema expense_creation_private;
create or replace function expense_creation_private.create_driver_expense_command(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_tenant uuid;v_actor uuid:=auth.uid();v_request uuid;v_type text;v_source_id uuid;v_role text;v_hash text;v_source jsonb;v_current jsonb;
 v_expense uuid:=gen_random_uuid();v_id uuid:=gen_random_uuid();v_time timestamptz;v_amount numeric;v_payment text;v_reimbursable boolean;v_receipt jsonb;v_path text;
 v_no_receipt boolean;v_reason text;v_fields jsonb;v_receipt_status jsonb;v_response jsonb;e public.driver_expenses%rowtype;h public.driver_expense_creations%rowtype;
begin
 perform public._guard_expense_creation_release();
 if _payload is null or jsonb_typeof(_payload)<>'object' or length(_payload::text)>25000 or _payload->'version' is distinct from '1'::jsonb
  or (_payload-array['version','tenant_id','actor_id','request_id','source_type','source_id','expected_revision','fields','receipt'])<>'{}'::jsonb then
  raise exception 'expense_creation_invalid_payload' using errcode='22023';end if;
 v_tenant:=(_payload->>'tenant_id')::uuid;v_request:=(_payload->>'request_id')::uuid;v_type:=_payload->>'source_type';v_source_id:=(_payload->>'source_id')::uuid;
 if v_actor is null or (_payload->>'actor_id')::uuid is distinct from v_actor then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 select role::text into v_role from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active;
 if v_role is null then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 perform expense_creation_private.require_session(v_tenant,v_actor);
 if v_request is null or v_source_id is null or v_type is null or v_type not in('trip','settlement') then raise exception 'expense_creation_invalid_source' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext('driver-expense-creation'),hashtext(v_tenant::text||':'||v_actor::text||':'||v_request::text));
 select role::text into v_role from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active for share nowait;
 if v_role is null then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 perform expense_creation_private.require_session(v_tenant,v_actor);
 v_hash:=encode(sha256(convert_to(_payload::text,'UTF8')),'hex');
 select * into h from public.driver_expense_creations where tenant_id=v_tenant and actor_id=v_actor and request_id=v_request;
 if found then
  if (h.source_type='settlement' and v_role not in('owner','admin','operator')) or (h.source_type='trip' and not exists(
    select 1 from public.drivers where tenant_id=v_tenant and id=h.driver_id and user_id=v_actor and active)) then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
  if h.payload_hash<>v_hash then raise exception 'expense_creation_request_key_mismatch' using errcode='22023';end if;return h.response;
 end if;
 v_source:=public._expense_creation_source(v_tenant,v_actor,v_type,v_source_id);
 perform 1 from public.dispatch_trips where tenant_id=v_tenant and id=(v_source->>'trip_id')::uuid for update nowait;
 perform 1 from public.drivers where tenant_id=v_tenant and id=(v_source->>'driver_id')::uuid for share nowait;
 perform 1 from public.driver_settlements where tenant_id=v_tenant and (id=(v_source->>'settlement_id')::uuid or dispatch_trip_id=(v_source->>'trip_id')::uuid) order by id for update nowait;
 v_current:=public._expense_creation_source(v_tenant,v_actor,v_type,v_source_id);
 if coalesce(_payload->>'expected_revision','')!~'^[a-f0-9]{32}$' or v_current->>'revision' is distinct from _payload->>'expected_revision'
  or v_current->>'revision' is distinct from v_source->>'revision' then raise exception 'expense_creation_context_changed' using errcode='40001';end if;
 if not (v_current->>'can_create')::boolean then raise exception 'expense_creation_source_locked' using errcode='23514';end if;
 v_fields:=_payload->'fields';v_receipt:=nullif(_payload->'receipt','null'::jsonb);
 if jsonb_typeof(v_fields) is distinct from 'object' or
  (v_fields-array['category','amount_cents','expense_at','payment_source','reimbursable','notes','supplier_name','document_number','city','state','odometer','cost_center','no_receipt','no_receipt_reason'])<>'{}'::jsonb
  or coalesce(v_fields->>'category','') not in('fuel','food','toll','maintenance','parking','other')
  or jsonb_typeof(v_fields->'amount_cents') is distinct from 'number' or coalesce(v_fields->>'amount_cents','')!~'^[0-9]+$'
  or jsonb_typeof(v_fields->'no_receipt') is distinct from 'boolean' or jsonb_typeof(v_fields->'reimbursable') is distinct from 'boolean' then
  raise exception 'expense_creation_invalid_fields' using errcode='22023';end if;
 v_amount:=(v_fields->>'amount_cents')::numeric/100;
 if v_amount<=0 or v_amount>999999999999.99 then raise exception 'expense_creation_invalid_amount' using errcode='22023';end if;
 if coalesce(v_fields->>'expense_at','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$' then
  raise exception 'expense_creation_invalid_date' using errcode='22023';end if;
 v_time:=(v_fields->>'expense_at')::timestamptz;
 if not isfinite(v_time) or v_time>clock_timestamp()+interval '5 minutes' then raise exception 'expense_creation_invalid_date' using errcode='22023';end if;
 v_payment:=v_fields->>'payment_source';v_reimbursable:=(v_fields->>'reimbursable')::boolean;
 if v_payment is null or v_payment not in('driver','advance','company_card','company_account','other')
  or (v_payment in('company_card','company_account') and v_reimbursable)
  or (v_payment='advance' and not v_reimbursable) then raise exception 'expense_creation_invalid_payment_source' using errcode='22023';end if;
 if exists(select 1 from jsonb_each(v_fields) field where field.key in('notes','supplier_name','document_number','city','state','cost_center','no_receipt_reason')
   and field.value<>'null'::jsonb and (jsonb_typeof(field.value)<>'string' or length(field.value#>>'{}')>2000)) then
  raise exception 'expense_creation_invalid_text' using errcode='22023';end if;
 if v_type='settlement' and nullif(btrim(v_fields->>'cost_center'),'') is null then raise exception 'expense_creation_cost_center_required' using errcode='22023';end if;
 if nullif(v_fields->'odometer','null'::jsonb) is not null and (jsonb_typeof(v_fields->'odometer')<>'number'
  or (v_fields->>'odometer')::numeric<0 or (v_fields->>'odometer')::numeric>999999999) then raise exception 'expense_creation_invalid_odometer' using errcode='22023';end if;
 v_no_receipt:=(v_fields->>'no_receipt')::boolean;v_reason:=nullif(btrim(v_fields->>'no_receipt_reason'),'');
 if v_no_receipt then
  if v_receipt is not null or v_reason is null or length(v_reason)<5 then raise exception 'expense_creation_missing_receipt_reason' using errcode='22023';end if;
 else
  if v_receipt is null or v_reason is not null then raise exception 'expense_creation_receipt_required' using errcode='22023';end if;
  v_receipt_status:=public._expense_receipt_descriptor(v_tenant,v_actor,v_request,v_receipt);v_path:=v_receipt_status->>'path';
  perform 1 from storage.objects where bucket_id='receipts' and name=v_path for share nowait;
  v_receipt_status:=public._expense_receipt_status(v_tenant,v_actor,v_request,v_type,v_source_id,v_receipt);
  if not (v_receipt_status->>'uploaded')::boolean then raise exception 'expense_receipt_not_uploaded' using errcode='23514';end if;
 end if;
 insert into public.driver_expenses(id,tenant_id,dispatch_trip_id,manual_settlement_id,driver_id,creation_command_id,category,amount,expense_at,payment_source,reimbursable,
  paid_with_advance,no_receipt,no_receipt_reason,receipt_url,notes,supplier_name,document_number,city,state,odometer,cost_center)
 values(v_expense,v_tenant,(v_current->>'trip_id')::uuid,(v_current->>'manual_settlement_id')::uuid,(v_current->>'driver_id')::uuid,v_id,
  v_fields->>'category',v_amount,v_time,v_payment,v_reimbursable,v_payment='advance',v_no_receipt,v_reason,v_path,
  nullif(btrim(v_fields->>'notes'),''),nullif(btrim(v_fields->>'supplier_name'),''),nullif(btrim(v_fields->>'document_number'),''),
  nullif(btrim(v_fields->>'city'),''),nullif(upper(btrim(v_fields->>'state')),''),(v_fields->>'odometer')::numeric,nullif(btrim(v_fields->>'cost_center'),''))
 returning * into e;
 v_response:=jsonb_build_object('version',1,'tenant_id',v_tenant,'actor_id',v_actor,'request_id',v_request,'expense_id',v_expense,'command_id',v_id,
  'source_type',v_type,'source_id',v_source_id,'driver_id',e.driver_id,'status','pending','confirmed',true,'receipt_path',v_path);
 insert into public.driver_expense_creations(id,tenant_id,actor_id,request_id,expense_id,driver_id,source_type,source_id,payload_hash,source_snapshot,expense_snapshot,response)
  values(v_id,v_tenant,v_actor,v_request,v_expense,e.driver_id,v_type,v_source_id,v_hash,v_current->'evidence',to_jsonb(e),v_response);
 return v_response;
exception when lock_not_available or deadlock_detected then raise exception 'expense_creation_concurrent_change' using errcode='40001';
end;$fn$;
revoke all on function expense_creation_private.create_driver_expense_command(jsonb) from public,anon,authenticated,service_role;
grant execute on function expense_creation_private.create_driver_expense_command(jsonb) to authenticated;
create function public.create_driver_expense_command(_payload jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $fn$
 select expense_creation_private.create_driver_expense_command(_payload);
$fn$;
revoke all on function public.create_driver_expense_command(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_driver_expense_command(jsonb) to authenticated;
alter function public.list_driver_expenses(uuid,integer) set schema expense_creation_private;
create or replace function expense_creation_private.list_driver_expenses(_tenant_id uuid,_offset integer default 0) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare v_total bigint;v_rows jsonb;
begin
 perform expense_creation_private.require_session(_tenant_id,auth.uid());
 if auth.uid() is null or not exists(select 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active)
  or not exists(select 1 from public.drivers where tenant_id=_tenant_id and user_id=auth.uid() and active) then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 if _offset is null or _offset<0 or _offset>1000000 then raise exception 'expense_creation_invalid_filter' using errcode='22023';end if;
 select count(*) into v_total from public.driver_expenses e join public.drivers d on d.tenant_id=e.tenant_id and d.id=e.driver_id
  where e.tenant_id=_tenant_id and d.user_id=auth.uid() and d.active;
 select coalesce(jsonb_agg(value order by expense_at desc,id),'[]') into v_rows from(
  select e.id,e.expense_at,to_jsonb(e)||jsonb_build_object('review_reason',h.reason,'driver_name',d.name) value from public.driver_expenses e
   join public.drivers d on d.tenant_id=e.tenant_id and d.id=e.driver_id
   left join public.driver_expense_reviews h on h.tenant_id=e.tenant_id and h.id=e.review_command_id
   where e.tenant_id=_tenant_id and d.user_id=auth.uid() and d.active order by e.expense_at desc,e.id limit 50 offset _offset) page;
 return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'offset',_offset,'total',v_total,'rows',v_rows);
end;$fn$;
revoke all on function expense_creation_private.list_driver_expenses(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function expense_creation_private.list_driver_expenses(uuid,integer) to authenticated;
create function public.list_driver_expenses(_tenant_id uuid,_offset integer default 0) returns jsonb
language sql stable security invoker set search_path='' as $fn$
 select expense_creation_private.list_driver_expenses(_tenant_id,_offset);
$fn$;
revoke all on function public.list_driver_expenses(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_driver_expenses(uuid,integer) to authenticated;
alter function public.list_driver_expense_sources(uuid,integer) set schema expense_creation_private;
create or replace function expense_creation_private.list_driver_expense_sources(_tenant_id uuid,_offset integer default 0) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare v_total bigint;v_rows jsonb;
begin
 perform expense_creation_private.require_session(_tenant_id,auth.uid());
 if auth.uid() is null or not exists(select 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active)
  or not exists(select 1 from public.drivers where tenant_id=_tenant_id and user_id=auth.uid() and active) then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 if _offset is null or _offset<0 or _offset>1000000 then raise exception 'expense_creation_invalid_filter' using errcode='22023';end if;
 select count(*) into v_total from public.dispatch_trips t join public.drivers d on d.tenant_id=t.tenant_id and d.id=t.driver_id
  where t.tenant_id=_tenant_id and d.user_id=auth.uid() and d.active and t.status in('planned','in_transit','completed');
 select coalesce(jsonb_agg(value order by priority,created_at desc,id),'[]') into v_rows from(
  select t.id,t.created_at,case t.status when 'in_transit' then 0 when 'planned' then 1 else 2 end priority,
   jsonb_build_object('id',t.id,'driver_id',d.id,'status',t.status,'notes',left(t.notes,500),'created_at',t.created_at,'actual_start_at',t.actual_start_at,'actual_end_at',t.actual_end_at) value
   from public.dispatch_trips t join public.drivers d on d.tenant_id=t.tenant_id and d.id=t.driver_id
   where t.tenant_id=_tenant_id and d.user_id=auth.uid() and d.active and t.status in('planned','in_transit','completed')
   order by priority,t.created_at desc,t.id limit 50 offset _offset) page;
 return jsonb_build_object('version',1,'tenant_id',_tenant_id,'actor_id',auth.uid(),'offset',_offset,'total',v_total,'rows',v_rows);
end;$fn$;
revoke all on function expense_creation_private.list_driver_expense_sources(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function expense_creation_private.list_driver_expense_sources(uuid,integer) to authenticated;
create function public.list_driver_expense_sources(_tenant_id uuid,_offset integer default 0) returns jsonb
language sql stable security invoker set search_path='' as $fn$
 select expense_creation_private.list_driver_expense_sources(_tenant_id,_offset);
$fn$;
revoke all on function public.list_driver_expense_sources(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_driver_expense_sources(uuid,integer) to authenticated;
alter function public.recalculate_manual_expense_settlement(uuid,uuid) set schema expense_creation_private;
create or replace function expense_creation_private.recalculate_manual_expense_settlement(_tenant_id uuid,_settlement_id uuid) returns uuid
 language plpgsql security definer set search_path='' as $fn$
begin
 perform expense_creation_private.require_session(_tenant_id,auth.uid());
 perform public._guard_expense_creation_release();
 if auth.uid() is null then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 perform 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active and role::text in('owner','admin','operator') for share nowait;
 if not found then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 perform expense_creation_private.require_session(_tenant_id,auth.uid());
 perform 1 from public.driver_settlements where tenant_id=_tenant_id and id=_settlement_id and is_manual and dispatch_trip_id is null for update nowait;
 if not found then raise exception 'expense_creation_source_not_found' using errcode='23514';end if;
 return public._build_manual_driver_settlement(_settlement_id);
exception when lock_not_available or deadlock_detected then raise exception 'expense_creation_concurrent_change' using errcode='40001';
end;$fn$;
revoke all on function expense_creation_private.recalculate_manual_expense_settlement(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function expense_creation_private.recalculate_manual_expense_settlement(uuid,uuid) to authenticated;
create function public.recalculate_manual_expense_settlement(_tenant_id uuid,_settlement_id uuid) returns uuid
language sql volatile security invoker set search_path='' as $fn$
 select expense_creation_private.recalculate_manual_expense_settlement(_tenant_id,_settlement_id);
$fn$;
revoke all on function public.recalculate_manual_expense_settlement(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.recalculate_manual_expense_settlement(uuid,uuid) to authenticated;
-- Restrictive boundaries cover direct-table reads as well as the RPCs.
create policy expense_creation_mfa_read on public.driver_expense_creations as restrictive for select to authenticated
 using(expense_creation_private.session_allowed(tenant_id));
create policy expense_mfa_read on public.driver_expenses as restrictive for select to authenticated
 using(expense_creation_private.session_allowed(tenant_id));
create policy expense_receipt_mfa_read on storage.objects as restrictive for select to authenticated using(
 bucket_id<>'receipts' or split_part(name,'/',2)<>'expense-receipts' or
 case when split_part(name,'/',1)~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 then expense_creation_private.session_allowed(split_part(name,'/',1)::uuid) else false end);
