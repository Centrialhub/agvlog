-- Selected-company boundary for the five active closing entry points.
-- No source/snapshot/history rewriting. Existing NOWAIT locks are preserved.
set local lock_timeout='3s';set local statement_timeout='30s';
do $boundary$
declare spec record;routine record;definition text;guarded text;needle text:=$needle$ perform tenant_id from public.tenant_memberships where tenant_id=tenant and user_id=actor and active and role::text in('owner','admin','operator') for share nowait;$needle$;
begin
 if to_regprocedure('finance_private.require_access(uuid)') is null then raise exception 'finance_company_closing_dependency_missing';end if;
 for spec in select * from(values
 ('public.get_closing_report_sources(uuid,jsonb)','7637ce8fac30b44a155e6400aae427fb','s','_tenant_id','_tenant_id',false),
 ('public.get_closing_report_action_context(uuid,uuid)','b7bab0dc6bbd453a27ba422fcdedb3b8','v','_tenant_id','_tenant_id',false),
 ('public.update_closing_report_trip_fields(uuid,uuid,uuid,jsonb,jsonb)','34242cc5daa7e50afc8c9e048231e239','v','_tenant_id','_tenant_id',false),
 ('public.create_closing_report_draft(jsonb)','4031a2f667d72ceb32896e8d8d53511c','v','(_payload->>''tenant_id'')::uuid','_payload',true),
 ('public.apply_closing_report_action(jsonb)','e2ea265f739fa7ec5924fb609db1f645','v','(_payload->>''tenant_id'')::uuid','_payload',true)
 ) expected(signature,source_hash,volatility,expression,argument,reauth) loop
 select p.*,l.lanname into routine from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure(spec.signature);
 if not found then raise exception 'finance_company_closing_source_missing: %',spec.signature;end if;
 if routine.lanname<>'plpgsql' or not routine.prosecdef or routine.prokind<>'f'
   or md5(replace(routine.prosrc,E'\r\n',E'\n'))<>spec.source_hash
   or routine.proconfig is distinct from array['search_path=""']::text[]
   or has_function_privilege('anon',routine.oid,'execute')
   or has_function_privilege('service_role',routine.oid,'execute')
   or not has_function_privilege('authenticated',routine.oid,'execute')
   or exists(select 1 from aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) a
      where a.privilege_type='EXECUTE' and a.grantee not in(routine.proowner,(select oid from pg_roles where rolname='authenticated')))  or routine.provolatile::text<>spec.volatility
   or not coalesce(spec.argument=any(routine.proargnames),false)
   or (spec.reauth and position(needle in routine.prosrc)=0) then raise exception 'finance_company_closing_contract_changed: %',spec.signature;end if;
 definition:=pg_get_functiondef(routine.oid);guarded:=routine.prosrc;
 if spec.reauth then guarded:=replace(guarded,needle,E' PERFORM finance_private.require_access(tenant);\n'||needle);end if;
 guarded:=E'<<finance_company_closing_guard>>\nBEGIN\n PERFORM finance_private.require_access('||spec.expression||E');\n <<original_closing_entry>>\n'||guarded||E'\nEND;\n';
 execute replace(definition,routine.prosrc,guarded);
 end loop;
end;$boundary$;
