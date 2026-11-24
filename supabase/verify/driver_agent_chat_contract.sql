begin;
set local statement_timeout='30s';
do $guard$ begin
 if (select count(*) from auth.users)<>7 or (select count(*) from auth.users where email like '%@agvlog-e2e.invalid')<>7 then raise exception 'isolated_seed_required';end if;
 if has_function_privilege('anon','public.send_driver_agent_chat_message(jsonb)','execute')
  or has_function_privilege('service_role','public.list_driver_agent_chat_messages(uuid,uuid,uuid,jsonb)','execute') then raise exception 'agent_chat_grants_changed';end if;
end;$guard$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1","active_tenant_id":"20000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers','{"x-agvlog-tenant-id":"20000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
do $driver$
declare tenant constant uuid:='20000000-0000-4000-8000-000000000001';driver constant uuid:='60000000-0000-4000-8000-000000000001';
 agent uuid;context jsonb;payload jsonb;first jsonb;again jsonb;
begin
 foreach agent in array array['10000000-0000-4000-8000-000000000002'::uuid,'10000000-0000-4000-8000-000000000006'::uuid] loop
  context:=public.get_driver_agent_chat_context(tenant,driver,agent);
  payload:=jsonb_build_object('version',1,'tenant_id',tenant,'actor_id',auth.uid(),'driver_id',driver,'agent_user_id',agent,
   'request_id',gen_random_uuid(),'expected_revision',context->>'revision','message','Synthetic private driver message');
  first:=public.send_driver_agent_chat_message(payload);again:=public.send_driver_agent_chat_message(payload);
  if first is distinct from again or first->'confirmed' is distinct from 'true'::jsonb then raise exception 'agent_replay_failed';end if;
  if agent='10000000-0000-4000-8000-000000000002'::uuid then perform set_config('test.agent_chat_confirmed_payload',payload::text,true);end if;
  payload:=jsonb_set(payload,'{request_id}',to_jsonb(gen_random_uuid()));payload:=jsonb_set(payload,'{expected_revision}',to_jsonb(repeat('0',32)));
  begin perform public.send_driver_agent_chat_message(payload);raise exception 'agent_stale_accepted';exception when serialization_failure then null;end;
 end loop;
 if exists(select 1 from jsonb_array_elements(public.list_driver_chat_messages(tenant,driver)->'messages') m
  where m->>'message'='Synthetic private driver message') then raise exception 'private_message_in_general_room';end if;
end;$driver$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1","active_tenant_id":"20000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
do $agent$
declare tenant constant uuid:='20000000-0000-4000-8000-000000000001';driver constant uuid:='60000000-0000-4000-8000-000000000001';context jsonb;payload jsonb;
begin
 context:=public.get_driver_agent_chat_context(tenant,driver,auth.uid());
 payload:=jsonb_build_object('version',1,'tenant_id',tenant,'actor_id',auth.uid(),'driver_id',driver,'agent_user_id',auth.uid(),
  'request_id',gen_random_uuid(),'expected_revision',context->>'revision','message','Synthetic private agent reply');
 perform public.send_driver_agent_chat_message(payload);
 if not exists(select 1 from jsonb_array_elements(public.list_driver_agent_inbox(tenant)->'threads') t where t->>'driver_id'=driver::text) then raise exception 'agent_inbox_missing';end if;
 begin perform public.get_driver_agent_chat_context(tenant,driver,'10000000-0000-4000-8000-000000000006');raise exception 'foreign_agent_accepted';exception when insufficient_privilege then null;end;
 if exists(select 1 from public.driver_direct_messages where agent_user_id='10000000-0000-4000-8000-000000000006') then raise exception 'agent_rls_leak';end if;
end;$agent$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claims','{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1","active_tenant_id":"20000000-0000-4000-8000-000000000001"}',true);
set local role authenticated;
do $return$ begin
 if not exists(select 1 from jsonb_array_elements(public.list_driver_agent_chat_messages('20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002')->'messages') m
  where m->>'message'='Synthetic private agent reply') then raise exception 'agent_reply_not_received';end if;
end;$return$;
reset role;
do $publication$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='driver_direct_messages'
  and 'agent_user_id'=any(attnames)) then raise exception 'agent_realtime_not_published';end if;
end;$publication$;
-- Test the reviewed compatible return inside this same rollback-only transaction; E2E retains the normal sender.
\ir ../../docs/qa/agent-chat-compatible-rollback.sql
set local role authenticated;
do $compatible$ declare payload jsonb;ack jsonb;begin
 payload:=current_setting('test.agent_chat_confirmed_payload')::jsonb;ack:=public.send_driver_agent_chat_message(payload);
 if ack->>'request_id' is distinct from payload->>'request_id' or ack->'confirmed' is distinct from 'true'::jsonb then raise exception 'agent_compatible_recovery_failed';end if;
 payload:=jsonb_set(payload,'{request_id}',to_jsonb(gen_random_uuid()));
 begin perform public.send_driver_agent_chat_message(payload);raise exception 'agent_pause_accepted_new_send';exception when sqlstate '55000' then null;end;
end;$compatible$;
reset role;
rollback;
