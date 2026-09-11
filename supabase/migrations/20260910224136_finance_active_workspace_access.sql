-- Fresh-install hardening only. A production staged false gate stays false.
set local lock_timeout='3s';
set local statement_timeout='30s';
do $harden$
declare body text; expected text; definition text;
begin
 if to_regprocedure('private.is_request_tenant_member(uuid)') is null then
  raise exception 'finance_workspace_dependency_missing';
 end if;
 select p.prosrc into body from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='finance_private' and p.proname='can_access' and p.proargtypes='2950'::oidvector
 and p.prorettype='boolean'::regtype and p.prosecdef and p.provolatile='s';
 if body is null then raise exception 'finance_access_contract_changed';end if;
 if regexp_replace(lower(body),'\s','','g')='selectfalse;' then
  raise notice 'Finance remains staged closed. Final activation must use the workspace-aware definition.';
  return;
 end if;
 expected:=$original$
 select auth.uid() is not null
 and exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant
   and m.user_id=auth.uid() and m.active and m.role::text in ('owner','admin','operator'))
 and not exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant
   and m.user_id=auth.uid() and m.active and m.role::text='driver')
 and not exists(select 1 from public.drivers d where d.tenant_id=_tenant
   and d.user_id=auth.uid() and d.active);
$original$;
 if regexp_replace(body,'\s','','g')<>regexp_replace(expected,'\s','','g') or position('select auth.uid() is not null' in body)=0 then
  raise exception 'finance_access_contract_changed';
 end if;
 select pg_get_functiondef('finance_private.can_access(uuid)'::regprocedure) into definition;
 execute replace(definition,body,replace(body,'select auth.uid() is not null',
  'select auth.uid() is not null and nullif(auth.jwt()->>''active_tenant_id'','''') is not null and private.is_request_tenant_member(_tenant)'));
end;
$harden$;
