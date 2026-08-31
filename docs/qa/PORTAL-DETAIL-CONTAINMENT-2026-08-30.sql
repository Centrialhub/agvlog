-- Emergency containment, NOT a rollback to the vulnerable implementation.
-- Locally authored from the candidate contract. No production definitions/data export.
-- Only these two read endpoints become temporarily unavailable. No row is changed.
begin;
set local lock_timeout='3s';set local statement_timeout='20s';
do $guard$
declare c record;target oid;
begin
 for c in select * from(values
  ('public.get_client_portal_shipment_detail(uuid)','600316cd5ffc139d090bad7da3a7ebc1'),
  ('public.get_client_portal_shipment_detail_v2(uuid)','7411ddff12475ee87930b317353db426')
 ) expected(signature,hash) loop
  target:=to_regprocedure(c.signature);
  if md5(replace(pg_get_functiondef(target),E'\r\n',E'\n')) is distinct from c.hash
    or has_function_privilege('anon',target,'execute')
    or not has_function_privilege('authenticated',target,'execute')
    or not has_function_privilege('service_role',target,'execute') then
   raise exception 'Portal containment refused: unexpected function or privileges %',c.signature;end if;
 end loop;
end;
$guard$;
create or replace function public.get_client_portal_shipment_detail(_fiscal_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
begin
 raise exception 'Consulta de entrega temporariamente indisponível. Tente novamente mais tarde.' using errcode='55000';
end;
$fn$;
create or replace function public.get_client_portal_shipment_detail_v2(_fiscal_document_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $fn$
begin
 raise exception 'Consulta de entrega temporariamente indisponível. Tente novamente mais tarde.' using errcode='55000';
end;
$fn$;
commit;
-- Functional restoration requires a reviewed forward migration matching the
-- contained hashes. Do not bypass the original deployment preflight in production.
