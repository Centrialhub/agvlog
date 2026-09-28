-- Forward from the captured pallet editor after 20260928183014's ordinality fix.
-- Keep the numeric sum so oversized input is rejected before any integer cast.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $restore_whole_pallet_guards$
declare
  function_oid oid := pg_catalog.to_regprocedure('public.edit_pallet_return_protocol_v1(jsonb)');
  prior pg_catalog.pg_proc%rowtype;
  original text := $old$  if v_items is not null and (jsonb_array_length(v_items)=0 or exists(select 1 from jsonb_to_recordset(v_items) as x(quantity numeric) where x.quantity<=0)) then raise exception 'invalid_items'; end if;$old$;
  corrected text := $new$  if v_items is not null and (
    jsonb_array_length(v_items)=0 or v_total>2147483647
    or exists(select 1 from jsonb_to_recordset(v_items) as x(quantity numeric)
      where x.quantity is null or x.quantity<=0 or x.quantity<>trunc(x.quantity) or x.quantity>2147483647)
  ) then raise exception 'invalid_items'; end if;$new$;
begin
  select * into prior from pg_catalog.pg_proc where oid=function_oid;
  if not found
    or prior.proowner <> 'postgres'::pg_catalog.regrole
    or prior.prolang <> (select oid from pg_catalog.pg_language where lanname='plpgsql')
    or prior.prokind <> 'f' or prior.proretset
    or prior.prorettype <> 'pg_catalog.jsonb'::pg_catalog.regtype
    or prior.prosecdef or prior.provolatile <> 'v'
    or prior.proargnames is distinct from array['_payload']::text[]
    or prior.proconfig is distinct from array['search_path=""','row_security=on']::text[]
    or pg_catalog.has_function_privilege('anon',function_oid,'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated',function_oid,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',function_oid,'EXECUTE') then
    raise exception 'pallet_edit_guard_contract_changed' using errcode='55000';
  end if;

  if pg_catalog.md5(prior.prosrc)='cdf923dd24f67eca3eaf54dba895f635' then return; end if;
  if pg_catalog.md5(prior.prosrc)<>'3ebef32c1309d3798e76a5b0e27fbc7a'
    or (length(prior.prosrc)-length(replace(prior.prosrc,original,'')))/length(original)<>1 then
    raise exception 'pallet_edit_guard_body_changed' using errcode='55000';
  end if;

  execute replace(pg_catalog.pg_get_functiondef(function_oid),original,corrected);
  if not exists (
    select 1 from pg_catalog.pg_proc p where p.oid=function_oid
      and pg_catalog.md5(p.prosrc)='cdf923dd24f67eca3eaf54dba895f635'
      and p.proowner=prior.proowner and p.proacl is not distinct from prior.proacl
      and p.proconfig is not distinct from prior.proconfig
      and p.prosecdef=prior.prosecdef and p.provolatile=prior.provolatile
  ) then raise exception 'pallet_edit_guard_postcondition_failed' using errcode='55000'; end if;
end;
$restore_whole_pallet_guards$;
