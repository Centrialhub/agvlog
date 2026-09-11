-- Enforce the selected company on legacy financial readers. No data changes.
set local lock_timeout='3s';set local statement_timeout='30s';
do $boundary$
declare spec record;routine record;definition text;guarded text;
begin
 if to_regprocedure('finance_private.require_access(uuid)') is null then raise exception 'finance_company_read_dependency_missing';end if;
 for spec in select * from(values
 ('public.get_receivable_financial_context(uuid,uuid)','f6389c519485384369e8d91b4a73666d','s'),
 ('public.get_client_invoice_action_context(uuid,uuid)','423d10ff4ae7d4ec9e01a3bfef72be34','s'),
 ('public.list_client_invoice_financials(uuid)','e770480bd5c6d2bac4ff678d5cd8f236','s'),
 ('public.get_client_invoice_creation_context(uuid,uuid,jsonb)','1696c8eca8b4fb8dbeafb0d05832afbb','v')
 ) expected(signature,source_hash,volatility) loop
 select p.*,l.lanname into routine from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec.signature);
 if not found then raise exception 'finance_company_read_source_missing: %',spec.signature;end if;
 if routine.lanname<>'plpgsql' or not routine.prosecdef or routine.prokind<>'f'
   or md5(replace(routine.prosrc,E'\r\n',E'\n'))<>spec.source_hash
   or routine.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('anon',routine.oid,'execute')
   or has_function_privilege('service_role',routine.oid,'execute')
   or not has_function_privilege('authenticated',routine.oid,'execute')
   or exists(select 1 from aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) a
      where a.privilege_type='EXECUTE' and a.grantee not in(routine.proowner,(select oid from pg_roles where rolname='authenticated')))  or routine.provolatile::text<>spec.volatility
   or not coalesce('_tenant_id'=any(routine.proargnames),false) then raise exception 'finance_company_read_contract_changed: %',spec.signature;end if;
 definition:=pg_get_functiondef(routine.oid);
 guarded:=E'<<finance_company_read_guard>>\nBEGIN\n PERFORM finance_private.require_access(_tenant_id);\n <<original_financial_read>>\n'||routine.prosrc||E'\nEND;\n';
 execute replace(definition,routine.prosrc,guarded);
 end loop;
end;$boundary$;
