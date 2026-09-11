set local lock_timeout='3s';set local statement_timeout='30s';
do $boundary$
declare p record;d text;b text;needle text:='  select jsonb_build_object(''pending'',count(*) filter(where approval_status=''pending''),';
begin
 select * into p from pg_proc where oid=to_regprocedure('public.get_delivery_receipt_operations_v1(uuid)');
 if not found or md5(pg_get_functiondef(p.oid))<>'83b35198187c1282483614806ab2ffd7'
  or not p.prosecdef or p.proconfig is distinct from array['search_path=""']::text[]
  or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute')
  or not has_function_privilege('authenticated',p.oid,'execute')
  or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee not in(p.proowner,(select oid from pg_roles where rolname='authenticated')))
  or to_regprocedure('finance_private.can_access(uuid)') is null or position(needle in p.prosrc)=0 then raise exception 'delivery_operations_boundary_contract_changed';end if;
 d:=pg_get_functiondef(p.oid);
 b:=replace(p.prosrc,E'begin\n',E'begin\n  if auth.uid() is null or private.request_tenant_id() is distinct from _tenant_id or not private.is_request_tenant_member(_tenant_id) then raise exception ''delivery_receipt_operations_not_authorized'' using errcode=''42501'';end if;\n');
 b:=replace(b,needle,E'  if finance_private.can_access(_tenant_id) then\n'||needle);
 b:=replace(b,'    from public.driver_expenses where tenant_id=_tenant_id;',E'    from public.driver_expenses where tenant_id=_tenant_id;\n  else v_expenses:=null;end if;');
 execute replace(d,p.prosrc,b);
end;$boundary$;
