set local lock_timeout='5s';
set local statement_timeout='60s';
do $preflight$ begin
 if to_regprocedure('private.is_request_tenant_member(uuid)') is null
  or to_regprocedure('driver_chat_private.context(uuid,uuid)') is null then raise exception 'agent_chat_prerequisites_missing';end if;
 if (select md5(replace(prosrc,chr(13),'')) from pg_proc where oid='driver_chat_private.list_messages(uuid,uuid,jsonb)'::regprocedure)
  <>'edaf730a269b55907d93802751765a54' then raise exception 'agent_chat_legacy_source_changed';end if;
end;$preflight$;

alter table public.driver_direct_messages add column agent_user_id uuid;
alter table public.driver_direct_messages add constraint driver_agent_chat_verified
 check(agent_user_id is null or (client_request_id is not null and conversation_user_id is not null));
create index driver_agent_chat_page on public.driver_direct_messages
 (tenant_id,driver_id,agent_user_id,conversation_user_id,created_at desc,id desc) where agent_user_id is not null;
create index driver_agent_chat_inbox on public.driver_direct_messages
 (tenant_id,agent_user_id,driver_id,conversation_user_id,created_at desc,id desc) where agent_user_id is not null;
create policy driver_agent_chat_participants on public.driver_direct_messages as restrictive for select to authenticated
 using(agent_user_id is null or agent_user_id=(select auth.uid()) or conversation_user_id=(select auth.uid()));
do $realtime$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  if exists(select 1 from pg_publication_rel r join pg_publication p on p.oid=r.prpubid
   where p.pubname='supabase_realtime' and r.prrelid='public.driver_direct_messages'::regclass
    and (r.prattrs is not null or r.prqual is not null)) then raise exception 'agent_chat_realtime_contract_changed';end if;
  if not exists(select 1 from pg_publication_rel r join pg_publication p on p.oid=r.prpubid
   where p.pubname='supabase_realtime' and r.prrelid='public.driver_direct_messages'::regclass) then
   alter publication supabase_realtime add table public.driver_direct_messages;
  end if;
 end if;
end;$realtime$;

-- General-chat APIs must never return messages from private agent threads, even though their helpers are definers.
do $legacy$ declare definition text;begin
 select pg_get_functiondef(oid) into definition from pg_proc where oid='driver_chat_private.list_messages(uuid,uuid,jsonb)'::regprocedure;
 if (length(definition)-length(replace(definition,'m.driver_id=_driver','')))/length('m.driver_id=_driver')<>2 then
  raise exception 'agent_chat_legacy_markers_changed';end if;
 execute replace(definition,'m.driver_id=_driver','m.driver_id=_driver and m.agent_user_id is null');
end;$legacy$;

create function driver_chat_private.agent_context(_tenant uuid,_driver uuid,_agent uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare base jsonb;agent_role text;agent_active boolean;agent_name text;historical boolean;revision text;
begin
 if auth.uid() is null or not coalesce(private.is_request_tenant_member(_tenant),false) then
  raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 base:=driver_chat_private.context(_tenant,_driver);
 if _agent is null or (base->>'sender_role'<>'driver' and _agent<>auth.uid()) then
  raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 select m.role::text,m.active into agent_role,agent_active from public.tenant_memberships m
  where m.tenant_id=_tenant and m.user_id=_agent;
 select exists(select 1 from public.driver_direct_messages m where m.tenant_id=_tenant and m.driver_id=_driver
  and m.agent_user_id=_agent and m.conversation_user_id=(base->>'conversation_user_id')::uuid) into historical;
 if not coalesce(agent_role in('owner','admin','operator') and agent_active,false) and not historical then
  raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 select coalesce(nullif(btrim(p.full_name),''),'Atendente') into agent_name from public.profiles p where p.id=_agent;
 agent_name:=coalesce(agent_name,'Atendente');
 agent_active:=coalesce(agent_role in('owner','admin','operator') and agent_active,false);
 revision:=md5(jsonb_build_object('base',base->>'revision','agent',_agent,'agent_role',agent_role,
  'agent_active',agent_active,'agent_name',agent_name)::text);
 return base||jsonb_build_object('agent_user_id',_agent,'agent_name',agent_name,'agent_active',agent_active,
  'can_send',(base->>'can_send')::boolean and agent_active,'revision',revision);
end;$fn$;

create function driver_chat_private.agent_message_json(_row public.driver_direct_messages) returns jsonb
 language sql immutable security invoker set search_path='' as $fn$
 select driver_chat_private.message_json(_row)||jsonb_build_object('agent_user_id',_row.agent_user_id);
$fn$;

create function driver_chat_private.agent_list(_tenant uuid,_driver uuid,_agent uuid,_before jsonb) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare context jsonb;cursor_id uuid;cursor_time timestamptz;rows jsonb;has_more boolean;next_cursor jsonb;
begin
 context:=driver_chat_private.agent_context(_tenant,_driver,_agent);
 if _before is not null and _before<>'null'::jsonb then
  if jsonb_typeof(_before)<>'object' or (_before-array['id','created_at'])<>'{}'::jsonb then raise exception 'driver_chat_invalid_cursor' using errcode='22023';end if;
  cursor_id:=(_before->>'id')::uuid;cursor_time:=(_before->>'created_at')::timestamptz;
  if cursor_id is null or cursor_time is null or not isfinite(cursor_time) or not exists(
   select 1 from public.driver_direct_messages m where m.id=cursor_id and m.created_at=cursor_time
    and m.tenant_id=_tenant and m.driver_id=_driver and m.agent_user_id=_agent
    and m.conversation_user_id=(context->>'conversation_user_id')::uuid) then
   raise exception 'driver_chat_invalid_cursor' using errcode='22023';end if;
 end if;
 with page as(select m.* from public.driver_direct_messages m where m.tenant_id=_tenant and m.driver_id=_driver
   and m.agent_user_id=_agent and m.conversation_user_id=(context->>'conversation_user_id')::uuid
   and (cursor_id is null or (m.created_at,m.id)<(cursor_time,cursor_id)) order by m.created_at desc,m.id desc limit 51),
 shown as(select * from page order by created_at desc,id desc limit 50)
 select coalesce((select jsonb_agg(driver_chat_private.agent_message_json(s) order by s.created_at desc,s.id desc) from shown s),'[]'::jsonb),
  (select count(*)>50 from page),(select jsonb_build_object('id',id,'created_at',created_at) from shown order by created_at,id limit 1)
 into rows,has_more,next_cursor;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'driver_id',_driver,'agent_user_id',_agent,
  'messages',rows,'next_cursor',case when has_more then next_cursor else null end);
end;$fn$;

create function driver_chat_private.agent_send(_payload jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $fn$
declare actor uuid:=auth.uid();tenant uuid;driver uuid;agent uuid;request uuid;body text;hash text;context jsonb;r public.driver_direct_messages%rowtype;
begin
 if _payload is null or jsonb_typeof(_payload)<>'object' or octet_length(_payload::text)>40000
  or _payload->'version' is distinct from '1'::jsonb
  or (_payload-array['version','tenant_id','actor_id','driver_id','agent_user_id','request_id','expected_revision','message'])<>'{}'::jsonb then
  raise exception 'driver_chat_invalid_payload' using errcode='22023';end if;
 tenant:=(_payload->>'tenant_id')::uuid;driver:=(_payload->>'driver_id')::uuid;agent:=(_payload->>'agent_user_id')::uuid;request:=(_payload->>'request_id')::uuid;
 if actor is null or (_payload->>'actor_id')::uuid is distinct from actor or tenant is null or driver is null or agent is null or request is null then
  raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 if jsonb_typeof(_payload->'message') is distinct from 'string' or char_length(btrim(_payload->>'message')) not between 1 and 4000 then
  raise exception 'driver_chat_invalid_message' using errcode='22023';end if;
 body:=btrim(_payload->>'message');hash:=encode(sha256(convert_to(_payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtext('driver-chat-message'),hashtext(tenant::text||':'||actor::text||':'||request::text));
 context:=driver_chat_private.agent_context(tenant,driver,agent);
 perform 1 from public.drivers d where d.tenant_id=tenant and d.id=driver for share nowait;
 perform 1 from public.tenant_memberships m where m.tenant_id=tenant
  and m.user_id in(actor,agent,(context->>'conversation_user_id')::uuid) order by m.user_id for share nowait;
 context:=driver_chat_private.agent_context(tenant,driver,agent);
 select * into r from public.driver_direct_messages m where m.tenant_id=tenant and m.sender_id=actor and m.client_request_id=request;
 if found then
  if r.request_hash<>hash or r.agent_user_id is distinct from agent then raise exception 'driver_chat_request_mismatch' using errcode='22023';end if;
  if r.conversation_user_id is distinct from (context->>'conversation_user_id')::uuid then raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 else
  if not (context->>'can_send')::boolean then raise exception 'driver_agent_chat_recipient_unavailable' using errcode='23514';end if;
  if coalesce(_payload->>'expected_revision','')!~'^[a-f0-9]{32}$' or _payload->>'expected_revision' is distinct from context->>'revision' then
   raise exception 'driver_chat_context_changed' using errcode='40001';end if;
  insert into public.driver_direct_messages(tenant_id,driver_id,agent_user_id,sender_id,sender_role,sender_name,message,client_request_id,request_hash,conversation_user_id,created_at)
  values(tenant,driver,agent,actor,context->>'sender_role',context->>'sender_name',body,request,hash,(context->>'conversation_user_id')::uuid,clock_timestamp()) returning * into r;
 end if;
 return jsonb_build_object('version',1,'tenant_id',tenant,'actor_id',actor,'driver_id',driver,'agent_user_id',agent,
  'request_id',request,'confirmed',true,'message',driver_chat_private.agent_message_json(r));
exception when lock_not_available or deadlock_detected then raise exception 'driver_chat_concurrent_change' using errcode='40001';
end;$fn$;

create function driver_chat_private.agent_contacts(_tenant uuid,_driver uuid) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare context jsonb;contacts jsonb;
begin
 if auth.uid() is null or not coalesce(private.is_request_tenant_member(_tenant),false) then raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 context:=driver_chat_private.context(_tenant,_driver);
 if context->>'sender_role'<>'driver' then raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 with ids as(select m.user_id from public.tenant_memberships m where m.tenant_id=_tenant and m.active and m.role::text in('owner','admin','operator')
  union select m.agent_user_id from public.driver_direct_messages m where m.tenant_id=_tenant and m.driver_id=_driver
   and m.agent_user_id is not null and m.conversation_user_id=(context->>'conversation_user_id')::uuid),
 people as(select i.user_id,coalesce(nullif(btrim(p.full_name),''),'Atendente') as name,
  coalesce(m.active and m.role::text in('owner','admin','operator'),false) as active,
  case when m.role::text in('owner','admin','operator') then m.role::text else 'history' end as role,
  last.id as last_message_id,last.created_at as last_created_at,left(last.message,140) as last_message,last.sender_id as last_sender_id
  from ids i left join public.tenant_memberships m on m.tenant_id=_tenant and m.user_id=i.user_id
  left join public.profiles p on p.id=i.user_id left join lateral(
   select msg.id,msg.created_at,msg.message,msg.sender_id from public.driver_direct_messages msg
   where msg.tenant_id=_tenant and msg.driver_id=_driver and msg.agent_user_id=i.user_id
    and msg.conversation_user_id=(context->>'conversation_user_id')::uuid order by msg.created_at desc,msg.id desc limit 1
  ) last on true)
 select coalesce(jsonb_agg(to_jsonb(p) order by p.last_created_at desc nulls last,p.name,p.user_id),'[]'::jsonb) into contacts from people p;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'driver_id',_driver,'contacts',contacts);
end;$fn$;

create function driver_chat_private.agent_inbox(_tenant uuid,_before jsonb) returns jsonb
 language plpgsql stable security definer set search_path='' as $fn$
declare cursor_id uuid;cursor_time timestamptz;rows jsonb;has_more boolean;next_cursor jsonb;
begin
 if auth.uid() is null or not coalesce(private.is_request_tenant_member(_tenant),false) or not exists(
  select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role::text in('owner','admin','operator')) then
  raise exception 'driver_chat_not_authorized' using errcode='42501';end if;
 if _before is not null and _before<>'null'::jsonb then
  if jsonb_typeof(_before)<>'object' or (_before-array['id','created_at'])<>'{}'::jsonb then raise exception 'driver_chat_invalid_cursor' using errcode='22023';end if;
  cursor_id:=(_before->>'id')::uuid;cursor_time:=(_before->>'created_at')::timestamptz;
  if cursor_id is null or cursor_time is null or not isfinite(cursor_time) or not exists(
   select 1 from public.driver_direct_messages m join public.drivers d on d.tenant_id=m.tenant_id and d.id=m.driver_id
   where m.id=cursor_id and m.created_at=cursor_time and m.tenant_id=_tenant and m.agent_user_id=auth.uid() and m.conversation_user_id=d.user_id) then
   raise exception 'driver_chat_invalid_cursor' using errcode='22023';end if;
 end if;
 with latest as(select distinct on(m.driver_id) m.id,m.driver_id,d.name as driver_name,m.created_at,left(m.message,140) as message,m.sender_id
  from public.driver_direct_messages m join public.drivers d on d.tenant_id=m.tenant_id and d.id=m.driver_id
  where m.tenant_id=_tenant and m.agent_user_id=auth.uid() and m.conversation_user_id=d.user_id
  order by m.driver_id,m.created_at desc,m.id desc),
 page as(select * from latest where cursor_id is null or (created_at,id)<(cursor_time,cursor_id) order by created_at desc,id desc limit 51),
 shown as(select * from page order by created_at desc,id desc limit 50)
 select coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc,s.id desc) from shown s),'[]'::jsonb),
  (select count(*)>50 from page),(select jsonb_build_object('id',id,'created_at',created_at) from shown order by created_at,id limit 1)
 into rows,has_more,next_cursor;
 return jsonb_build_object('version',1,'tenant_id',_tenant,'actor_id',auth.uid(),'threads',rows,'next_cursor',case when has_more then next_cursor else null end);
end;$fn$;

create function public.get_driver_agent_chat_context(_tenant_id uuid,_driver_id uuid,_agent_user_id uuid) returns jsonb
 language sql stable security invoker set search_path='' as $fn$select driver_chat_private.agent_context(_tenant_id,_driver_id,_agent_user_id);$fn$;
create function public.list_driver_agent_chat_messages(_tenant_id uuid,_driver_id uuid,_agent_user_id uuid,_before jsonb default null) returns jsonb
 language sql stable security invoker set search_path='' as $fn$select driver_chat_private.agent_list(_tenant_id,_driver_id,_agent_user_id,_before);$fn$;
create function public.send_driver_agent_chat_message(_payload jsonb) returns jsonb
 language sql security invoker set search_path='' as $fn$select driver_chat_private.agent_send(_payload);$fn$;
create function public.list_driver_chat_agents(_tenant_id uuid,_driver_id uuid) returns jsonb
 language sql stable security invoker set search_path='' as $fn$select driver_chat_private.agent_contacts(_tenant_id,_driver_id);$fn$;
create function public.list_driver_agent_inbox(_tenant_id uuid,_before jsonb default null) returns jsonb
 language sql stable security invoker set search_path='' as $fn$select driver_chat_private.agent_inbox(_tenant_id,_before);$fn$;

revoke all on function driver_chat_private.agent_context(uuid,uuid,uuid),driver_chat_private.agent_list(uuid,uuid,uuid,jsonb),
 driver_chat_private.agent_send(jsonb),driver_chat_private.agent_contacts(uuid,uuid),driver_chat_private.agent_inbox(uuid,jsonb),
 driver_chat_private.agent_message_json(public.driver_direct_messages) from public,anon,authenticated,service_role;
grant execute on function driver_chat_private.agent_context(uuid,uuid,uuid),driver_chat_private.agent_list(uuid,uuid,uuid,jsonb),
 driver_chat_private.agent_send(jsonb),driver_chat_private.agent_contacts(uuid,uuid),driver_chat_private.agent_inbox(uuid,jsonb) to authenticated;
revoke all on function public.get_driver_agent_chat_context(uuid,uuid,uuid),public.list_driver_agent_chat_messages(uuid,uuid,uuid,jsonb),
 public.send_driver_agent_chat_message(jsonb),public.list_driver_chat_agents(uuid,uuid),public.list_driver_agent_inbox(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_driver_agent_chat_context(uuid,uuid,uuid),public.list_driver_agent_chat_messages(uuid,uuid,uuid,jsonb),
 public.send_driver_agent_chat_message(jsonb),public.list_driver_chat_agents(uuid,uuid),public.list_driver_agent_inbox(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
