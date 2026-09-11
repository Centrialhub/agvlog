-- Current MAINDB contract observed by SELECT; no data rewrite or new payment path.
set local lock_timeout='3s';
set local statement_timeout='30s';
do $boundary$
declare p record;d text;b text;
begin
 select * into p from pg_proc where oid=to_regprocedure('public.register_employee_advance(uuid,uuid,numeric,date,text,text,text,boolean,boolean)');
 if not found or md5(pg_get_functiondef(p.oid))<>'49e5731a3bce8b1b44c6e59dd494c629'
  or not p.prosecdef or p.proconfig is distinct from array['search_path=public']::text[]
  or has_function_privilege('anon',p.oid,'execute') or not has_function_privilege('authenticated',p.oid,'execute')
  or not has_function_privilege('service_role',p.oid,'execute')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner,(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role')))
  or to_regprocedure('finance_private.require_access(uuid)') is null then raise exception 'finance_advance_boundary_contract_changed';end if;
 d:=pg_get_functiondef(p.oid);
 b:=replace(p.prosrc,E'BEGIN\n',E'BEGIN\n  PERFORM finance_private.require_access(_tenant_id);\n  IF coalesce(_mark_paid,false) THEN RAISE EXCEPTION ''finance_advance_payment_requires_command'' USING ERRCODE=''55000''; END IF;\n  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text||'':finance'',0));\n  PERFORM finance_private.require_access(_tenant_id);\n  PERFORM 1 FROM public.tenant_memberships WHERE tenant_id=_tenant_id AND user_id=_user AND active AND role::text IN(''owner'',''admin'',''operator'') FOR SHARE NOWAIT;\n');
 if b=p.prosrc then raise exception 'finance_advance_boundary_anchor_missing';end if;
 b:=replace(b,'  RETURN _advance_id;',E'  PERFORM finance_private.require_access(_tenant_id);\n  RETURN _advance_id;');
 execute replace(d,p.prosrc,b);
end;$boundary$;
