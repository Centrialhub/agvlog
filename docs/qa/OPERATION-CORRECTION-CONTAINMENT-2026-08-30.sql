-- LOCAL containment rehearsal for the exact correction candidate, not a rollback.
-- Prerequisite: pause submissions AND drain in-flight requests. Replacing a
-- function does not cancel frames already executing. This script does not prove
-- traffic is drained and is not approved for unattended production execution.
-- Preserve all history, proof versions, financial records and pending requests.
begin;
set local lock_timeout='3s';set local statement_timeout='20s';
do $guard$
declare c record;target oid;
begin
 if to_regclass('public.current_delivery_document_outcomes') is null
  or not coalesce((select relrowsecurity from pg_class where oid=to_regclass('public.delivery_document_corrections')),false)
  or has_table_privilege('authenticated','public.delivery_document_corrections','insert,update,delete') then
  raise exception 'Correction containment refused: schema or table privileges changed';end if;
 for c in select * from(values
  ('public.record_operation_document_correction(jsonb)','be885bd42fe5a3a6b97840d97d571173',true,false),
  ('public.record_operation_document_outcome(jsonb)','bc9c55ae4aeea3a7fe53227ba34cbf30',true,false),
  ('public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text)','c3ce3d1b62954f5fc4d91567ad51f477',true,true),
  ('public._operation_document_context(uuid,uuid,uuid)','e6457abab0fc5bc8b663f7c097446153',false,false),
  ('public._derive_corrected_delivery_result(uuid,uuid,uuid)','bc1138378ce374615e7227b45bd22660',false,false),
  ('public._guard_recorded_delivery_document()','aa2546392b8791f9ad25e70152a70925',false,false),
  ('public._guard_delivery_correction_finance()','717bf9f2722540f8a4d5dab32613e954',false,false),
  ('public._validate_delivery_document_correction()','ca5c74edf98efaddc70883d3c0988d73',false,false)
 ) expected(signature,hash,authenticated_grant,service_grant) loop
  target:=to_regprocedure(c.signature);
  if target is null or md5(replace(pg_get_functiondef(target),E'\r\n',E'\n')) is distinct from c.hash
   or has_function_privilege('anon',target,'execute')
   or has_function_privilege('authenticated',target,'execute') is distinct from c.authenticated_grant
   or has_function_privilege('service_role',target,'execute') is distinct from c.service_grant then
   raise exception 'Correction containment refused: unexpected function or privileges %',c.signature;end if;
 end loop;
 for c in select * from(values
  ('guard_recorded_delivery_document','d38f84fa62faa6f2424ca4a9b4e96289'),
  ('guard_delivery_correction_payment','ea6d1596ede52869cdae25d6192f8547'),
  ('guard_delivery_correction_finalization','faf0115bc0a9d9adce7737d17a043089'),
  ('preserve_delivery_document_correction','ba986b7367f990e838785d2a96782e4a'),
  ('validate_delivery_document_correction','b666534932d72afbf91006a0fd17ce92')
 ) expected(name,hash) loop
  if (select count(*) from pg_trigger t join pg_class r on r.oid=t.tgrelid
    where t.tgname=c.name and r.relnamespace='public'::regnamespace and t.tgenabled='O'
     and md5(pg_get_triggerdef(t.oid))=c.hash)<>1 then
   raise exception 'Correction containment refused: integrity trigger changed %',c.name;end if;
 end loop;
end;
$guard$;
create or replace function public.record_operation_document_correction(_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
 raise exception 'Correções e baixas temporariamente suspensas para revisão. Preserve a solicitação e seus anexos para repetir depois.' using errcode='55000';
end;
$fn$;
create or replace function public.record_operation_document_outcome(_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
 raise exception 'Correções e baixas temporariamente suspensas para revisão. Preserve a solicitação e seus anexos para repetir depois.' using errcode='55000';
end;
$fn$;
create or replace function public.driver_record_delivery_outcome(
 _stop_id uuid,_outcome text,_details jsonb default '{}'::jsonb,
 _client_event_id uuid default null,_expected_status text default null)
returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
 raise exception 'Correções e baixas temporariamente suspensas para revisão. Preserve a solicitação e seus anexos para repetir depois.' using errcode='55000';
end;
$fn$;
commit;
-- Resume through a reviewed forward migration matching this correction-aware
-- contract. Never restore earlier writers, erase corrections/proofs, clear their
-- recovery queue or reset a delivered invoice to confirmed to force a rollback.
