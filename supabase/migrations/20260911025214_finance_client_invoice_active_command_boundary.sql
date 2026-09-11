-- Keep the audited invoice command, with company/driver checks before work
-- and after the only blocking advisory wait, before replay. No data changes.
set local lock_timeout='3s';set local statement_timeout='30s';
do $boundary$
declare spec record;routine record;definition text;guarded text;needle text:=$needle$ perform tenant_id from public.tenant_memberships where tenant_id=v_tenant and user_id=v_actor and active and role::text in('owner','admin','operator') for share nowait;$needle$;
begin
 if to_regprocedure('finance_private.require_access(uuid)') is null then raise exception 'finance_company_invoice_dependency_missing';end if;
 select 'e595e84d17106576d9cbdb11316697fa'::text source_hash into spec;
 select p.*,l.lanname into routine from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('public.apply_client_invoice_command(jsonb)');
 if not found then raise exception 'finance_company_invoice_source_missing';end if;
 if routine.lanname<>'plpgsql' or not routine.prosecdef or routine.prokind<>'f'
   or md5(replace(routine.prosrc,E'\r\n',E'\n'))<>spec.source_hash
   or routine.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('anon',routine.oid,'execute')
   or has_function_privilege('service_role',routine.oid,'execute')
   or not has_function_privilege('authenticated',routine.oid,'execute')
   or exists(select 1 from aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) a
      where a.privilege_type='EXECUTE' and a.grantee not in(routine.proowner,(select oid from pg_roles where rolname='authenticated')))  or routine.provolatile<>'v'
  or not coalesce('_payload'=any(routine.proargnames),false) or position(needle in routine.prosrc)=0 then raise exception 'finance_company_invoice_contract_changed';end if;
 definition:=pg_get_functiondef(routine.oid);
 guarded:=replace(routine.prosrc,needle,E' PERFORM finance_private.require_access(v_tenant);\n'||needle);
 guarded:=E'<<finance_company_invoice_guard>>\nBEGIN\n PERFORM finance_private.require_access((_payload->>''tenant_id'')::uuid);\n <<original_invoice_command>>\n'||guarded||E'\nEND;\n';
 execute replace(definition,routine.prosrc,guarded);
end;$boundary$;
