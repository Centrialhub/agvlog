-- LOCAL containment rehearsal only; not approval to apply rejected140248.
-- Exact activated140248 contract; refuse later versions until separately reviewed.
-- Pause new submissions and drain in-flight requests before execution.
-- NOWAIT refuses an occupied barrier; never terminate business sessions.
-- Preserve all readers, old/new attempts, proof files, costs and confirmed replay.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
lock table public.fiscal_documents in share row exclusive mode nowait;
do $guard$
declare gate oid:=to_regprocedure('public._delivery_attempt_activation_gate()');
begin
 if gate is null or to_regclass('public.delivery_attempts') is null
  or to_regclass('public.current_load_items') is null
  or to_regclass('public.active_delivery_document_outcomes') is null then
  raise exception 'redelivery_containment_schema_changed';end if;
 if md5(replace(pg_get_functiondef(to_regprocedure('public.request_document_redelivery(jsonb)')),E'\r\n',E'\n')) is distinct from 'c30924bdf6e0cea805d0b4b322fd938e'
  or not has_function_privilege('authenticated','public.request_document_redelivery(jsonb)','execute')
  or has_function_privilege('anon','public.request_document_redelivery(jsonb)','execute')
  or has_function_privilege('service_role','public.request_document_redelivery(jsonb)','execute') then
  raise exception 'redelivery_containment_writer_changed';end if;
 if not exists(select 1 from pg_proc where oid=gate and not prosecdef
  and md5(replace(prosrc,E'\r\n',E'\n'))='b9d78eeeb56ae8dc910ab8870b8aa39c')
  or has_function_privilege('anon',gate,'execute')
  or has_function_privilege('authenticated',gate,'execute')
  or has_function_privilege('service_role',gate,'execute') then
  raise exception 'redelivery_containment_gate_changed';end if;
 if (select count(*) from pg_trigger where tgfoid=gate)<>1 or not exists(
  select 1 from pg_trigger t where t.tgfoid=gate and t.tgrelid='public.fiscal_documents'::regclass
   and t.tgname='delivery_attempt_activation_gate' and t.tgenabled='O' and t.tgtype=23
   and not t.tgdeferrable and not t.tginitdeferred and t.tgnargs=0 and t.tgqual is null
   and t.tgattr::text=(select attnum::text from pg_attribute where attrelid=t.tgrelid
    and attname='current_delivery_attempt_id' and not attisdropped)) then
  raise exception 'redelivery_containment_trigger_changed';end if;
 if not (select relrowsecurity from pg_class where oid='public.delivery_attempts'::regclass)
  or has_table_privilege('authenticated','public.delivery_attempts','insert,update,delete')
  or has_table_privilege('anon','public.delivery_attempts','insert,update,delete') then
  raise exception 'redelivery_containment_acl_changed';end if;
end;
$guard$;
create or replace function public._delivery_attempt_activation_gate() returns trigger
language plpgsql security invoker set search_path='' as $fn$
begin
 if (tg_op='INSERT' and new.current_delivery_attempt_id is not null)
  or (tg_op='UPDATE' and new.current_delivery_attempt_id is distinct from old.current_delivery_attempt_id) then
  raise exception 'redelivery_temporarily_paused_preserve_request' using errcode='55000';
 end if;
 return new;
end;
$fn$;
commit;
-- No resume included: resume needs reviewed exact forward contract and retained request IDs.
-- This pauses creation of attempts, not operations already in their current attempt.
