-- Browser-only invoice source selector. Its only production callers are
-- useClientInvoices; service_role has no EXECUTE grant. Keep the private
-- fiscal_source_is_billable proof and all service fiscal APIs unchanged.
set local lock_timeout='3s';set local statement_timeout='30s';
do $boundary$
declare spec record;routine record;definition text;guarded text;
begin
 if to_regprocedure('finance_private.require_access(uuid)') is null then raise exception 'finance_company_billable_dependency_missing';end if;
 for spec in select * from(values
 ('public.filter_billable_fiscal_sources(uuid,text,uuid[])','21efb0e075f8e5bd3259a33959984aec','s')
 ) expected(signature,source_hash,volatility) loop
 select p.*,l.lanname into routine from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec.signature);
 if not found then raise exception 'finance_company_billable_source_missing: %',spec.signature;end if;
 if routine.lanname<>'plpgsql' or not routine.prosecdef or routine.prokind<>'f'
   or md5(replace(routine.prosrc,E'\r\n',E'\n'))<>spec.source_hash
   or routine.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('anon',routine.oid,'execute')
   or has_function_privilege('service_role',routine.oid,'execute')
   or not has_function_privilege('authenticated',routine.oid,'execute')
   or exists(select 1 from aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) a
      where a.privilege_type='EXECUTE' and a.grantee not in(routine.proowner,(select oid from pg_roles where rolname='authenticated')))  or routine.provolatile::text<>spec.volatility
   or not coalesce('_tenant'=any(routine.proargnames),false) then raise exception 'finance_company_billable_contract_changed: %',spec.signature;end if;
 definition:=pg_get_functiondef(routine.oid);
 guarded:=E'<<finance_company_billable_guard>>\nBEGIN\n PERFORM finance_private.require_access(_tenant);\n <<original_financial_read>>\n'||routine.prosrc||E'\nEND;\n';
 execute replace(definition,routine.prosrc,guarded);
 end loop;
end;$boundary$;
