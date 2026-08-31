-- Unpublished candidate. Direct chat only; no messages leave this database.
set local lock_timeout='3s';set local statement_timeout='30s';
create schema driver_chat_private;
revoke all on schema driver_chat_private from public,anon,authenticated,service_role;
grant usage on schema driver_chat_private to authenticated;
alter table public.driver_direct_messages add column client_request_id uuid,add column request_hash text,add column conversation_user_id uuid;
create unique index driver_chat_driver_scope on public.drivers(tenant_id,id);
alter table public.driver_direct_messages add constraint driver_chat_driver_scope_fkey
 foreign key(tenant_id,driver_id) references public.drivers(tenant_id,id) on delete restrict not valid;
-- Existing mismatched/legacy rows are preserved for deliberate reconciliation.
create unique index driver_chat_request_unique on public.driver_direct_messages(tenant_id,sender_id,client_request_id) where client_request_id is not null;
create index driver_chat_page_idx on public.driver_direct_messages(tenant_id,driver_id,created_at desc,id desc);

create function driver_chat_private.can_read(_tenant uuid,_driver uuid,_recipient uuid) returns boolean
 language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.tenant_memberships m join public.drivers d on d.tenant_id=m.tenant_id
  where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and d.id=_driver and
   (m.role::text='operator' or (m.role::text in('owner','admin') and coalesce(auth.jwt()->>'aal','aal1')='aal2')
    or (m.role::text='driver' and d.active and d.user_id=auth.uid() and _recipient=auth.uid())));
$fn$;
revoke all on function driver_chat_private.can_read(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function driver_chat_private.can_read(uuid,uuid,uuid) to authenticated;
alter table public.driver_direct_messages enable row level security;
revoke all on public.driver_direct_messages from public,anon,authenticated,service_role;
grant select on public.driver_direct_messages to authenticated;
drop policy if exists "Authorized users read driver direct messages" on public.driver_direct_messages;
drop policy if exists "Authorized users send driver direct messages" on public.driver_direct_messages;
create policy driver_chat_read on public.driver_direct_messages for select to authenticated
 using(driver_chat_private.can_read(tenant_id,driver_id,conversation_user_id));
create policy driver_chat_read_boundary on public.driver_direct_messages as restrictive for select to authenticated
 using(driver_chat_private.can_read(tenant_id,driver_id,conversation_user_id));
create policy driver_chat_no_direct_insert on public.driver_direct_messages as restrictive for insert to authenticated with check(false);
create policy driver_chat_no_direct_update on public.driver_direct_messages as restrictive for update to authenticated using(false) with check(false);
create policy driver_chat_no_direct_delete on public.driver_direct_messages as restrictive for delete to authenticated using(false);

create function driver_chat_private.context(_tenant uuid,_driver uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_role text;d public.drivers%rowtype;v_name text;v_revision text;v_recipient_active boolean;
begin
 select m.role::text into v_role from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=v_actor and m.active;
 select * into d from public.drivers where tenant_id=_tenant and id=_driver;
 if v_actor is null or v_role is null or d.id is null or not (v_role in('owner','admin','operator') or (v_role='driver' and d.user_id=v_actor and d.active)) then
  raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 if v_role in('owner','admin') and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'driver_chat_mfa_required' using errcode='42501';end if;
 if v_role='driver' then v_name:=d.name;else select full_name into v_name from public.profiles where id=v_actor;end if;
 v_name:=coalesce(nullif(btrim(v_name),''),case when v_role='driver' then 'Motorista' else 'Operação' end);
 v_recipient_active:=exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=d.user_id and m.active and m.role::text='driver');
 v_revision:=md5(jsonb_build_object('driver_id',d.id,'tenant_id',d.tenant_id,'driver_user',d.user_id,'active',d.active,'recipient_active',v_recipient_active,'role',v_role,'actor',v_actor,'sender_name',v_name)::text);
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',v_actor,'driver_id',_driver,'driver_name',d.name,
  'conversation_user_id',d.user_id,'sender_role',v_role,'sender_name',v_name,'can_send',coalesce(d.active and d.user_id is not null and v_recipient_active,false),'revision',v_revision);
end;$fn$;
revoke all on function driver_chat_private.context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function driver_chat_private.context(uuid,uuid) to authenticated;
create function public.get_driver_chat_context(_tenant_id uuid,_driver_id uuid) returns jsonb
 language sql stable security invoker set search_path='' as $fn$select driver_chat_private.context(_tenant_id,_driver_id);$fn$;
revoke all on function public.get_driver_chat_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_driver_chat_context(uuid,uuid) to authenticated;

create function driver_chat_private.message_json(_row public.driver_direct_messages) returns jsonb
 language sql immutable security invoker set search_path='' as $fn$
 select jsonb_build_object('id',_row.id,'tenant_id',_row.tenant_id,'driver_id',_row.driver_id,'sender_id',_row.sender_id,
  'sender_role',_row.sender_role,'sender_name',_row.sender_name,'message',_row.message,'created_at',_row.created_at,
  'request_id',_row.client_request_id,'conversation_user_id',_row.conversation_user_id,'verified_sender',_row.client_request_id is not null,
  'has_legacy_attachment',_row.attachment_url is not null);
$fn$;
revoke all on function driver_chat_private.message_json(public.driver_direct_messages) from public,anon,authenticated,service_role;
create function driver_chat_private.list_messages(_tenant uuid,_driver uuid,_before jsonb) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare v_context jsonb;v_cursor_id uuid;v_cursor_time timestamptz;v_rows jsonb;v_has_more boolean;v_next jsonb;
begin
 v_context:=driver_chat_private.context(_tenant,_driver);
 if _before is not null and _before<>'null'::jsonb then
  if jsonb_typeof(_before)<>'object' or (_before-array['id','created_at'])<>'{}'::jsonb then raise exception 'driver_chat_invalid_cursor' using errcode='22023';end if;
  v_cursor_id:=(_before->>'id')::uuid;v_cursor_time:=(_before->>'created_at')::timestamptz;
  if v_cursor_id is null or v_cursor_time is null or not isfinite(v_cursor_time) or not exists(select 1 from public.driver_direct_messages m
   where m.id=v_cursor_id and m.created_at=v_cursor_time and m.tenant_id=_tenant and m.driver_id=_driver and driver_chat_private.can_read(m.tenant_id,m.driver_id,m.conversation_user_id)) then
   raise exception 'driver_chat_invalid_cursor' using errcode='22023';end if;
 end if;
 with page as(select m.* from public.driver_direct_messages m where m.tenant_id=_tenant and m.driver_id=_driver
   and driver_chat_private.can_read(m.tenant_id,m.driver_id,m.conversation_user_id)
   and (v_cursor_id is null or (m.created_at,m.id)<(v_cursor_time,v_cursor_id)) order by m.created_at desc,m.id desc limit 51),
 shown as(select * from page order by created_at desc,id desc limit 50)
 select coalesce((select jsonb_agg(driver_chat_private.message_json(s) order by s.created_at desc,s.id desc) from shown s),'[]'::jsonb),
  (select count(*)>50 from page),
  (select jsonb_build_object('id',id,'created_at',created_at) from shown order by created_at,id limit 1)
 into v_rows,v_has_more,v_next;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'driver_id',_driver,'messages',v_rows,'next_cursor',case when v_has_more then v_next else null end);
end;$fn$;
revoke all on function driver_chat_private.list_messages(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function driver_chat_private.list_messages(uuid,uuid,jsonb) to authenticated;
create function public.list_driver_chat_messages(_tenant_id uuid,_driver_id uuid,_before jsonb default null) returns jsonb
 language sql stable security invoker set search_path='' as $fn$select driver_chat_private.list_messages(_tenant_id,_driver_id,_before);$fn$;
revoke all on function public.list_driver_chat_messages(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_driver_chat_messages(uuid,uuid,jsonb) to authenticated;

create function driver_chat_private.send_message(_payload jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_driver uuid;v_request uuid;v_text text;v_hash text;v_role text;v_context jsonb;r public.driver_direct_messages%rowtype;
begin
 if _payload is null or jsonb_typeof(_payload)<>'object' or octet_length(_payload::text)>40000 or _payload->'version' is distinct from '1'::jsonb
  or (_payload-array['version','tenant_id','actor_id','driver_id','request_id','expected_revision','message'])<>'{}'::jsonb then raise exception 'driver_chat_invalid_payload' using errcode='22023';end if;
 v_tenant:=(_payload->>'tenant_id')::uuid;v_driver:=(_payload->>'driver_id')::uuid;v_request:=(_payload->>'request_id')::uuid;
 if v_actor is null or (_payload->>'actor_id')::uuid is distinct from v_actor or v_tenant is null or v_driver is null or v_request is null then raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 if jsonb_typeof(_payload->'message') is distinct from 'string' or char_length(btrim(_payload->>'message')) not between 1 and 4000 then raise exception 'driver_chat_invalid_message' using errcode='22023';end if;
 v_text:=btrim(_payload->>'message');v_hash:=encode(sha256(convert_to(_payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('driver-chat-message'),hashtext(v_tenant::text||':'||v_actor::text||':'||v_request::text));
 select m.role::text into v_role from public.tenant_memberships m where m.tenant_id=v_tenant and m.user_id=v_actor and m.active for share nowait;
 if v_role is null then raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 perform 1 from public.drivers where tenant_id=v_tenant and id=v_driver for share nowait;
 v_context:=driver_chat_private.context(v_tenant,v_driver);
 select * into r from public.driver_direct_messages where tenant_id=v_tenant and sender_id=v_actor and client_request_id=v_request;
 if found then
  if r.request_hash<>v_hash then raise exception 'driver_chat_request_mismatch' using errcode='22023';end if;
  if not driver_chat_private.can_read(r.tenant_id,r.driver_id,r.conversation_user_id) then raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 else
  -- Freeze recipient membership while accepting a new message; an old confirmed
  -- operation message remains recoverable even when its recipient is now inactive.
  perform 1 from public.tenant_memberships m where m.tenant_id=v_tenant and m.user_id=(v_context->>'conversation_user_id')::uuid for share nowait;
  v_context:=driver_chat_private.context(v_tenant,v_driver);
  if not (v_context->>'can_send')::boolean then raise exception 'driver_chat_recipient_unavailable' using errcode='23514';end if;
  if coalesce(_payload->>'expected_revision','')!~'^[a-f0-9]{32}$' or _payload->>'expected_revision' is distinct from v_context->>'revision' then raise exception 'driver_chat_context_changed' using errcode='40001';end if;
  insert into public.driver_direct_messages(tenant_id,driver_id,sender_id,sender_role,sender_name,message,client_request_id,request_hash,conversation_user_id)
   values(v_tenant,v_driver,v_actor,v_context->>'sender_role',v_context->>'sender_name',v_text,v_request,v_hash,(v_context->>'conversation_user_id')::uuid) returning * into r;
 end if;
 return jsonb_build_object('version',1,'tenant_id',v_tenant,'actor_id',v_actor,'driver_id',v_driver,'request_id',v_request,'confirmed',true,'message',driver_chat_private.message_json(r));
exception when lock_not_available or deadlock_detected then raise exception 'driver_chat_concurrent_change' using errcode='40001';
end;$fn$;
revoke all on function driver_chat_private.send_message(jsonb) from public,anon,authenticated,service_role;
grant execute on function driver_chat_private.send_message(jsonb) to authenticated;
create function public.send_driver_chat_message(_payload jsonb) returns jsonb
 language sql security invoker set search_path='' as $fn$select driver_chat_private.send_message(_payload);$fn$;
revoke all on function public.send_driver_chat_message(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.send_driver_chat_message(jsonb) to authenticated;

create function driver_chat_private.guard_message() returns trigger language plpgsql security invoker set search_path='' as $fn$
begin
 if TG_OP<>'INSERT' then
  if OLD.client_request_id is not null then raise exception 'driver_chat_message_immutable' using errcode='23514';end if;
  if TG_OP='DELETE' then return OLD;else return NEW;end if;
 end if;
 if NEW.client_request_id is null or NEW.sender_id is null or NEW.conversation_user_id is null or coalesce(NEW.request_hash,'')!~'^[a-f0-9]{64}$'
  or NEW.sender_role not in('owner','admin','operator','driver') or char_length(btrim(NEW.message)) not between 1 and 4000 or NEW.attachment_url is not null then
  raise exception 'driver_chat_command_required' using errcode='23514';end if;
 return NEW;
end;$fn$;
revoke all on function driver_chat_private.guard_message() from public,anon,authenticated,service_role;
create trigger driver_chat_message_guard before insert or update or delete on public.driver_direct_messages for each row execute function driver_chat_private.guard_message();
