-- Close both audited-review read entry points under the canonical finance gate.
-- Preserve bodies, signatures, defaults, OIDs and ACLs; no data changes.
set local lock_timeout='3s';set local statement_timeout='30s';
do $boundary$
declare spec record;routine record;definition text;guarded text;
begin
 if to_regprocedure('finance_private.require_access(uuid)') is null then
  raise exception 'finance_expense_review_boundary_dependency_missing';end if;
 for spec in select * from(values
 ('public.get_driver_expense_review_context(uuid,uuid)','566f7444a124de75659aacabf9726079'),
 ('public.list_driver_expenses_for_review(uuid,text,integer)','59235030ccbb8a5b3a6a5b7e3e9c5b23')
 ) expected(signature,source_hash) loop
  select p.*,l.lanname into routine from pg_proc p join pg_language l on l.oid=p.prolang
   where p.oid=to_regprocedure(spec.signature);
  if not found then raise exception 'finance_expense_review_boundary_source_missing: %',spec.signature;end if;
  if routine.lanname<>'plpgsql' or not routine.prosecdef or routine.provolatile<>'s'
   or routine.prokind<>'f' or not coalesce('_tenant_id'=any(routine.proargnames),false)
   or md5(replace(routine.prosrc,E'\r\n',E'\n'))<>spec.source_hash
   or has_function_privilege('anon',routine.oid,'execute')
   or has_function_privilege('service_role',routine.oid,'execute')
   or not has_function_privilege('authenticated',routine.oid,'execute') then
   raise exception 'finance_expense_review_boundary_contract_changed: %',spec.signature;end if;
  definition:=pg_get_functiondef(routine.oid);
  guarded:=E'<<finance_review_read_guard>>\nBEGIN\n PERFORM finance_private.require_access(_tenant_id);\n <<original_review_read>>\n'
   ||routine.prosrc||E'\nEND;\n';
  execute replace(definition,routine.prosrc,guarded);
 end loop;
end;$boundary$;
