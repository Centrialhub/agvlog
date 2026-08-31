-- Fix the correlated legacy policy that compared a row's tenant to itself.
-- Only active operators/admins of that tenant can inspect idempotency results.
-- No data, grants or RPC bodies are changed by this migration.
set local lock_timeout='3s';
set local statement_timeout='15s';
do $preflight$
begin
  if not exists(select 1 from pg_class where oid='public.idempotency_keys'::regclass
    and relrowsecurity and not relforcerowsecurity) then
    raise exception 'Idempotency RLS contract changed';
  end if;
  if (select count(*) from pg_policy where polrelid='public.idempotency_keys'::regclass)<>1
    or not exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass
      and polname='agvlog_select_authenticated' and polcmd='r' and polpermissive
      and polroles=array[(select oid from pg_roles where rolname='authenticated')]
      and polwithcheck is null
      and md5(replace(pg_get_expr(polqual,polrelid),E'\r\n',E'\n'))='52dcb2b8b590a76089a38b21cebaf9c7') then
    raise exception 'Idempotency legacy policy changed';
  end if;
  if md5(replace(pg_get_functiondef(to_regprocedure('public.is_tenant_operator_or_admin(uuid)')),E'\r\n',E'\n'))
    is distinct from '682f66029dc9bb798f9f329b4e8f95aa' then
    raise exception 'Idempotency membership helper changed';
  end if;
end;
$preflight$;
alter policy agvlog_select_authenticated on public.idempotency_keys
to authenticated using ((select auth.uid()) is not null and public.is_tenant_operator_or_admin(tenant_id));
