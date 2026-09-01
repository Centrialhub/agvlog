-- Unpublished event-chat candidate, after the direct-chat contract.
set local lock_timeout='3s';set local statement_timeout='30s';
do $preflight$
begin
 if to_regnamespace('driver_chat_private') is null
  or to_regprocedure('public.send_driver_chat_message(jsonb)') is null
  or to_regclass('public.operational_events') is null
  or to_regclass('public.operational_event_messages') is null then
  raise exception 'Event chat requires the recoverable direct-chat contract';end if;
 if to_regprocedure('public.get_event_chat_context(uuid,uuid)') is not null
  or to_regprocedure('public.list_event_chat_messages(uuid,uuid,jsonb)') is not null
  or to_regprocedure('public.send_event_chat_message(jsonb)') is not null
  or to_regprocedure('driver_chat_private.event_row_can_read(uuid,uuid)') is not null
  or exists(select 1 from information_schema.columns where table_schema='public' and table_name='operational_event_messages'
   and column_name in('client_request_id','request_hash','conversation_driver_id','conversation_user_id')) then
  raise exception 'Event chat rollout is already installed or partial';end if;
 if not exists(select 1 from pg_class where oid='public.operational_events'::regclass and relrowsecurity)
  or not exists(select 1 from pg_class where oid='public.operational_event_messages'::regclass and relrowsecurity)
  or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='operational_events' and column_name='driver_id')
  or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='operational_event_messages' and column_name='sender_id') then
  raise exception 'Event chat legacy contract changed';end if;
end;$preflight$;
alter table public.operational_event_messages add column client_request_id uuid,add column request_hash text,add column conversation_driver_id uuid,add column conversation_user_id uuid;
create unique index event_chat_event_scope on public.operational_events(tenant_id,id);
alter table public.operational_event_messages add constraint event_chat_event_scope_fkey foreign key(tenant_id,event_id) references public.operational_events(tenant_id,id) on delete restrict not valid;
create unique index event_chat_request_unique on public.operational_event_messages(tenant_id,sender_id,client_request_id) where client_request_id is not null;
create index event_chat_page_idx on public.operational_event_messages(tenant_id,event_id,created_at desc,id desc);

create function driver_chat_private.event_binding(_tenant uuid,_event uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare e public.operational_events%rowtype;t public.dispatch_trips%rowtype;s public.dispatch_stops%rowtype;v_trip uuid;v_driver uuid;
begin
 select * into e from public.operational_events where tenant_id=_tenant and id=_event;if not found then return null;end if;
 v_trip:=e.dispatch_trip_id;
 if e.dispatch_stop_id is not null then
  select * into s from public.dispatch_stops where tenant_id=_tenant and id=e.dispatch_stop_id;
  if not found or (v_trip is not null and v_trip is distinct from s.dispatch_trip_id) then return null;end if;
  v_trip:=coalesce(v_trip,s.dispatch_trip_id);
 end if;
 if v_trip is not null then select * into t from public.dispatch_trips where tenant_id=_tenant and id=v_trip;if not found then return null;end if;end if;
 -- Explicit event driver is authoritative. Do not share historical conversation
 -- with a later trip assignee through an OR of unrelated ownership predicates.
 v_driver:=coalesce(e.driver_id,t.driver_id);
 if v_driver is not null and not exists(select 1 from public.drivers where tenant_id=_tenant and id=v_driver) then return null;end if;
 return jsonb_build_object('event_id',e.id,'explicit_driver',e.driver_id,'driver_id',v_driver,'trip_id',v_trip,'stop_id',e.dispatch_stop_id);
end;$fn$;

create function driver_chat_private.event_can_access(_tenant uuid,_event uuid) returns boolean
 language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.tenant_memberships m join public.operational_events e on e.tenant_id=m.tenant_id
  where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and e.id=_event and
   (m.role::text='operator' or (m.role::text in('owner','admin') and coalesce(auth.jwt()->>'aal','aal1')='aal2')
    or (m.role::text='driver' and exists(select 1 from public.drivers d where d.tenant_id=_tenant and d.id=(driver_chat_private.event_binding(_tenant,_event)->>'driver_id')::uuid and d.user_id=auth.uid() and d.active))));
$fn$;
create function driver_chat_private.event_row_can_read(_tenant uuid,_event uuid) returns boolean
 language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.tenant_memberships m join public.operational_events e on e.tenant_id=m.tenant_id
  where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and e.id=_event and
   (m.role::text in('owner','admin','operator') or
    (m.role::text='driver' and exists(select 1 from public.drivers d where d.tenant_id=_tenant
      and d.id=(driver_chat_private.event_binding(_tenant,_event)->>'driver_id')::uuid
      and d.user_id=auth.uid() and d.active))));
$fn$;
create function driver_chat_private.event_can_read(_tenant uuid,_event uuid,_driver uuid,_recipient uuid) returns boolean
 language sql stable security definer set search_path='' as $fn$
 select driver_chat_private.event_can_access(_tenant,_event) and exists(select 1 from public.tenant_memberships m
  where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and
   (m.role::text in('owner','admin','operator') or
    (m.role::text='driver' and _recipient=auth.uid() and _driver=(driver_chat_private.event_binding(_tenant,_event)->>'driver_id')::uuid)));
$fn$;

create function driver_chat_private.event_context(_tenant uuid,_event uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_role text;v_binding jsonb;v_driver uuid;d public.drivers%rowtype;v_name text;v_recipient_active boolean;v_can_send boolean;
begin
 select role::text into v_role from public.tenant_memberships where tenant_id=_tenant and user_id=v_actor and active;
 if v_actor is null or v_role is null or not exists(select 1 from public.operational_events where tenant_id=_tenant and id=_event) then raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 if v_role in('owner','admin') and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'driver_chat_mfa_required' using errcode='42501';end if;
 if not driver_chat_private.event_can_access(_tenant,_event) then raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 v_binding:=driver_chat_private.event_binding(_tenant,_event);if v_binding is null then raise exception 'event_chat_invalid_binding' using errcode='23514';end if;
 v_driver:=(v_binding->>'driver_id')::uuid;select * into d from public.drivers where tenant_id=_tenant and id=v_driver;
 if v_role='driver' then v_name:=d.name;else select full_name into v_name from public.profiles where id=v_actor;end if;
 v_name:=coalesce(nullif(btrim(v_name),''),case when v_role='driver' then 'Motorista' else 'Operação' end);
 v_recipient_active:=exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=d.user_id and m.active and m.role::text='driver');
 v_can_send:=v_driver is null or coalesce(d.active and d.user_id is not null and v_recipient_active,false);
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',v_actor,'event_id',_event,'driver_id',v_driver,
  'driver_name',coalesce(d.name,'Sem motorista vinculado'),'conversation_user_id',d.user_id,'sender_role',v_role,'sender_name',v_name,
  'audience',case when v_driver is null then 'operation' else 'driver' end,'can_send',v_can_send,
  'revision',md5(jsonb_build_object('binding',v_binding,'driver_user',d.user_id,'active',d.active,'recipient_active',v_recipient_active,'role',v_role,'actor',v_actor,'sender_name',v_name)::text));
end;$fn$;
create function public.get_event_chat_context(_tenant_id uuid,_event_id uuid) returns jsonb language sql stable security invoker set search_path='' as $fn$select driver_chat_private.event_context(_tenant_id,_event_id);$fn$;

create function driver_chat_private.event_message_json(_row public.operational_event_messages) returns jsonb
 language sql immutable security invoker set search_path='' as $fn$
 select jsonb_build_object('id',_row.id,'tenant_id',_row.tenant_id,'event_id',_row.event_id,'driver_id',_row.conversation_driver_id,
  'sender_id',_row.sender_id,'sender_role',_row.sender_role,'sender_name',_row.sender_name,'message',_row.message,'created_at',_row.created_at,
  'request_id',_row.client_request_id,'conversation_user_id',_row.conversation_user_id,'verified_sender',_row.client_request_id is not null,'has_legacy_attachment',_row.attachment_url is not null);
$fn$;
create function driver_chat_private.event_list(_tenant uuid,_event uuid,_before jsonb) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare c jsonb;v_id uuid;v_time timestamptz;v_rows jsonb;v_more boolean;v_next jsonb;
begin
 c:=driver_chat_private.event_context(_tenant,_event);
 if _before is not null and _before<>'null'::jsonb then
  if jsonb_typeof(_before)<>'object' or (_before-array['id','created_at'])<>'{}'::jsonb then raise exception 'driver_chat_invalid_cursor' using errcode='22023';end if;
  v_id:=(_before->>'id')::uuid;v_time:=(_before->>'created_at')::timestamptz;
  if v_id is null or v_time is null or not isfinite(v_time) or not exists(select 1 from public.operational_event_messages m where m.id=v_id and m.created_at=v_time and m.tenant_id=_tenant and m.event_id=_event and driver_chat_private.event_can_read(m.tenant_id,m.event_id,m.conversation_driver_id,m.conversation_user_id)) then raise exception 'driver_chat_invalid_cursor' using errcode='22023';end if;
 end if;
 with page as(select m.* from public.operational_event_messages m where m.tenant_id=_tenant and m.event_id=_event
  and driver_chat_private.event_can_read(m.tenant_id,m.event_id,m.conversation_driver_id,m.conversation_user_id)
  and (v_id is null or (m.created_at,m.id)<(v_time,v_id)) order by m.created_at desc,m.id desc limit 51),
 shown as(select * from page order by created_at desc,id desc limit 50)
 select coalesce((select jsonb_agg(driver_chat_private.event_message_json(s) order by s.created_at desc,s.id desc) from shown s),'[]'::jsonb),
  (select count(*)>50 from page),(select jsonb_build_object('id',id,'created_at',created_at) from shown order by created_at,id limit 1) into v_rows,v_more,v_next;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'event_id',_event,'driver_id',c->'driver_id','messages',v_rows,'next_cursor',case when v_more then v_next else null end);
end;$fn$;
create function public.list_event_chat_messages(_tenant_id uuid,_event_id uuid,_before jsonb default null) returns jsonb language sql stable security invoker set search_path='' as $fn$select driver_chat_private.event_list(_tenant_id,_event_id,_before);$fn$;

create function driver_chat_private.event_send(_payload jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $fn$
declare v_actor uuid:=auth.uid();v_tenant uuid;v_event uuid;v_request uuid;v_text text;v_hash text;c jsonb;b jsonb;e public.operational_events%rowtype;r public.operational_event_messages%rowtype;
begin
 if _payload is null or jsonb_typeof(_payload)<>'object' or octet_length(_payload::text)>40000 or _payload->'version' is distinct from '1'::jsonb
  or (_payload-array['version','tenant_id','actor_id','driver_id','event_id','request_id','expected_revision','message'])<>'{}'::jsonb then raise exception 'driver_chat_invalid_payload' using errcode='22023';end if;
 v_tenant:=(_payload->>'tenant_id')::uuid;v_event:=(_payload->>'event_id')::uuid;v_request:=(_payload->>'request_id')::uuid;
 if v_actor is null or (_payload->>'actor_id')::uuid is distinct from v_actor or v_tenant is null or v_event is null or v_request is null then raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 if jsonb_typeof(_payload->'message') is distinct from 'string' or char_length(btrim(_payload->>'message')) not between 1 and 4000 then raise exception 'driver_chat_invalid_message' using errcode='22023';end if;
 v_text:=btrim(_payload->>'message');v_hash:=encode(sha256(convert_to(_payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('event-chat-message'),hashtext(v_tenant::text||':'||v_actor::text||':'||v_request::text));
 perform 1 from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active for share nowait;if not found then raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 select * into e from public.operational_events where tenant_id=v_tenant and id=v_event for share nowait;if not found then raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 perform 1 from public.dispatch_stops where tenant_id=v_tenant and id=e.dispatch_stop_id for share nowait;
 b:=driver_chat_private.event_binding(v_tenant,v_event);
 perform 1 from public.dispatch_trips where tenant_id=v_tenant and id=(b->>'trip_id')::uuid for share nowait;
 b:=driver_chat_private.event_binding(v_tenant,v_event);
 perform 1 from public.drivers where tenant_id=v_tenant and id=(b->>'driver_id')::uuid for share nowait;
 c:=driver_chat_private.event_context(v_tenant,v_event);
 select * into r from public.operational_event_messages where tenant_id=v_tenant and sender_id=v_actor and client_request_id=v_request;
 if found then
  if r.request_hash<>v_hash then raise exception 'driver_chat_request_mismatch' using errcode='22023';end if;
  if not driver_chat_private.event_can_read(r.tenant_id,r.event_id,r.conversation_driver_id,r.conversation_user_id) then raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 else
  perform 1 from public.tenant_memberships where tenant_id=v_tenant and user_id=(c->>'conversation_user_id')::uuid for share nowait;
  c:=driver_chat_private.event_context(v_tenant,v_event);
  if not (c->>'can_send')::boolean then raise exception 'driver_chat_recipient_unavailable' using errcode='23514';end if;
  if _payload->'driver_id' is distinct from c->'driver_id' or coalesce(_payload->>'expected_revision','')!~'^[a-f0-9]{32}$' or _payload->>'expected_revision' is distinct from c->>'revision' then raise exception 'driver_chat_context_changed' using errcode='40001';end if;
  insert into public.operational_event_messages(tenant_id,event_id,sender_id,sender_role,sender_name,message,client_request_id,request_hash,conversation_driver_id,conversation_user_id)
   values(v_tenant,v_event,v_actor,c->>'sender_role',c->>'sender_name',v_text,v_request,v_hash,(c->>'driver_id')::uuid,(c->>'conversation_user_id')::uuid) returning * into r;
 end if;
 return jsonb_build_object('version',1,'tenant_id',v_tenant,'actor_id',v_actor,'event_id',v_event,'driver_id',r.conversation_driver_id,'request_id',v_request,'confirmed',true,'message',driver_chat_private.event_message_json(r));
exception when lock_not_available or deadlock_detected then raise exception 'driver_chat_concurrent_change' using errcode='40001';
end;$fn$;
create function public.send_event_chat_message(_payload jsonb) returns jsonb language sql security invoker set search_path='' as $fn$select driver_chat_private.event_send(_payload);$fn$;

create function driver_chat_private.event_guard() returns trigger language plpgsql security invoker set search_path='' as $fn$
begin
 if TG_OP<>'INSERT' then
  if OLD.client_request_id is not null then raise exception 'driver_chat_message_immutable' using errcode='23514';end if;
  if TG_OP='DELETE' then return OLD;else return NEW;end if;
 end if;
 if NEW.client_request_id is null or NEW.sender_id is null or (NEW.conversation_driver_id is null)<>(NEW.conversation_user_id is null)
  or coalesce(NEW.request_hash,'')!~'^[a-f0-9]{64}$' or NEW.sender_role not in('owner','admin','operator','driver')
  or char_length(btrim(NEW.message)) not between 1 and 4000 or NEW.attachment_url is not null then raise exception 'driver_chat_command_required' using errcode='23514';end if;
 return NEW;
end;$fn$;
create trigger event_chat_message_guard before insert or update or delete on public.operational_event_messages for each row execute function driver_chat_private.event_guard();
revoke all on function driver_chat_private.event_binding(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function driver_chat_private.event_message_json(public.operational_event_messages) from public,anon,authenticated,service_role;
revoke all on function driver_chat_private.event_guard() from public,anon,authenticated,service_role;
revoke all on function driver_chat_private.event_can_access(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function driver_chat_private.event_can_access(uuid,uuid) to authenticated;
revoke all on function driver_chat_private.event_row_can_read(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function driver_chat_private.event_row_can_read(uuid,uuid) to authenticated;
revoke all on function driver_chat_private.event_can_read(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function driver_chat_private.event_can_read(uuid,uuid,uuid,uuid) to authenticated;
revoke all on function driver_chat_private.event_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function driver_chat_private.event_context(uuid,uuid) to authenticated;
revoke all on function driver_chat_private.event_list(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function driver_chat_private.event_list(uuid,uuid,jsonb) to authenticated;
revoke all on function driver_chat_private.event_send(jsonb) from public,anon,authenticated,service_role;
grant execute on function driver_chat_private.event_send(jsonb) to authenticated;
revoke all on function public.get_event_chat_context(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_event_chat_context(uuid,uuid) to authenticated;
revoke all on function public.list_event_chat_messages(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_event_chat_messages(uuid,uuid,jsonb) to authenticated;
revoke all on function public.send_event_chat_message(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.send_event_chat_message(jsonb) to authenticated;
alter table public.operational_event_messages enable row level security;
revoke all on public.operational_event_messages from public,anon,authenticated,service_role;
grant select on public.operational_event_messages to authenticated;
drop policy if exists "Authorized users read event messages" on public.operational_event_messages;
drop policy if exists "Authorized users send event messages" on public.operational_event_messages;
create policy event_chat_read on public.operational_event_messages for select to authenticated using(driver_chat_private.event_can_read(tenant_id,event_id,conversation_driver_id,conversation_user_id));
create policy event_chat_read_boundary on public.operational_event_messages as restrictive for select to authenticated using(driver_chat_private.event_can_read(tenant_id,event_id,conversation_driver_id,conversation_user_id));
create policy event_chat_no_direct_insert on public.operational_event_messages as restrictive for insert to authenticated with check(false);
create policy event_chat_no_direct_update on public.operational_event_messages as restrictive for update to authenticated using(false) with check(false);
create policy event_chat_no_direct_delete on public.operational_event_messages as restrictive for delete to authenticated using(false);
create policy event_chat_event_read_boundary on public.operational_events as restrictive for select to authenticated using(driver_chat_private.event_row_can_read(tenant_id,id));
