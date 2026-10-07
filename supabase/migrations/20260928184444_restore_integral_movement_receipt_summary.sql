-- Restore the receipt-summary contract expected by the candidate financial UI.
-- Source is the immutable full closing snapshot, independent of either offset.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $restore_integral_receipt_summary$
declare
  function_oid oid := pg_catalog.to_regprocedure('public.get_finance_account_period_evidence_page(uuid,uuid,uuid,integer,integer,integer)');
  prior pg_catalog.pg_proc%rowtype;
  original text := $old$'movement_page',jsonb_build_object('offset',_movement_offset,'limit',page_limit,'total',movement_total),$old$;
  corrected text := $new$'movement_page',jsonb_build_object('offset',_movement_offset,'limit',page_limit,'total',movement_total),
  'movement_receipt_summary',jsonb_build_object(
    'identified',(select count(*) from jsonb_array_elements(
      case when jsonb_typeof(c.snapshot#>'{facts,movements}')='array' then c.snapshot#>'{facts,movements}' else '[]'::jsonb end
    ) movement where nullif(btrim(movement->>'receipt_path'),'') is not null),
    'missing',(select count(*) from jsonb_array_elements(
      case when jsonb_typeof(c.snapshot#>'{facts,movements}')='array' then c.snapshot#>'{facts,movements}' else '[]'::jsonb end
    ) movement where nullif(btrim(movement->>'receipt_path'),'') is null)
  ),$new$;
begin
  select * into prior from pg_catalog.pg_proc where oid=function_oid;
  if not found
    or prior.proowner <> 'postgres'::pg_catalog.regrole
    or prior.prolang <> (select oid from pg_catalog.pg_language where lanname='plpgsql')
    or prior.prokind <> 'f' or prior.proretset
    or prior.prorettype <> 'pg_catalog.jsonb'::pg_catalog.regtype
    or not prior.prosecdef or prior.provolatile <> 's'
    or prior.proargnames is distinct from array['_tenant_id','_account_id','_closure_id','_movement_offset','_dependency_offset','_limit']::text[]
    or prior.proconfig is distinct from array['search_path=""']::text[]
    or pg_catalog.has_function_privilege('anon',function_oid,'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated',function_oid,'EXECUTE')
    or pg_catalog.has_function_privilege('service_role',function_oid,'EXECUTE') then
    raise exception 'integral_receipt_summary_contract_changed' using errcode='55000';
  end if;

  if pg_catalog.md5(prior.prosrc)='b7813ece7683cc665e258708f726b11e' then return; end if;
  if pg_catalog.md5(prior.prosrc)<>'61ed436684c87fc1ed2ebbf64f1a24ca'
    or (length(prior.prosrc)-length(replace(prior.prosrc,original,'')))/length(original)<>1 then
    raise exception 'integral_receipt_summary_body_changed' using errcode='55000';
  end if;

  execute replace(pg_catalog.pg_get_functiondef(function_oid),original,corrected);
  if not exists (
    select 1 from pg_catalog.pg_proc p where p.oid=function_oid
      and pg_catalog.md5(p.prosrc)='b7813ece7683cc665e258708f726b11e'
      and p.proowner=prior.proowner and p.proacl is not distinct from prior.proacl
      and p.proconfig is not distinct from prior.proconfig
      and p.prosecdef=prior.prosecdef and p.provolatile=prior.provolatile
  ) then raise exception 'integral_receipt_summary_postcondition_failed' using errcode='55000'; end if;
end;
$restore_integral_receipt_summary$;
