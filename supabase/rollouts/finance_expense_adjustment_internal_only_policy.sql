-- New restricted finance policy, distinct from the rejected release. No drivers, including mixed identities. Activation gate remains mandatory.
set local lock_timeout='3s';set local statement_timeout='30s';
do $guard$ begin
if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('expense_creation_private.require_session(uuid,uuid)') and replace(p.prosrc,E'\r\n',E'\n')=replace($expected$
declare v_role text;
begin
 if auth.uid() is null or _actor is distinct from auth.uid() then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 select role::text into v_role from public.tenant_memberships where tenant_id=_tenant and user_id=_actor and active;
 if v_role is null or v_role not in('owner','admin','operator','driver') then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 if v_role in('owner','admin') and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then
  raise exception 'expense_creation_mfa_required' using errcode='42501';end if;
end;$expected$,E'\r\n',E'\n') and p.prosecdef=false and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute') and has_function_privilege('authenticated',p.oid,'execute')=false) then raise exception 'password policy predecessor changed: expense_creation_private.require_session(uuid,uuid)';end if;
if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('expense_creation_private.session_allowed(uuid)') and replace(p.prosrc,E'\r\n',E'\n')=replace($expected$
 select auth.uid() is not null and exists(select 1 from public.tenant_memberships m
  where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role::text in('owner','admin','operator','driver')
  and (m.role::text not in('owner','admin') or coalesce(auth.jwt()->>'aal','aal1')='aal2'));
$expected$,E'\r\n',E'\n') and p.prosecdef=true and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute') and has_function_privilege('authenticated',p.oid,'execute')=true) then raise exception 'password policy predecessor changed: expense_creation_private.session_allowed(uuid)';end if;
if not exists(select 1 from pg_proc p where p.oid=to_regprocedure('settlement_adjustment_private.authorize(uuid)') and replace(p.prosrc,E'\r\n',E'\n')=replace($expected$
declare v_role text;
begin
 if auth.uid() is null then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;
 select role::text into v_role from public.tenant_memberships where tenant_id=_tenant and user_id=auth.uid() and active;
 if v_role is null or v_role not in('owner','admin','operator') then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;
 if v_role in('owner','admin') and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'settlement_adjustment_mfa_required' using errcode='42501';end if;
end;$expected$,E'\r\n',E'\n') and p.prosecdef=false and not has_function_privilege('anon',p.oid,'execute') and not has_function_privilege('service_role',p.oid,'execute') and has_function_privilege('authenticated',p.oid,'execute')=false) then raise exception 'password policy predecessor changed: settlement_adjustment_private.authorize(uuid)';end if;
end;$guard$;

do $boundary$ begin
 if to_regprocedure('finance_private.require_access(uuid)') is null or to_regprocedure('finance_private.not_driver(uuid)') is null then raise exception 'finance_boundary_required';end if;
end;$boundary$;
create or replace function expense_creation_private.require_session(_tenant uuid,_actor uuid) returns void
language plpgsql stable security invoker set search_path='' as $fn$
begin
 if auth.uid() is null or _actor is distinct from auth.uid() then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
 perform finance_private.require_access(_tenant);
 if not coalesce(finance_private.not_driver(_tenant),false) or not exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=_actor and m.active and m.role::text in('owner','admin','operator')) then raise exception 'expense_creation_not_authorized' using errcode='42501';end if;
end;$fn$;
create or replace function expense_creation_private.session_allowed(_tenant uuid) returns boolean
language sql stable security definer set search_path='' as $fn$
 select auth.uid() is not null and coalesce(finance_private.can_access(_tenant),false) and coalesce(finance_private.not_driver(_tenant),false)
 and exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role::text in('owner','admin','operator'));
$fn$;
create or replace function settlement_adjustment_private.authorize(_tenant uuid) returns void
language plpgsql stable security invoker set search_path='' as $fn$
begin
 perform finance_private.require_access(_tenant);
 if auth.uid() is null or not coalesce(finance_private.not_driver(_tenant),false) or not exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role::text in('owner','admin','operator')) then raise exception 'settlement_adjustment_not_authorized' using errcode='42501';end if;
end;$fn$;
