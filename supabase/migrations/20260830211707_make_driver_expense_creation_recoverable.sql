-- Local candidate. Bookkeeping and read-only Storage metadata inspection only.
set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$ begin
 if to_regprocedure('public.review_driver_expense(jsonb)') is null or to_regclass('public.driver_expense_creations') is not null then
  raise exception 'Expense creation requires audited reviews and an unapplied migration';end if;
end;$guard$;
create unique index expense_settlement_scope_unique on public.driver_settlements(tenant_id,id);
alter table public.driver_expenses add column manual_settlement_id uuid,add column creation_command_id uuid,
 add constraint expense_manual_settlement_scope_fkey foreign key(tenant_id,manual_settlement_id) references public.driver_settlements(tenant_id,id) on delete restrict,
 add constraint expense_single_origin check(manual_settlement_id is null or dispatch_trip_id is null);
create index driver_expenses_manual_settlement_idx on public.driver_expenses(tenant_id,manual_settlement_id) where manual_settlement_id is not null;
create table public.driver_expense_creations(
 id uuid primary key,tenant_id uuid not null,actor_id uuid not null,request_id uuid not null,expense_id uuid not null,driver_id uuid not null,
 source_type text not null check(source_type in('trip','settlement')),source_id uuid not null,payload_hash text not null,
 source_snapshot jsonb not null,expense_snapshot jsonb not null,response jsonb not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),unique(tenant_id,actor_id,request_id),foreign key(tenant_id,expense_id) references public.driver_expenses(tenant_id,id) on delete restrict
);
alter table public.driver_expense_creations enable row level security;
revoke all on public.driver_expense_creations from public,anon,authenticated,service_role;
grant select on public.driver_expense_creations to authenticated;
create policy expense_creation_actor_read on public.driver_expense_creations for select to authenticated
 using(actor_id=(select auth.uid()) and exists(select 1 from public.tenant_memberships m where m.tenant_id=driver_expense_creations.tenant_id and m.user_id=(select auth.uid()) and m.active));
create trigger expense_creations_append_only before update or delete on public.driver_expense_creations for each row execute function public._preserve_driver_expense_command();
alter table public.driver_expenses add constraint expense_creation_command_fkey foreign key(tenant_id,creation_command_id)
 references public.driver_expense_creations(tenant_id,id) deferrable initially deferred;

-- Shared by the authenticated APIs and the service-only upload probe. The
-- explicit actor is supplied by auth.uid() or verified by the upload gateway.
-- Release controls acquire the exclusive counterpart. Re-check the API grant
-- after acquiring the shared lock: a frame admitted just before a revoke must
-- not continue after containment commits. Existing evidence/readers are kept.
create function public._guard_expense_creation_release() returns void
 language plpgsql security invoker set search_path='' as $fn$
begin
 if not pg_try_advisory_xact_lock_shared(hashtext('driver-expense-release'),1) then
  raise exception 'expense_creation_release_busy' using errcode='40001';end if;
 if not has_function_privilege('authenticated','public.create_driver_expense_command(jsonb)','execute') then
  raise exception 'expense_creation_suspended' using errcode='55000';end if;
end;$fn$;
revoke all on function public._guard_expense_creation_release() from public,anon,authenticated,service_role;

create function public._expense_creation_source(_tenant uuid,_actor uuid,_type text,_source uuid) returns jsonb
 language plpgsql stable security invoker set search_path='' as $fn$
declare t public.dispatch_trips%rowtype;s public.driver_settlements%rowtype;d public.drivers%rowtype;v_role text;v_can boolean;v_result jsonb;
begin
 select role::text into v_role from public.tenant_memberships where tenant_id=_tenant and user_id=_actor and active;
 if _actor is null or v_role is null then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 if _type='trip' then
  select * into t from public.dispatch_trips where tenant_id=_tenant and id=_source;
  select * into d from public.drivers where tenant_id=_tenant and id=t.driver_id and user_id=_actor and active;
  if t.id is null or d.id is null then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
  v_can:=t.status in('planned','in_transit','completed');
 elsif _type='settlement' then
  if v_role not in('owner','admin','operator') then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
  select * into s from public.driver_settlements where tenant_id=_tenant and id=_source;
  select * into d from public.drivers where tenant_id=_tenant and id=s.driver_id;
  if s.id is null or d.id is null then raise exception 'expense_creation_source_not_found' using errcode='23514';end if;
  if s.dispatch_trip_id is not null then select * into t from public.dispatch_trips where tenant_id=_tenant and id=s.dispatch_trip_id;end if;
  v_can:=s.status in('pending_review','in_review','reopened') and
   ((s.is_manual and s.dispatch_trip_id is null) or (not s.is_manual and t.id is not null and t.driver_id=s.driver_id));
 else raise exception 'expense_creation_invalid_source' using errcode='22023';end if;
 v_result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',_actor,'source_type',_type,'source_id',_source,'driver_id',d.id,
  'driver_name',d.name,'trip_id',t.id,'settlement_id',s.id,'manual_settlement_id',case when s.is_manual then s.id else null end,
  'can_create',coalesce(v_can,false),'source_state',coalesce(s.status,t.status),
  'evidence',jsonb_build_object('trip',case when t.id is null then null else to_jsonb(t) end,'settlement',case when s.id is null then null else to_jsonb(s) end,
    'driver',jsonb_build_object('id',d.id,'tenant_id',d.tenant_id,'user_id',d.user_id,'active',d.active),'role',v_role));
 return v_result||jsonb_build_object('revision',md5(v_result::text));
end;$fn$;
revoke all on function public._expense_creation_source(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
create function public.get_expense_creation_context(_tenant_id uuid,_source_type text,_source_id uuid) returns jsonb
 language plpgsql security definer set search_path='' as $fn$
begin
 perform public._guard_expense_creation_release();
 return public._expense_creation_source(_tenant_id,auth.uid(),_source_type,_source_id)-'evidence';
end;
$fn$;
revoke all on function public.get_expense_creation_context(uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_expense_creation_context(uuid,text,uuid) to authenticated;

create function public._expense_receipt_descriptor(_tenant uuid,_actor uuid,_request uuid,_receipt jsonb) returns jsonb
 language plpgsql immutable security invoker set search_path='' as $fn$
declare v_mime text;v_extension text;v_size bigint;
begin
 if _tenant is null or _actor is null or _request is null or _receipt is null or jsonb_typeof(_receipt)<>'object'
  or (_receipt-array['sha256','mime','size'])<>'{}'::jsonb or coalesce(_receipt->>'sha256','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(_receipt->'size') is distinct from 'number' or coalesce(_receipt->>'size','')!~'^[0-9]+$' then
  raise exception 'expense_receipt_invalid_descriptor' using errcode='22023';end if;
 v_mime:=_receipt->>'mime';v_size:=(_receipt->>'size')::bigint;
 v_extension:=case v_mime when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
  when 'image/heic' then 'heic' when 'image/heif' then 'heif' when 'application/pdf' then 'pdf' end;
 if v_extension is null or v_size not between 1 and 10485760 then raise exception 'expense_receipt_invalid_descriptor' using errcode='22023';end if;
 return _receipt||jsonb_build_object('path',_tenant::text||'/expense-receipts/'||_actor::text||'/'||_request::text||'/receipt.'||v_extension);
end;$fn$;
revoke all on function public._expense_receipt_descriptor(uuid,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public._expense_receipt_status(_tenant uuid,_actor uuid,_request uuid,_type text,_source uuid,_receipt jsonb) returns jsonb
 language plpgsql stable security invoker set search_path='' as $fn$
declare v_descriptor jsonb;v_object jsonb;v_expected jsonb;
begin
 v_descriptor:=public._expense_receipt_descriptor(_tenant,_actor,_request,_receipt);
 select to_jsonb(o) into v_object from storage.objects o where o.bucket_id='receipts' and o.name=v_descriptor->>'path';
 v_expected:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',_actor,'request_id',_request,'source_type',_type,'source_id',_source,
  'sha256',_receipt->>'sha256','size',(_receipt->>'size')::bigint,'mime',_receipt->>'mime','scanned',true);
 if v_object is not null and not coalesce((v_object->'user_metadata') @> v_expected,false) then
  raise exception 'expense_receipt_existing_object_mismatch' using errcode='23514';end if;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',_actor,'request_id',_request,'source_type',_type,'source_id',_source,
  'path',v_descriptor->>'path','uploaded',v_object is not null,'receipt',_receipt,'metadata',v_expected);
end;$fn$;
revoke all on function public._expense_receipt_status(uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.get_expense_receipt_status(_tenant_id uuid,_request_id uuid,_source_type text,_source_id uuid,_receipt jsonb) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
begin
 perform public._expense_creation_source(_tenant_id,auth.uid(),_source_type,_source_id);
 return public._expense_receipt_status(_tenant_id,auth.uid(),_request_id,_source_type,_source_id,_receipt)-'metadata';
end;$fn$;
revoke all on function public.get_expense_receipt_status(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_expense_receipt_status(uuid,uuid,text,uuid,jsonb) to authenticated;
create function public.inspect_expense_receipt_upload(_tenant_id uuid,_actor_id uuid,_request_id uuid,_source_type text,_source_id uuid,_receipt jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $fn$
declare v_source jsonb;begin
 perform public._guard_expense_creation_release();
 v_source:=public._expense_creation_source(_tenant_id,_actor_id,_source_type,_source_id);
 if not (v_source->>'can_create')::boolean then raise exception 'expense_creation_source_locked' using errcode='23514';end if;
 return public._expense_receipt_status(_tenant_id,_actor_id,_request_id,_source_type,_source_id,_receipt);
end;$fn$;
revoke all on function public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.inspect_expense_receipt_upload(uuid,uuid,uuid,text,uuid,jsonb) to service_role;

-- New receipts are immutable through browser Storage APIs. Deletion/copy
-- cleanup through the privileged gateway must also reject this reserved root.
create policy expense_receipt_no_browser_delete on storage.objects as restrictive for delete to authenticated
 using(bucket_id<>'receipts' or split_part(storage.objects.name,'/',2)<>'expense-receipts');
create policy expense_receipt_no_browser_update on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'receipts' or split_part(storage.objects.name,'/',2)<>'expense-receipts')
 with check(bucket_id<>'receipts' or split_part(storage.objects.name,'/',2)<>'expense-receipts');
create policy expense_receipt_no_browser_insert on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'receipts' or split_part(storage.objects.name,'/',2)<>'expense-receipts');

create function public.create_driver_expense_command(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
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
 if v_request is null or v_source_id is null or v_type is null or v_type not in('trip','settlement') then raise exception 'expense_creation_invalid_source' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext('driver-expense-creation'),hashtext(v_tenant::text||':'||v_actor::text||':'||v_request::text));
 select role::text into v_role from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active for share nowait;
 if v_role is null then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
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
revoke all on function public.create_driver_expense_command(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_driver_expense_command(jsonb) to authenticated;

create function public._guard_expense_creation_contract() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if tg_op='INSERT' then
  if new.creation_command_id is null then raise exception 'expense_creation_command_required' using errcode='42501';end if;
 elsif (new.creation_command_id is distinct from old.creation_command_id) or (old.creation_command_id is not null and
  (to_jsonb(new)-array['approval_status','approved_by','approved_at','review_command_id','updated_at']) is distinct from
  (to_jsonb(old)-array['approval_status','approved_by','approved_at','review_command_id','updated_at'])) then
  raise exception 'expense_creation_history_is_immutable' using errcode='55000';
 end if;
 return new;
end;$fn$;
revoke all on function public._guard_expense_creation_contract() from public,anon,authenticated,service_role;
create trigger guard_expense_creation_contract before insert or update on public.driver_expenses for each row execute function public._guard_expense_creation_contract();
create function public._check_expense_creation_ack() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if new.creation_command_id is not null and not exists(select 1 from public.driver_expense_creations h where h.tenant_id=new.tenant_id and h.id=new.creation_command_id
  and h.expense_id=new.id and h.expense_snapshot=to_jsonb(new)) then raise exception 'expense_creation_ack_required' using errcode='23514';end if;
 return null;
end;$fn$;
revoke all on function public._check_expense_creation_ack() from public,anon,authenticated,service_role;
create constraint trigger check_expense_creation_ack after insert on public.driver_expenses deferrable initially deferred for each row execute function public._check_expense_creation_ack();

-- The manual form and the driver must switch in the same release. No unsafe
-- legacy fallback is restored when the new endpoint rejects a command.
revoke all on function public.driver_create_expense(uuid,text,numeric,text,text,timestamptz,text,text,text,text,numeric,boolean,text,boolean,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.add_driver_settlement_manual_expense(uuid,text,numeric,timestamptz,text,text,boolean,text,text) from public,anon,authenticated,service_role;

create function public.list_driver_expenses(_tenant_id uuid,_offset integer default 0) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare v_total bigint;v_rows jsonb;
begin
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
revoke all on function public.list_driver_expenses(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_driver_expenses(uuid,integer) to authenticated;
create function public.list_driver_expense_sources(_tenant_id uuid,_offset integer default 0) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare v_total bigint;v_rows jsonb;
begin
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
revoke all on function public.list_driver_expense_sources(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.list_driver_expense_sources(uuid,integer) to authenticated;

-- Reading through a newly assigned trip must not reveal its former driver's
-- personal expenses. Operations retain their existing tenant-scoped access.
create policy expense_read_current_actor on public.driver_expenses as restrictive for select to authenticated
 using(public.is_tenant_operator_or_admin(tenant_id) or (
  exists(select 1 from public.drivers d where d.tenant_id=driver_expenses.tenant_id and d.id=driver_expenses.driver_id and d.user_id=(select auth.uid()) and d.active)
  and exists(select 1 from public.tenant_memberships m where m.tenant_id=driver_expenses.tenant_id and m.user_id=(select auth.uid()) and m.active)));
create policy expense_receipt_read_current_actor on storage.objects as restrictive for select to authenticated using(
 bucket_id<>'receipts' or split_part(storage.objects.name,'/',2)<>'expense-receipts' or
 case when split_part(storage.objects.name,'/',1)~'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
  public.is_tenant_operator_or_admin(split_part(storage.objects.name,'/',1)::uuid) or
  (exists(select 1 from public.tenant_memberships m where m.tenant_id=split_part(storage.objects.name,'/',1)::uuid and m.user_id=(select auth.uid()) and m.active) and (
   split_part(storage.objects.name,'/',3)=(select auth.uid())::text or
   exists(select 1 from public.driver_expenses e join public.drivers d on d.tenant_id=e.tenant_id and d.id=e.driver_id
    where e.tenant_id=split_part(storage.objects.name,'/',1)::uuid and e.receipt_url=storage.objects.name and d.user_id=(select auth.uid()) and d.active)))
 else false end);

-- Extend audited reviews and recalculation to manual expense sources.
create or replace function public._expense_review_snapshot(_tenant uuid,_expense uuid) returns jsonb
 language plpgsql stable security invoker set search_path='' as $fn$
declare e public.driver_expenses%rowtype;v_errors jsonb:='[]';v_obligations jsonb;v_settlements jsonb;v_history jsonb;v_result jsonb;v_amount bigint;
begin
 select * into e from public.driver_expenses where tenant_id=_tenant and id=_expense;
 if not found then raise exception 'expense_not_found' using errcode='23514';end if;
 if e.amount is null or e.amount<=0 or e.amount>999999999999.99 or e.amount<>round(e.amount,2) then v_errors:=v_errors||'"amount"'::jsonb;
 else v_amount:=(e.amount*100)::bigint;end if;
 if nullif(btrim(e.category),'') is null then v_errors:=v_errors||'"category"'::jsonb;end if;
 if not isfinite(e.expense_at) then v_errors:=v_errors||'"date"'::jsonb;end if;
 if not exists(select 1 from public.drivers d where d.tenant_id=_tenant and d.id=e.driver_id)
  or not (exists(select 1 from public.dispatch_trips t where t.tenant_id=_tenant and t.id=e.dispatch_trip_id)
   or (e.dispatch_trip_id is null and exists(select 1 from public.driver_settlements s where s.tenant_id=_tenant and s.id=e.manual_settlement_id and s.is_manual and s.dispatch_trip_id is null and s.driver_id=e.driver_id))) then v_errors:=v_errors||'"scope"'::jsonb;end if;
 if e.payment_source is null or e.payment_source not in('driver','advance','company_card','company_account','other') or e.reimbursable is null
  or e.paid_with_advance is distinct from (e.payment_source='advance')
  or (e.payment_source in('company_card','company_account') and e.reimbursable) then v_errors:=v_errors||'"payment_source"'::jsonb;end if;
 if e.no_receipt is null or (e.no_receipt and (length(btrim(coalesce(e.no_receipt_reason,'')))<5 or nullif(e.receipt_url,'') is not null))
  or (not e.no_receipt and (e.receipt_url is null or e.receipt_url not like _tenant::text||'/%' or e.receipt_url like '%..%' or e.receipt_url like '%\%'
    or not exists(select 1 from storage.objects o where o.bucket_id='receipts' and o.name=e.receipt_url))) then v_errors:=v_errors||'"receipt"'::jsonb;end if;
 select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]') into v_obligations from public.financial_obligations o where o.tenant_id=_tenant and o.source_table='driver_expenses' and o.source_id=e.id;
 if exists(select 1 from public.financial_obligations o where o.tenant_id=_tenant and o.source_table='driver_expenses' and o.source_id=e.id) and e.approval_status='pending' then v_errors:=v_errors||'"existing_obligation"'::jsonb;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'status',s.status,'needs_recalculation',s.needs_recalculation,'updated_at',s.updated_at) order by s.id),'[]') into v_settlements
  from public.driver_settlements s where s.tenant_id=_tenant and (s.dispatch_trip_id=e.dispatch_trip_id or s.id=e.manual_settlement_id);
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'action',h.action,'reason',h.reason,'created_at',h.created_at) order by h.created_at desc,h.id),'[]') into v_history
  from public.driver_expense_reviews h where h.tenant_id=_tenant and h.expense_id=e.id;
 v_result:=jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'expense_id',e.id,'status',e.approval_status,'amount_cents',v_amount,
  'can_approve',public.is_tenant_admin(_tenant) and e.approval_status='pending' and v_errors='[]'::jsonb,
  'can_reject',public.is_tenant_admin(_tenant) and e.approval_status='pending' and not exists(select 1 from public.financial_obligations o where o.tenant_id=_tenant and o.source_table='driver_expenses' and o.source_id=e.id),
  'validation_errors',v_errors,'expense',to_jsonb(e),'settlements',v_settlements,'evidence',jsonb_build_object('expense',to_jsonb(e),'obligations',v_obligations,'settlements',v_settlements));
 return v_result||jsonb_build_object('revision',md5(v_result::text),'history',v_history);
end;$fn$;

create or replace function public.review_driver_expense(_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_tenant uuid;v_actor uuid:=auth.uid();v_expense uuid;v_request uuid;v_action text;v_reason text;v_hash text;v_id uuid:=gen_random_uuid();
 v_trip uuid;v_manual uuid;e public.driver_expenses%rowtype;h public.driver_expense_reviews%rowtype;v_before jsonb;v_after jsonb;v_response jsonb;
begin
 if _payload is null or jsonb_typeof(_payload)<>'object' or length(_payload::text)>10000
  or _payload->'version' is distinct from '1'::jsonb or jsonb_typeof(_payload->'reason') is distinct from 'string'
  or (_payload-array['version','tenant_id','actor_id','request_id','expense_id','action','reason','expected_revision'])<>'{}'::jsonb then raise exception 'expense_invalid_payload' using errcode='22023';end if;
 v_tenant:=(_payload->>'tenant_id')::uuid;v_expense:=(_payload->>'expense_id')::uuid;v_request:=(_payload->>'request_id')::uuid;
 v_action:=_payload->>'action';v_reason:=btrim(_payload->>'reason');
 if v_actor is null or (_payload->>'actor_id')::uuid is distinct from v_actor or not coalesce(public.is_tenant_admin(v_tenant),false) then raise exception 'expense_not_authorized' using errcode='42501';end if;
 if v_request is null or v_expense is null or v_action is null or v_action not in('approve','reject') or v_reason is null or length(v_reason) not between 5 and 2000
  or coalesce(_payload->>'expected_revision','')!~'^[a-f0-9]{32}$' then raise exception 'expense_invalid_payload' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtext('driver-expense-review'),hashtext(v_tenant::text||':'||v_actor::text||':'||v_request::text));
 -- Membership can be revoked while a duplicate request waits.
 perform 1 from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active and role::text in('owner','admin') for share;
 if not found or not coalesce(public.is_tenant_admin(v_tenant),false) then raise exception 'expense_not_authorized' using errcode='42501';end if;
 v_hash:=encode(sha256(convert_to(_payload::text,'UTF8')),'hex');
 select * into h from public.driver_expense_reviews where tenant_id=v_tenant and actor_id=v_actor and request_id=v_request;
 if found then if h.payload_hash<>v_hash then raise exception 'expense_request_key_mismatch' using errcode='22023';end if;return h.response;end if;
 select dispatch_trip_id,manual_settlement_id into v_trip,v_manual from public.driver_expenses where tenant_id=v_tenant and id=v_expense;
 if not found then raise exception 'expense_not_found' using errcode='23514';end if;
 perform 1 from public.dispatch_trips where tenant_id=v_tenant and id=v_trip for update nowait;
 perform 1 from public.driver_settlements where tenant_id=v_tenant and (dispatch_trip_id=v_trip or id=v_manual) order by id for update nowait;
 select * into e from public.driver_expenses where tenant_id=v_tenant and id=v_expense for update nowait;
 if not found or (e.dispatch_trip_id,e.manual_settlement_id) is distinct from (v_trip,v_manual) then raise exception 'expense_context_changed' using errcode='40001';end if;
 perform 1 from public.financial_obligations where tenant_id=v_tenant and source_table='driver_expenses' and source_id=v_expense order by id for update nowait;
 perform 1 from storage.objects where bucket_id='receipts' and name=e.receipt_url for share nowait;
 v_before:=public._expense_review_snapshot(v_tenant,v_expense);
 if v_before->>'revision'<>_payload->>'expected_revision' then raise exception 'expense_context_changed' using errcode='40001';end if;
 if not coalesce((v_before->>case when v_action='approve' then 'can_approve' else 'can_reject' end)::boolean,false) then raise exception 'expense_requires_reconciliation_or_review' using errcode='23514';end if;
 update public.driver_expenses set approval_status=case when v_action='approve' then 'approved' else 'rejected' end,
  approved_by=v_actor,approved_at=clock_timestamp(),updated_at=clock_timestamp(),review_command_id=v_id where tenant_id=v_tenant and id=v_expense;
 v_after:=public._expense_review_snapshot(v_tenant,v_expense);
 v_response:=jsonb_build_object('version',1,'tenant_id',v_tenant,'actor_id',v_actor,'request_id',v_request,'expense_id',v_expense,'command_id',v_id,'action',v_action,
  'status',v_after->>'status','confirmed',true,'revision',v_after->>'revision');
 insert into public.driver_expense_reviews(id,tenant_id,actor_id,request_id,expense_id,action,reason,payload_hash,before_snapshot,after_snapshot,response)
  values(v_id,v_tenant,v_actor,v_request,v_expense,v_action,v_reason,v_hash,v_before->'evidence',v_after->'evidence',v_response);
 return v_response;
exception when lock_not_available or deadlock_detected then raise exception 'expense_concurrent_change' using errcode='40001';
end;$fn$;

create or replace function public._tg_mark_outdated_expense() returns trigger language plpgsql security definer set search_path='' as $fn$
declare s record;v_old uuid;v_new uuid;v_old_tenant uuid;v_new_tenant uuid;v_old_manual uuid;v_new_manual uuid;
begin
 if tg_op<>'INSERT' then v_old:=old.dispatch_trip_id;v_old_manual:=old.manual_settlement_id;v_old_tenant:=old.tenant_id;end if;
 if tg_op<>'DELETE' then v_new:=new.dispatch_trip_id;v_new_manual:=new.manual_settlement_id;v_new_tenant:=new.tenant_id;end if;
 for s in select ds.id,ds.status from public.driver_settlements ds where (ds.tenant_id=v_old_tenant and (ds.dispatch_trip_id=v_old or ds.id=v_old_manual)) or (ds.tenant_id=v_new_tenant and (ds.dispatch_trip_id=v_new or ds.id=v_new_manual)) order by ds.id for update nowait loop
  update public.driver_settlements set needs_recalculation=true,recalculation_reason='driver_expense_change',source_updated_at=clock_timestamp() where id=s.id;
  perform public._log_settlement_event(s.id,'marked_outdated',s.status,s.status,'driver_expense_change',jsonb_build_object('expense_id',coalesce(new.id,old.id)));
 end loop;
 return coalesce(new,old);
end;$fn$;

CREATE OR REPLACE FUNCTION public._build_manual_driver_settlement(_settlement_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
DECLARE
  v_s record;
  v_tenant uuid;
  v_loads_count int := 0;
  v_documents_count int := 0;
  v_total_goods numeric := 0;
  v_total_freight_rev numeric := 0;
  v_total_weight numeric := 0;
  v_appr numeric := 0;
  v_appr_reimb numeric := 0;
  v_pending numeric := 0;
  v_rejected numeric := 0;
  v_expenses_total numeric := 0;
  v_document_ids uuid[];
  v_adj_credits numeric := 0;
  v_adj_debits numeric := 0;
  v_route_origin text;
  v_route_destination text;
  v_total_paid numeric := 0;
  v_payable numeric := 0;
  v_route_result numeric := 0;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF NOT v_s.is_manual THEN RAISE EXCEPTION 'not_manual_settlement'; END IF;
  IF v_s.status NOT IN ('pending_review','in_review','reopened') THEN
    RAISE EXCEPTION 'settlement_locked';
  END IF;
  v_tenant := v_s.tenant_id;

  -- Older manual items are not silently reassigned or discarded. Their
  -- origin must be reconciled explicitly before replacing the statement.
  IF EXISTS(SELECT 1 FROM public.driver_settlement_items item WHERE item.settlement_id=_settlement_id AND item.item_type='expense'
    AND (item.tenant_id<>v_tenant OR item.source_table IS DISTINCT FROM 'driver_expenses' OR NOT EXISTS(
      SELECT 1 FROM public.driver_expenses e WHERE e.tenant_id=v_tenant AND e.id=item.source_id AND e.manual_settlement_id=_settlement_id))) THEN
    RAISE EXCEPTION 'manual_expense_link_reconciliation_required' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.drivers WHERE tenant_id=v_tenant AND id=v_s.driver_id) OR EXISTS(
    SELECT 1 FROM public.driver_settlement_loads dsl LEFT JOIN public.loads l ON l.tenant_id=v_tenant AND l.id=dsl.load_id
    WHERE dsl.settlement_id=_settlement_id AND (dsl.tenant_id<>v_tenant OR l.id IS NULL)) THEN
    RAISE EXCEPTION 'manual_settlement_source_scope' USING ERRCODE='23514'; END IF;
  SELECT coalesce(array_agg(DISTINCT fd.id),ARRAY[]::uuid[]) INTO v_document_ids FROM public.fiscal_documents fd
    JOIN public.driver_settlement_loads dsl ON dsl.load_id=fd.load_id AND dsl.tenant_id=v_tenant
    WHERE dsl.settlement_id=_settlement_id AND fd.tenant_id=v_tenant;
  SELECT coalesce(sum(amount) FILTER(WHERE approval_status='approved'),0),
    coalesce(sum(amount) FILTER(WHERE approval_status='pending'),0),coalesce(sum(amount) FILTER(WHERE approval_status='rejected'),0),
    coalesce(sum(amount),0),coalesce(sum(amount) FILTER(WHERE approval_status='approved' AND reimbursable),0)
    INTO v_appr,v_pending,v_rejected,v_expenses_total,v_appr_reimb FROM public.driver_expenses
    WHERE tenant_id=v_tenant AND manual_settlement_id=_settlement_id;
  SELECT
    (SELECT count(*) FROM public.driver_settlement_loads WHERE settlement_id = _settlement_id),
    cardinality(v_document_ids),
    COALESCE((SELECT sum(fd.value) FROM public.fiscal_documents fd JOIN unnest(v_document_ids) d(id) ON d.id=fd.id
              WHERE COALESCE(fd.document_type,'nfe') NOT IN ('cte','ct-e','CTe')),0),
    COALESCE((SELECT sum(COALESCE(NULLIF(fd.freight_value,0),
                        CASE WHEN COALESCE(fd.document_type,'nfe') IN ('cte','ct-e','CTe') THEN fd.value ELSE 0 END))
              FROM public.fiscal_documents fd JOIN unnest(v_document_ids) d(id) ON d.id=fd.id),0),
    COALESCE(NULLIF((SELECT sum(fd.weight_kg) FROM public.fiscal_documents fd JOIN unnest(v_document_ids) d(id) ON d.id=fd.id),0),
             COALESCE((SELECT sum(l.total_weight_kg) FROM public.loads l
                       JOIN public.driver_settlement_loads dsl ON dsl.load_id = l.id
                       WHERE dsl.settlement_id = _settlement_id),0))
  INTO v_loads_count, v_documents_count, v_total_goods, v_total_freight_rev, v_total_weight;

  SELECT l.origin INTO v_route_origin
  FROM public.loads l
  JOIN public.driver_settlement_loads dsl ON dsl.load_id = l.id
  WHERE dsl.settlement_id = _settlement_id AND l.origin IS NOT NULL
  ORDER BY l.created_at ASC NULLS LAST LIMIT 1;

  SELECT l.destination INTO v_route_destination
  FROM public.loads l
  JOIN public.driver_settlement_loads dsl ON dsl.load_id = l.id
  WHERE dsl.settlement_id = _settlement_id AND l.destination IS NOT NULL
  ORDER BY l.created_at DESC NULLS LAST LIMIT 1;

  v_route_result := COALESCE(v_total_freight_rev,0) - COALESCE(v_appr,0);

  SELECT
    COALESCE(sum(amount) FILTER (WHERE nature='credit'),0),
    COALESCE(sum(amount) FILTER (WHERE nature='debit'),0)
  INTO v_adj_credits, v_adj_debits
  FROM public.driver_settlement_items
  WHERE settlement_id = _settlement_id AND item_type='adjustment';

  SELECT COALESCE(sum(amount),0) INTO v_total_paid
  FROM public.driver_settlement_payments WHERE settlement_id = _settlement_id;

  v_payable := v_adj_credits + v_appr_reimb - v_adj_debits;

  v_snapshot := jsonb_build_object(
    'calculation_version','manual_driver_settlement_expenses_v2',
    'generated_at', now(),
    'driver_id', v_s.driver_id, 'vehicle_id', v_s.vehicle_id,
    'route', jsonb_build_object('origin', v_route_origin, 'destination', v_route_destination),
    'loads', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM public.loads l
                       JOIN public.driver_settlement_loads dsl ON dsl.load_id = l.id
                       WHERE dsl.settlement_id = _settlement_id), '[]'::jsonb),
    'documents', COALESCE((SELECT jsonb_agg(to_jsonb(fd)) FROM public.fiscal_documents fd WHERE fd.id=ANY(v_document_ids)), '[]'::jsonb),
    'expenses',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.driver_expenses e where e.tenant_id=v_tenant and e.manual_settlement_id=_settlement_id),'[]'::jsonb),
    'totals', jsonb_build_object(
      'approved_expenses_total',v_appr,'pending_expenses_total',v_pending,'rejected_expenses_total',v_rejected,
      'expenses_total',v_expenses_total,'driver_reimbursement_total',v_appr_reimb,
      'total_goods_value', v_total_goods,
      'total_freight_revenue', v_total_freight_rev,
      'route_result', v_route_result,
      'driver_credits_total', v_adj_credits,
      'driver_debits_total', v_adj_debits,
      'driver_payable_amount', v_payable,
      'total_paid_amount', v_total_paid,
      'payment_balance', v_payable - v_total_paid
    )
  );

  UPDATE public.driver_settlements SET
    route_origin = v_route_origin,
    route_destination = v_route_destination,
    loads_count = v_loads_count,
    documents_count = v_documents_count,
    total_invoice_value = v_total_goods,
    total_freight_value = v_total_freight_rev,
    total_weight_kg = v_total_weight,
    total_goods_value = v_total_goods,
    total_freight_revenue = v_total_freight_rev,
    route_result = v_route_result,
    approved_expenses_total = v_appr,
    pending_expenses_total = v_pending,
    rejected_expenses_total = v_rejected,
    expenses_total = v_expenses_total,
    driver_reimbursement_total = v_appr_reimb,
    driver_credits_total = v_adj_credits,
    driver_debits_total = v_adj_debits,
    driver_payable_amount = v_payable,
    manual_adjustments_total = v_adj_credits - v_adj_debits,
    total_paid_amount = v_total_paid,
    payment_balance = v_payable - v_total_paid,
    invoice_balance = v_total_goods,
    operational_balance = v_route_result,
    final_amount = v_payable,
    last_recalculated_at = now(),
    needs_recalculation = false,
    recalculation_reason = NULL,
    snapshot_json = v_snapshot
  WHERE id = _settlement_id;

  DELETE FROM public.driver_settlement_items
   WHERE settlement_id = _settlement_id AND item_type <> 'adjustment';

  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
  SELECT v_tenant, _settlement_id, 'load', 'loads', l.id,
         COALESCE(l.load_number, l.origin || ' → ' || l.destination), 0, l.total_weight_kg,
         jsonb_build_object('origin', l.origin, 'destination', l.destination, 'status', l.status, 'pallets', l.total_pallet_count)
  FROM public.loads l
  JOIN public.driver_settlement_loads dsl ON dsl.load_id = l.id
  WHERE dsl.settlement_id = _settlement_id;

  INSERT INTO public.driver_settlement_items(tenant_id, settlement_id, item_type, source_table, source_id, description, amount, quantity, metadata)
  SELECT v_tenant, _settlement_id, 'fiscal_document', 'fiscal_documents', fd.id,
         COALESCE(fd.invoice_number, fd.access_key), fd.value, fd.weight_kg,
         jsonb_build_object('document_type', fd.document_type, 'freight_value', fd.freight_value, 'recipient', fd.recipient, 'recipient_city', fd.recipient_city, 'recipient_state', fd.recipient_state, 'status', fd.status)
  FROM public.fiscal_documents fd
  WHERE fd.id=ANY(v_document_ids);

  INSERT INTO public.driver_settlement_items(tenant_id,settlement_id,item_type,source_table,source_id,description,amount,quantity,metadata)
  SELECT v_tenant,_settlement_id,'expense','driver_expenses',e.id,coalesce(nullif(e.notes,''),e.category),e.amount,1,
    jsonb_build_object('category',e.category,'approval_status',e.approval_status,'expense_at',e.expense_at,'receipt_url',e.receipt_url,
      'reimbursable',e.reimbursable,'payment_source',e.payment_source,'cost_center',e.cost_center)
  FROM public.driver_expenses e WHERE e.tenant_id=v_tenant AND e.manual_settlement_id=_settlement_id;

  PERFORM public._log_settlement_event(_settlement_id, 'recalculated_manual', NULL, NULL, NULL,
    jsonb_build_object('loads', v_loads_count, 'documents', v_documents_count, 'freight', v_total_freight_rev, 'goods', v_total_goods));

  RETURN _settlement_id;
EXCEPTION WHEN lock_not_available OR deadlock_detected THEN RAISE EXCEPTION 'expense_creation_concurrent_change' USING ERRCODE='40001';
END;
$function$;
revoke all on function public._build_manual_driver_settlement(uuid) from public,anon,authenticated,service_role;

-- Explicit operation entry point; private builders are never browser APIs.
create function public.recalculate_manual_expense_settlement(_tenant_id uuid,_settlement_id uuid) returns uuid
 language plpgsql security definer set search_path='' as $fn$
begin
 perform public._guard_expense_creation_release();
 if auth.uid() is null then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 perform 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active and role::text in('owner','admin','operator') for share nowait;
 if not found then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 perform 1 from public.driver_settlements where tenant_id=_tenant_id and id=_settlement_id and is_manual and dispatch_trip_id is null for update nowait;
 if not found then raise exception 'expense_creation_source_not_found' using errcode='23514';end if;
 return public._build_manual_driver_settlement(_settlement_id);
exception when lock_not_available or deadlock_detected then raise exception 'expense_creation_concurrent_change' using errcode='40001';
end;$fn$;
revoke all on function public.recalculate_manual_expense_settlement(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.recalculate_manual_expense_settlement(uuid,uuid) to authenticated;
