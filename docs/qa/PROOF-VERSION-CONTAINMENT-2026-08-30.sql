-- LOCAL emergency containment for this exact candidate, not a production rollback.
-- Pause new submissions and drain in-flight requests before using this script.
-- Already executing PostgreSQL function frames are not cancelled by replacement.
-- Historical/current evidence and version-aware reads remain unchanged.
begin;
set local lock_timeout='3s';set local statement_timeout='20s';
do $guard$
declare c record;target oid;
begin
 if to_regclass('public.current_delivery_proofs') is null
  or not exists(select 1 from pg_attribute where attrelid='public.proof_of_delivery'::regclass
   and attname='retired_event_id' and not attisdropped) then
  raise exception 'Proof containment refused: versioning schema absent';end if;
 for c in select * from(values
  ('public.record_operation_document_outcome(jsonb)','e2dc86f29af6f7829052887cf83eea01',false),
  ('public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)','99890a58fb8a6fc9cf0fb025c77f5a85',true)
 ) expected(signature,hash,service_grant) loop
  target:=to_regprocedure(c.signature);
  if md5(replace(pg_get_functiondef(target),E'\r\n',E'\n')) is distinct from c.hash
   or has_function_privilege('anon',target,'execute')
   or not has_function_privilege('authenticated',target,'execute')
   or has_function_privilege('service_role',target,'execute') is distinct from c.service_grant then
   raise exception 'Proof containment refused: unexpected writer or privileges %',c.signature;end if;
 end loop;
end;
$guard$;
create or replace function public.record_operation_document_outcome(_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
 raise exception 'Baixas temporariamente suspensas para revisão. Preserve a solicitação e seus anexos para repetir depois.' using errcode='55000';
end;
$fn$;
create or replace function public.driver_record_delivery_outcome(
 _stop_id uuid,_outcome text,_details jsonb default '{}'::jsonb,
 _client_event_id uuid default null,_expected_status text default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
 raise exception 'Baixas temporariamente suspensas para revisão. Preserve a solicitação e seus anexos para repetir depois.' using errcode='55000';
end;
$fn$;
commit;
-- Never restore the global UNIQUE(fiscal_document_id), remove historical rows,
-- or restore old readers to make rollback succeed. Resume with a reviewed forward
-- migration and reconcile pending requests by their original idempotency keys.
