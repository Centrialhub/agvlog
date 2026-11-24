-- Compatible emergency return: pause new private sends, retain exact confirmed-request recovery and all privacy guards.
set local lock_timeout='5s';
do $bridge$
declare definition text;begin
 select pg_get_functiondef(oid) into definition from pg_proc where oid='driver_chat_private.agent_send(jsonb)'::regprocedure;
 if (select md5(prosrc) from pg_proc where oid='driver_chat_private.agent_send(jsonb)'::regprocedure)<>'4704a1e776d468ad654532afb2d85be1' then raise exception 'agent_chat_rollback_source_changed';end if;
 if position($old$ else
  if not (context->>'can_send')$old$ in definition)=0 then raise exception 'agent_chat_rollback_marker_changed';end if;
 execute replace(definition,$old$ else
  if not (context->>'can_send')$old$,$new$ else
  raise exception 'driver_agent_chat_paused' using errcode='55000';
  if not (context->>'can_send')$new$);
end;$bridge$;
