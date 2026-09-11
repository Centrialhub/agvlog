-- Atomic internal-only expense release. Apply as one transaction.
-- Staged finance.can_access=false remains unchanged. Existing operator table reads remain governed by legacy policies.
-- New financial APIs and all driver/mixed identities remain denied; no global Auth/chat/SSX rewrite.

-- SOURCE: supabase/migrations/20260830231003_enforce_expense_creation_mfa.sql
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


-- SOURCE: supabase/rollouts/finance_settlement_adjustments_current_auth.sql
-- Production candidate: original233637 body unchanged; accepts exact observed current password-policy authorizer.
-- Forward candidate: audited adjustment add/remove, no payment or fiscal action.
set local lock_timeout='3s';set local statement_timeout='30s';
do $preflight$ begin
 if to_regnamespace('expense_creation_private') is null or to_regclass('public.driver_settlement_adjustments') is not null then
  raise exception 'Adjustment release requires the MFA expense contract and an unapplied migration';end if;
end;$preflight$;
do $dependencies$ declare c record;begin
 for c in select * from(values ('public._build_driver_settlement(uuid,uuid)','0732d29f716ed074b9b215aff7569d03'),
('public._log_settlement_event(uuid,text,text,text,text,jsonb)','66b50396ce538929df80295c80446070'),
('public.is_tenant_operator_or_admin(uuid)','1345468a366a7b0b9ae62d3ec4825232'),
('public._delivery_allocation_document(uuid)','344801e75094a3f40f58e8fdbf7e97cc'),
('public._delivery_trip_financial_documents(uuid,uuid)','02296239569087e967b277309579dc8a'),
('public._preserve_closing_creation()','7400244049ef090f7c38dbd0856d78f8'),
('public._build_manual_driver_settlement(uuid)','2281ee623376f032433e7761b20c4ca3'),
('public.add_driver_settlement_adjustment(uuid,text,numeric,text,text)','bce03457eeb9512e253b391c21c55b37'),
('public.remove_driver_settlement_adjustment(uuid,uuid,text)','81a8a845ee473e44ba1da16819e00b56')) expected(signature,hash) loop
  if md5(replace(pg_get_functiondef(to_regprocedure(c.signature)),E'\r\n',E'\n')) is distinct from c.hash and not coalesce((c.signature='public.is_tenant_operator_or_admin(uuid)' and md5(replace(pg_get_functiondef(to_regprocedure(c.signature)),E'\r\n',E'\n'))='682f66029dc9bb798f9f329b4e8f95aa' and has_function_privilege('authenticated',to_regprocedure(c.signature),'execute') and has_function_privilege('service_role',to_regprocedure(c.signature),'execute') and not has_function_privilege('anon',to_regprocedure(c.signature),'execute')),false) then
   raise exception 'Settlement adjustment dependency changed: %',c.signature;end if;
 end loop;
end;$dependencies$;
create schema settlement_adjustment_private;
revoke all on schema settlement_adjustment_private from public,anon,authenticated,service_role;
grant usage on schema settlement_adjustment_private to authenticated;
create table public.driver_settlement_adjustments(
 id uuid primary key,tenant_id uuid not null,actor_id uuid not null,request_id uuid not null,settlement_id uuid not null,item_id uuid not null,
 action text not null check(action in('add','remove')),reason text not null,payload_hash text not null,
 before_snapshot jsonb not null,after_snapshot jsonb not null,response jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,actor_id,request_id),foreign key(tenant_id,settlement_id) references public.driver_settlements(tenant_id,id) on delete restrict
);
alter table public.driver_settlement_adjustments enable row level security;
revoke all on public.driver_settlement_adjustments from public,anon,authenticated,service_role;
grant select on public.driver_settlement_adjustments to authenticated;
create policy settlement_adjustment_internal_read on public.driver_settlement_adjustments for select to authenticated
 using(public.is_tenant_operator_or_admin(tenant_id));
create index settlement_adjustment_history_idx on public.driver_settlement_adjustments(tenant_id,settlement_id,created_at desc,id desc);
create trigger settlement_adjustment_append_only before update or delete on public.driver_settlement_adjustments
 for each row execute function public._preserve_closing_creation();

create function settlement_adjustment_private.authorize(_tenant uuid) returns void
language plpgsql stable security invoker set search_path='' as $fn$
declare v_role text;
begin
 if auth.uid() is null then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;
 select role::text into v_role from public.tenant_memberships where tenant_id=_tenant and user_id=auth.uid() and active;
 if v_role is null or v_role not in('owner','admin','operator') then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;
 if v_role in('owner','admin') and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'settlement_adjustment_mfa_required' using errcode='42501';end if;
end;$fn$;
revoke all on function settlement_adjustment_private.authorize(uuid) from public,anon,authenticated,service_role;

create function settlement_adjustment_private.cents(_amount numeric) returns bigint
language sql immutable security invoker set search_path='' as $fn$
 select case when _amount::text not in('NaN','Infinity','-Infinity') and abs(_amount)<=999999999999.99 and _amount=round(_amount,2) then (_amount*100)::bigint end;
$fn$;
revoke all on function settlement_adjustment_private.cents(numeric) from public,anon,authenticated,service_role;

create function settlement_adjustment_private.snapshot(_tenant uuid,_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $fn$
declare s public.driver_settlements%rowtype;v_evidence jsonb;v_items jsonb;v_bad boolean;v_result jsonb;
begin
 select * into s from public.driver_settlements where tenant_id=_tenant and id=_id;
 if not found then raise exception 'settlement_adjustment_not_found' using errcode='23514';end if;
 if not exists(select 1 from public.drivers where tenant_id=_tenant and id=s.driver_id) or
  (s.is_manual and s.dispatch_trip_id is not null) or (not s.is_manual and not exists(
   select 1 from public.dispatch_trips where tenant_id=_tenant and id=s.dispatch_trip_id and driver_id=s.driver_id)) or
  exists(select 1 from public.driver_settlement_items where settlement_id=_id and tenant_id<>_tenant) or
  exists(select 1 from public.driver_settlement_loads sl left join public.loads l on l.id=sl.load_id where sl.settlement_id=_id and (sl.tenant_id<>_tenant or l.tenant_id is distinct from _tenant)) then
   raise exception 'settlement_adjustment_source_scope' using errcode='23514';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'nature',x.nature,'amount_cents',settlement_adjustment_private.cents(x.amount),
  'description',x.description,'reason',x.metadata->>'reason','created_at',x.created_at) order by x.created_at,x.id),'[]'),
  coalesce(bool_or(x.nature is null or x.nature not in('credit','debit') or settlement_adjustment_private.cents(x.amount) is null or x.amount<=0),false)
 into v_items,v_bad from public.driver_settlement_items x where tenant_id=_tenant and settlement_id=_id and item_type='adjustment';
 v_evidence:=jsonb_build_object('settlement',to_jsonb(s),
  'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.driver_settlement_items x where tenant_id=_tenant and settlement_id=_id),'[]'),
  'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.driver_settlement_payments x where tenant_id=_tenant and settlement_id=_id),'[]'),
  'expenses',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.driver_expenses x where tenant_id=_tenant and (dispatch_trip_id=s.dispatch_trip_id or manual_settlement_id=_id)),'[]'),
  'links',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.driver_settlement_loads x where settlement_id=_id),'[]'),
  'trip',(select to_jsonb(t) from public.dispatch_trips t where tenant_id=_tenant and id=s.dispatch_trip_id),
  'stops',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.dispatch_stops x where dispatch_trip_id=s.dispatch_trip_id),'[]'),
  'routes',coalesce((select jsonb_agg(to_jsonb(x) order by x.id) from public.trip_routes x where trip_id=s.dispatch_trip_id),'[]'),
  'loads',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.loads l where tenant_id=_tenant and (id in(select load_id from public.driver_settlement_loads where settlement_id=_id)
    or id in(select load_id from public.dispatch_trip_loads where dispatch_trip_id=s.dispatch_trip_id) or id=(select load_id from public.dispatch_trips where id=s.dispatch_trip_id))),'[]'),
  'documents',case when s.is_manual then coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public.fiscal_documents d where tenant_id=_tenant and load_id in(select load_id from public.driver_settlement_loads where settlement_id=_id)),'[]')
   else coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public._delivery_trip_financial_documents(_tenant,s.dispatch_trip_id) d),'[]') end);
 v_result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'settlement_id',_id,'status',s.status,'is_manual',s.is_manual,
  'can_add',s.status in('pending_review','in_review','reopened') and not v_bad,
  'can_remove',s.status in('pending_review','in_review','reopened'),'requires_reconciliation',v_bad,'items',v_items,
  'totals',jsonb_build_object('credits_cents',settlement_adjustment_private.cents(s.driver_credits_total),'debits_cents',settlement_adjustment_private.cents(s.driver_debits_total),
    'payable_cents',settlement_adjustment_private.cents(s.driver_payable_amount),'paid_cents',settlement_adjustment_private.cents(s.total_paid_amount),'balance_cents',settlement_adjustment_private.cents(s.payment_balance)),
  'evidence',v_evidence);
 return v_result||jsonb_build_object('revision',md5(v_evidence::text));
end;$fn$;
revoke all on function settlement_adjustment_private.snapshot(uuid,uuid) from public,anon,authenticated,service_role;

create function settlement_adjustment_private.release_guard() returns void language plpgsql security invoker set search_path='' as $fn$
begin
 if not pg_try_advisory_xact_lock_shared(hashtext('settlement-adjustment-release'),1) then raise exception 'settlement_adjustment_release_busy' using errcode='40001';end if;
 if not has_function_privilege('authenticated','public.apply_driver_settlement_adjustment(jsonb)','execute') then
  raise exception 'settlement_adjustment_suspended' using errcode='55000';end if;
end;$fn$;
revoke all on function settlement_adjustment_private.release_guard() from public,anon,authenticated,service_role;

create function settlement_adjustment_private.context(_tenant_id uuid,_settlement_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $fn$
begin
 perform settlement_adjustment_private.authorize(_tenant_id);perform settlement_adjustment_private.release_guard();
 return settlement_adjustment_private.snapshot(_tenant_id,_settlement_id)-'evidence';
end;$fn$;
revoke all on function settlement_adjustment_private.context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function settlement_adjustment_private.context(uuid,uuid) to authenticated;
create function public.get_driver_settlement_adjustment_context(_tenant_id uuid,_settlement_id uuid) returns jsonb
language sql security invoker set search_path='' as $fn$select settlement_adjustment_private.context(_tenant_id,_settlement_id);$fn$;
revoke all on function public.get_driver_settlement_adjustment_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_driver_settlement_adjustment_context(uuid,uuid) to authenticated;
-- Lock only financial sources. Historical trips can retain loads/documents
-- from an earlier delivery attempt; operational replanning guards do not apply.
create function settlement_adjustment_private.lock_sources(_tenant uuid,_id uuid) returns void
language plpgsql security invoker set search_path='' as $fn$
declare s public.driver_settlements%rowtype;v_loads uuid[];v_docs uuid[];
begin
 select * into s from public.driver_settlements where tenant_id=_tenant and id=_id;
 if not found then raise exception 'settlement_adjustment_not_found' using errcode='23514';end if;
 perform 1 from public.dispatch_trips where id=s.dispatch_trip_id for update nowait;
 perform 1 from public.drivers where id=s.driver_id for share nowait;
 perform 1 from public.driver_settlements where id=_id for update nowait;
 if not exists(select 1 from public.driver_settlements x where x.id=_id and x.tenant_id=_tenant
  and x.dispatch_trip_id is not distinct from s.dispatch_trip_id and x.driver_id=s.driver_id and x.is_manual=s.is_manual) then
  raise exception 'settlement_adjustment_context_changed' using errcode='40001';end if;
 perform 1 from public.driver_settlement_loads where settlement_id=_id order by load_id,id for update nowait;
 perform 1 from public.dispatch_trip_loads where dispatch_trip_id=s.dispatch_trip_id order by load_id,id for update nowait;
 select coalesce(array_agg(distinct id),array[]::uuid[]) into v_loads from(
  select load_id id from public.driver_settlement_loads where settlement_id=_id
  union select load_id from public.dispatch_trip_loads where dispatch_trip_id=s.dispatch_trip_id
  union select load_id from public.dispatch_trips where id=s.dispatch_trip_id and load_id is not null) ids;
 perform 1 from public.loads where id=any(v_loads) order by id for update nowait;
 perform 1 from public.dispatch_stops where dispatch_trip_id=s.dispatch_trip_id order by id for update nowait;
 perform d.id from public.dispatch_stop_documents d join public.dispatch_stops t on t.id=d.dispatch_stop_id
  where t.dispatch_trip_id=s.dispatch_trip_id order by d.id for update of d nowait;
 select coalesce(array_agg(distinct id),array[]::uuid[]) into v_docs from(
  select id from public.fiscal_documents where load_id=any(v_loads)
  union select d.fiscal_document_id from public.dispatch_stop_documents d join public.dispatch_stops t on t.id=d.dispatch_stop_id where t.dispatch_trip_id=s.dispatch_trip_id) ids;
 perform 1 from public.fiscal_documents where id=any(v_docs) order by id for update nowait;
 perform 1 from public.delivery_attempts where fiscal_document_id=any(v_docs) order by id for share nowait;
 perform 1 from public.load_items where fiscal_document_id=any(v_docs) order by id for share nowait;
 perform 1 from public.trip_routes where trip_id=s.dispatch_trip_id order by id for share nowait;
 perform 1 from public.driver_expenses where dispatch_trip_id=s.dispatch_trip_id or manual_settlement_id=_id order by id for update nowait;
 perform 1 from public.driver_settlement_items where settlement_id=_id order by id for update nowait;
 perform 1 from public.driver_settlement_payments where settlement_id=_id order by id for update nowait;
 -- Every source used by either builder must belong to the same tenant.
 if exists(select 1 from public.loads where id=any(v_loads) and tenant_id<>_tenant)
  or exists(select 1 from public.fiscal_documents where id=any(v_docs) and tenant_id<>_tenant)
  or exists(select 1 from public.dispatch_trip_loads where dispatch_trip_id=s.dispatch_trip_id and tenant_id<>_tenant)
  or exists(select 1 from public.dispatch_stops where dispatch_trip_id=s.dispatch_trip_id and tenant_id<>_tenant)
  or exists(select 1 from public.dispatch_stop_documents d join public.dispatch_stops t on t.id=d.dispatch_stop_id where t.dispatch_trip_id=s.dispatch_trip_id and d.tenant_id<>_tenant)
  or exists(select 1 from public.driver_settlement_payments where settlement_id=_id and tenant_id<>_tenant)
  or exists(select 1 from public.driver_expenses where (dispatch_trip_id=s.dispatch_trip_id or manual_settlement_id=_id) and (tenant_id<>_tenant or driver_id is distinct from s.driver_id)) then
  raise exception 'settlement_adjustment_source_scope' using errcode='23514';end if;
end;$fn$;
revoke all on function settlement_adjustment_private.lock_sources(uuid,uuid) from public,anon,authenticated,service_role;

create function settlement_adjustment_private.apply(_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='3s' as $fn$
declare v_tenant uuid;v_actor uuid:=auth.uid();v_request uuid;v_settlement uuid;v_item uuid;v_action text;v_amount numeric;
 v_hash text;v_before jsonb;v_after jsonb;v_response jsonb;v_id uuid:=gen_random_uuid();v_built uuid;s public.driver_settlements%rowtype;
 h public.driver_settlement_adjustments%rowtype;v_removed public.driver_settlement_items%rowtype;
begin
 if jsonb_typeof(_payload) is distinct from 'object' or octet_length(_payload::text)>15000
  or _payload->'version' is distinct from '1'::jsonb
  or not (_payload ?& array['tenant_id','actor_id','request_id','settlement_id','action','item_id','nature','amount_cents','description','reason','expected_revision'])
  or (_payload-array['version','tenant_id','actor_id','request_id','settlement_id','action','item_id','nature','amount_cents','description','reason','expected_revision'])<>'{}'::jsonb
  or exists(select 1 from jsonb_each(_payload) p where p.key in('tenant_id','actor_id','request_id','settlement_id','action','reason','expected_revision') and jsonb_typeof(p.value)<>'string') then
  raise exception 'settlement_adjustment_invalid_payload' using errcode='22023';end if;
 v_tenant:=(_payload->>'tenant_id')::uuid;v_request:=(_payload->>'request_id')::uuid;v_settlement:=(_payload->>'settlement_id')::uuid;
 perform settlement_adjustment_private.authorize(v_tenant);
 if v_actor is distinct from (_payload->>'actor_id')::uuid then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;
 v_action:=_payload->>'action';
 if v_action not in('add','remove') or length(btrim(_payload->>'reason')) not between 5 and 2000
  or (_payload->>'expected_revision')!~'^[a-f0-9]{32}$' then raise exception 'settlement_adjustment_invalid_payload' using errcode='22023';end if;
 if v_action='add' then
  if _payload->'item_id' is distinct from 'null'::jsonb or jsonb_typeof(_payload->'nature') is distinct from 'string' or (_payload->>'nature') not in('credit','debit')
   or jsonb_typeof(_payload->'description') is distinct from 'string' or length(btrim(_payload->>'description')) not between 1 and 500
   or jsonb_typeof(_payload->'amount_cents') is distinct from 'number' then raise exception 'settlement_adjustment_invalid_payload' using errcode='22023';end if;
  v_amount:=(_payload->>'amount_cents')::numeric;
  if v_amount<1 or v_amount>99999999999999 or trunc(v_amount)<>v_amount then raise exception 'settlement_adjustment_invalid_amount' using errcode='22023';end if;
 else
  if jsonb_typeof(_payload->'item_id') is distinct from 'string' or _payload->'nature' is distinct from 'null'::jsonb
   or _payload->'amount_cents' is distinct from 'null'::jsonb or _payload->'description' is distinct from 'null'::jsonb then raise exception 'settlement_adjustment_invalid_payload' using errcode='22023';end if;
  v_item:=(_payload->>'item_id')::uuid;
 end if;
 perform settlement_adjustment_private.release_guard();
 v_hash:=encode(sha256(convert_to(_payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('driver-settlement-adjustment'),hashtext(v_tenant::text||':'||v_actor::text||':'||v_request::text));
 perform 1 from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active for share nowait;
 if not found then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;
 perform settlement_adjustment_private.authorize(v_tenant);
 select * into h from public.driver_settlement_adjustments where tenant_id=v_tenant and actor_id=v_actor and request_id=v_request;
 if found then
  if h.payload_hash<>v_hash then raise exception 'settlement_adjustment_key_mismatch' using errcode='22023';end if;
  return h.response;
 end if;
 perform settlement_adjustment_private.lock_sources(v_tenant,v_settlement);
 v_before:=settlement_adjustment_private.snapshot(v_tenant,v_settlement);
 if v_before->>'revision' is distinct from _payload->>'expected_revision' then raise exception 'settlement_adjustment_context_changed' using errcode='40001';end if;
 if (v_before->>'can_remove')::boolean is distinct from true then raise exception 'settlement_adjustment_locked' using errcode='23514';end if;
 if v_action='add' and (v_before->>'requires_reconciliation')::boolean then raise exception 'settlement_adjustment_requires_reconciliation' using errcode='23514';end if;
 select * into strict s from public.driver_settlements where tenant_id=v_tenant and id=v_settlement;
 if v_action='add' then
  v_item:=gen_random_uuid();
  insert into public.driver_settlement_items(id,tenant_id,settlement_id,item_type,nature,amount,description,metadata)
   values(v_item,v_tenant,v_settlement,'adjustment',_payload->>'nature',v_amount/100,btrim(_payload->>'description'),
    jsonb_build_object('reason',btrim(_payload->>'reason'),'command_id',v_id,'created_by',v_actor));
 else
  delete from public.driver_settlement_items where id=v_item and tenant_id=v_tenant and settlement_id=v_settlement and item_type='adjustment' returning * into v_removed;
  if not found then raise exception 'settlement_adjustment_item_not_found' using errcode='23514';end if;
 end if;
 -- Invalid historical values cannot be fed back into the financial builder.
 if exists(select 1 from public.driver_settlement_items x where settlement_id=v_settlement and item_type='adjustment'
  and (nature is null or nature not in('credit','debit') or settlement_adjustment_private.cents(amount) is null or amount<=0)) then
  raise exception 'settlement_adjustment_requires_reconciliation' using errcode='23514';end if;
 if s.is_manual then v_built:=public._build_manual_driver_settlement(v_settlement);
 else v_built:=public._build_driver_settlement(v_tenant,s.dispatch_trip_id);end if;
 if v_built is distinct from v_settlement then raise exception 'settlement_adjustment_source_scope' using errcode='23514';end if;
 v_after:=settlement_adjustment_private.snapshot(v_tenant,v_settlement);
 if exists(select 1 from jsonb_each(v_after->'totals') t where t.value='null'::jsonb) then
  raise exception 'settlement_adjustment_requires_reconciliation' using errcode='23514';end if;
 v_response:=jsonb_build_object('version',1,'tenant_id',v_tenant,'actor_id',v_actor,'request_id',v_request,'settlement_id',v_settlement,
  'command_id',v_id,'item_id',v_item,'action',v_action,'confirmed',true,'revision',v_after->>'revision');
 insert into public.driver_settlement_adjustments(id,tenant_id,actor_id,request_id,settlement_id,item_id,action,reason,payload_hash,before_snapshot,after_snapshot,response)
  values(v_id,v_tenant,v_actor,v_request,v_settlement,v_item,v_action,btrim(_payload->>'reason'),v_hash,v_before,v_after,v_response);
 perform public._log_settlement_event(v_settlement,case when v_action='add' then 'adjustment_added' else 'adjustment_removed' end,
  s.status,v_after->>'status',btrim(_payload->>'reason'),jsonb_build_object('command_id',v_id,'item_id',v_item,'removed_item',to_jsonb(v_removed),'totals',v_after->'totals'));
 return v_response;
end;$fn$;
revoke all on function settlement_adjustment_private.apply(jsonb) from public,anon,authenticated,service_role;
grant execute on function settlement_adjustment_private.apply(jsonb) to authenticated;
create function public.apply_driver_settlement_adjustment(_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $fn$select settlement_adjustment_private.apply(_payload);$fn$;
revoke all on function public.apply_driver_settlement_adjustment(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.apply_driver_settlement_adjustment(jsonb) to authenticated;
revoke all on function public.add_driver_settlement_adjustment(uuid,text,numeric,text,text),public.remove_driver_settlement_adjustment(uuid,uuid,text) from public,anon,authenticated,service_role;
-- Browser clients read statement items; writers go through checked RPCs.
revoke insert,update,delete,truncate,references,trigger on public.driver_settlement_items from public,anon,authenticated;


-- SOURCE: supabase/migrations/20260909234654_finance_legacy_driver_boundary.sql
-- Additional restrictive boundary: preserve each table's existing role rules
-- while denying driver identities, including mixed driver/internal accounts.
create function finance_private.not_driver(_tenant uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select _tenant is not null and auth.uid() is not null
   and not exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role::text='driver')
   and not exists(select 1 from public.drivers d where d.tenant_id=_tenant and d.user_id=auth.uid() and d.active);
$$;
revoke all on function finance_private.not_driver(uuid) from public,anon,authenticated,service_role;
grant usage on schema finance_private to anon;
grant execute on function finance_private.not_driver(uuid) to anon,authenticated;
do $$declare t record;begin
 for t in select c.table_name from information_schema.columns c join information_schema.tables tb using(table_catalog,table_schema,table_name)
   where c.table_schema='public' and c.column_name='tenant_id' and tb.table_type='BASE TABLE' and
   (c.table_name in('bank_accounts','bank_transactions','bank_statement_imports','bank_reconciliation_sessions','bank_reconciliation_audit',
     'financial_matches','financial_obligations','payables','payables_payments','receivables','receivables_payments','load_payments','load_unloading_charges','closing_report_payments')
    or c.table_name ~ '^(driver_expens|driver_settlement|payroll_|expense_creation_|expense_review_|settlement_adjustment_|receivable_financial_)')
 loop
   execute format('alter table public.%I enable row level security',t.table_name);
   execute format('create policy finance_no_driver_boundary on public.%I as restrictive for all to anon,authenticated using(finance_private.not_driver(tenant_id)) with check(finance_private.not_driver(tenant_id))',t.table_name);

 end loop;
end;$$;
do $$declare routine record;begin
 for routine in select p.oid::regprocedure identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='driver_create_expense'
 loop execute format('revoke all on function %s from public,anon,authenticated',routine.identity);end loop;
end;$$;


-- SOURCE: supabase/rollouts/finance_adjustment_legacy_wrapper_compat.sql
-- Exact adapter compatibility before legacy RPC boundary235237.
-- Convert only the one-call public alias to PL/pgSQL; no access expansion.
-- Install235237 and internal-only authorize in the SAME transaction.
do $adapter$
declare p record;
begin
 select f.*,l.lanname into p from pg_proc f join pg_language l on l.oid=f.prolang
 where f.oid=to_regprocedure('public.apply_driver_settlement_adjustment(jsonb)');
 if not found then raise exception 'finance_adjustment_adapter_missing';end if;
 if p.lanname<>'sql' or p.prosecdef or p.provolatile<>'v'
 or md5(replace(p.prosrc,E'\r\n',E'\n'))<>'bc05f8437a55e6aea99d15d827fc9744'
 or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
 or not has_function_privilege('authenticated',p.oid,'execute')
 then raise exception 'finance_adjustment_adapter_contract_changed';end if;
end;$adapter$;
create or replace function public.apply_driver_settlement_adjustment(_payload jsonb) returns jsonb
language plpgsql volatile security invoker set search_path='' as $fn$
begin
 return settlement_adjustment_private.apply(_payload);
end;$fn$;


-- SOURCE: supabase/migrations/20260909235237_finance_legacy_rpc_boundary.sql
create function finance_private.require_access(_tenant uuid) returns void
language plpgsql stable security definer set search_path='' as $$begin
 if not finance_private.can_access(_tenant) then raise exception 'finance_access_denied' using errcode='42501';end if;
end;$$;
revoke all on function finance_private.require_access(uuid) from public,anon,authenticated,service_role;
grant execute on function finance_private.require_access(uuid) to authenticated;

-- Wrap the existing PL/pgSQL body in an outer guarded block. This preserves
-- defaults, return shape, function OID, ACLs, and the current implementation.
-- Only named financial entry points are targeted; operational trigger builders
-- such as _build_driver_settlement are intentionally not modified.
do $guard_financial_entries$
declare spec record;routine record;definition text;guarded text;expression text;required_arg text;
begin
 for spec in select * from (values
   ('create_manual_driver_settlement','tenant'),('generate_driver_settlement','tenant'),('generate_pending_driver_settlements','tenant'),
   ('generate_payroll_period','tenant'),('import_bank_statement','tenant'),('run_bank_reconciliation','tenant'),('sync_financial_obligations','tenant'),
   ('list_available_loads_for_settlement','tenant'),('list_driver_settlement_filter_options','tenant'),('list_driver_settlements','tenant'),
   ('create_manual_financial_match','tenant'),('audit_data_consistency_v2','tenant'),
   ('get_expense_creation_context','tenant'),('get_expense_receipt_status','tenant'),('inspect_expense_receipt_upload','tenant'),('list_driver_expenses','tenant'),('list_driver_expense_sources','tenant'),
   ('recalculate_manual_expense_settlement','tenant'),
   ('create_manual_expense','payload'),('create_driver_expense_command','payload'),('review_driver_expense','payload'),
   ('apply_driver_settlement_adjustment','payload'),('apply_receivable_financial_command','payload'),
   ('add_driver_settlement_adjustment','settlement'),('add_driver_settlement_manual_expense','settlement'),('attach_loads_to_driver_settlement','settlement'),
   ('delete_driver_settlement','settlement'),('detach_load_from_driver_settlement','settlement'),('register_driver_settlement_payment_v2','settlement'),
   ('remove_driver_settlement_adjustment','settlement'),('settle_zero_driver_settlement','settlement'),('update_driver_settlement_km_review','settlement'),('update_driver_settlement_status','settlement'),
   ('approve_payroll_period','period'),('close_payroll_period','period'),('add_payroll_manual_item','entry'),('recalculate_payroll_entry','entry'),('delete_payroll_entry_item','payroll_item'),
   ('register_payable_payment','payable'),('register_receivable_payment','receivable'),('reverse_payable_payment','payable_payment'),('reverse_receivable_payment','receivable_payment'),
   ('accept_financial_match','match'),('reject_financial_match','match'),('reverse_financial_match','match')
 ) s(name,kind) loop
   required_arg:=case spec.kind when 'tenant' then '_tenant_id' when 'payload' then '_payload' when 'settlement' then '_settlement_id'
     when 'period' then '_period_id' when 'entry' then '_entry_id' when 'payroll_item' then '_item_id' when 'payable' then '_payable_id'
     when 'receivable' then '_receivable_id' when 'match' then '_match_id' else '_payment_id' end;
   expression:=case spec.kind when 'tenant' then '_tenant_id' when 'payload' then '(_payload->>''tenant_id'')::uuid'
     else format('(select financial_scope.tenant_id from public.%I financial_scope where financial_scope.id=%I)',
       case spec.kind when 'settlement' then 'driver_settlements' when 'period' then 'payroll_periods' when 'entry' then 'payroll_entries'
       when 'payroll_item' then 'payroll_entry_items' when 'payable' then 'payables' when 'receivable' then 'receivables'
       when 'match' then 'financial_matches' when 'payable_payment' then 'payables_payments' else 'receivables_payments' end,required_arg) end;
   for routine in select p.*,l.lanname from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
     where n.nspname in('public','expense_creation_private','settlement_adjustment_private') and p.proname=spec.name and p.prokind='f'
   loop
     -- Current hardened APIs may be SQL invoker adapters to a private body.
     -- Accept only the known one-call shape and guard that body in this loop.
     if routine.lanname='sql' and routine.prosrc ~ ('^\s*select\s+(expense_creation_private|settlement_adjustment_private)\.'||spec.name||'\([a-zA-Z0-9_,\s]*\);\s*$')
       and exists(select 1 from pg_proc impl join pg_namespace ns on ns.oid=impl.pronamespace join pg_language lang on lang.oid=impl.prolang
         where ns.nspname in('expense_creation_private','settlement_adjustment_private') and impl.proname=spec.name and impl.proargtypes=routine.proargtypes and lang.lanname='plpgsql') then continue;end if;
     if routine.lanname<>'plpgsql' or not coalesce(required_arg=any(routine.proargnames),false) or routine.prosrc~'(?m)^\s*#' then
       raise exception 'Financial entry signature requires review: %',routine.oid::regprocedure;end if;
     if position('<<finance_entry_guard>>' in routine.prosrc)>0 then raise exception 'Financial entry is already guarded: %',routine.oid::regprocedure;end if;
     definition:=pg_get_functiondef(routine.oid);
     guarded:=E'<<finance_entry_guard>>\nBEGIN\n PERFORM finance_private.require_access('||expression||E');\n <<legacy_financial_body>>\n'||routine.prosrc||
       case when right(rtrim(routine.prosrc,E' \t\n\r'),1)=';' then '' else ';' end||E'\nEND;\n';
     execute replace(definition,routine.prosrc,guarded);
   end loop;
 end loop;
end;
$guard_financial_entries$;


-- SOURCE: supabase/migrations/20260910230200_finance_expense_review_read_boundary.sql
-- Close both audited-review read entry points under the canonical finance gate.
-- Preserve bodies, signatures, defaults, OIDs and ACLs; no data changes.
set local lock_timeout='3s';set local statement_timeout='30s';
do $boundary$
declare spec record;routine record;definition text;guarded text;
begin
 if to_regprocedure('finance_private.require_access(uuid)') is null then
  raise exception 'finance_expense_review_boundary_dependency_missing';end if;
 for spec in select * from(values
 ('public.get_driver_expense_review_context(uuid,uuid)','566f7444a124de75659aacabf9726079'),
 ('public.list_driver_expenses_for_review(uuid,text,integer)','59235030ccbb8a5b3a6a5b7e3e9c5b23')
 ) expected(signature,source_hash) loop
  select p.*,l.lanname into routine from pg_proc p join pg_language l on l.oid=p.prolang
   where p.oid=to_regprocedure(spec.signature);
  if not found then raise exception 'finance_expense_review_boundary_source_missing: %',spec.signature;end if;
  if routine.lanname<>'plpgsql' or not routine.prosecdef or routine.provolatile<>'s'
   or routine.prokind<>'f' or not coalesce('_tenant_id'=any(routine.proargnames),false)
   or md5(replace(routine.prosrc,E'\r\n',E'\n'))<>spec.source_hash
   or has_function_privilege('anon',routine.oid,'execute')
   or has_function_privilege('service_role',routine.oid,'execute')
   or not has_function_privilege('authenticated',routine.oid,'execute') then
   raise exception 'finance_expense_review_boundary_contract_changed: %',spec.signature;end if;
  definition:=pg_get_functiondef(routine.oid);
  guarded:=E'<<finance_review_read_guard>>\nBEGIN\n PERFORM finance_private.require_access(_tenant_id);\n <<original_review_read>>\n'
   ||routine.prosrc||E'\nEND;\n';
  execute replace(definition,routine.prosrc,guarded);
 end loop;
end;$boundary$;


-- SOURCE: supabase/migrations/20260909235705_finance_legacy_receipt_boundary.sql
-- Operational delivery proofs share the bucket and retain their own policies.
create function finance_private.financial_receipt_path(_path text) returns boolean
language sql immutable set search_path='' as $$select split_part(_path,'/',2) in('finance-batches','expense-receipts','payable-payments','receivable-payments','payables');$$;
revoke all on function finance_private.financial_receipt_path(text) from public,anon,authenticated,service_role;
grant execute on function finance_private.financial_receipt_path(text) to anon,authenticated;
create policy finance_legacy_receipt_read on storage.objects as restrictive for select to anon,authenticated
 using(bucket_id<>'receipts' or not finance_private.financial_receipt_path(name) or finance_private.can_read_receipt(name));
create policy finance_legacy_receipt_insert on storage.objects as restrictive for insert to anon,authenticated
 with check(bucket_id<>'receipts' or not finance_private.financial_receipt_path(name));
create policy finance_legacy_receipt_update on storage.objects as restrictive for update to anon,authenticated
 using(bucket_id<>'receipts' or not finance_private.financial_receipt_path(name))
 with check(bucket_id<>'receipts' or not finance_private.financial_receipt_path(name));
create policy finance_legacy_receipt_delete on storage.objects as restrictive for delete to anon,authenticated
 using(bucket_id<>'receipts' or not finance_private.financial_receipt_path(name));


-- SOURCE: supabase/rollouts/finance_expense_adjustment_internal_only_policy.sql
-- New restricted finance policy, distinct from the rejected release. No drivers, including mixed identities. Activation gate remains mandatory.
set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$ begin
if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('expense_creation_private.require_session(uuid,uuid)') and replace(p.prosrc,E'\r\n',E'\n')=replace($expected$
declare v_role text;
begin
 if auth.uid() is null or _actor is distinct from auth.uid() then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 select role::text into v_role from public.tenant_memberships where tenant_id=_tenant and user_id=_actor and active;
 if v_role is null or v_role not in('owner','admin','operator','driver') then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 if v_role in('owner','admin') and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then
  raise exception 'expense_creation_mfa_required' using errcode='42501';end if;
end;$expected$,E'\r\n',E'\n') and p.prosecdef=false and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute') and has_function_privilege('authenticated',p.oid,'execute')=false) then raise exception 'password policy predecessor changed: expense_creation_private.require_session(uuid,uuid)';end if;
if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('expense_creation_private.session_allowed(uuid)') and replace(p.prosrc,E'\r\n',E'\n')=replace($expected$
 select auth.uid() is not null and exists(select 1 from public.tenant_memberships m
  where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role::text in('owner','admin','operator','driver')
  and (m.role::text not in('owner','admin') or coalesce(auth.jwt()->>'aal','aal1')='aal2'));
$expected$,E'\r\n',E'\n') and p.prosecdef=true and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute') and has_function_privilege('authenticated',p.oid,'execute')=true) then raise exception 'password policy predecessor changed: expense_creation_private.session_allowed(uuid)';end if;
if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('settlement_adjustment_private.authorize(uuid)') and replace(p.prosrc,E'\r\n',E'\n')=replace($expected$
declare v_role text;
begin
 if auth.uid() is null then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;
 select role::text into v_role from public.tenant_memberships where tenant_id=_tenant and user_id=auth.uid() and active;
 if v_role is null or v_role not in('owner','admin','operator') then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;
 if v_role in('owner','admin') and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'settlement_adjustment_mfa_required' using errcode='42501';end if;
end;$expected$,E'\r\n',E'\n') and p.prosecdef=false and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute') and has_function_privilege('authenticated',p.oid,'execute')=false) then raise exception 'password policy predecessor changed: settlement_adjustment_private.authorize(uuid)';end if;
end;$guard$;

do $boundary$ begin
 if to_regprocedure('finance_private.require_access(uuid)') is null or to_regprocedure('finance_private.not_driver(uuid)') is null then raise exception 'finance_boundary_required';end if;
end;$boundary$;
create or replace function expense_creation_private.require_session(_tenant uuid,_actor uuid) returns void
language plpgsql stable security invoker set search_path='' as $fn$
begin
 if auth.uid() is null or _actor is distinct from auth.uid() then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 perform finance_private.require_access(_tenant);
 if not coalesce(finance_private.not_driver(_tenant),false) or not exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=_actor and m.active and m.role::text in('owner','admin','operator')) then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
end;$fn$;
create or replace function expense_creation_private.session_allowed(_tenant uuid) returns boolean
language sql stable security definer set search_path='' as $fn$
 select auth.uid() is not null and coalesce(finance_private.can_access(_tenant),false) and coalesce(finance_private.not_driver(_tenant),false)
 and exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role::text in('owner','admin','operator'));
$fn$;
create or replace function settlement_adjustment_private.authorize(_tenant uuid) returns void
language plpgsql stable security invoker set search_path='' as $fn$
begin
 perform finance_private.require_access(_tenant);
 if auth.uid() is null or not coalesce(finance_private.not_driver(_tenant),false) or not exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role::text in('owner','admin','operator')) then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;
end;$fn$;
