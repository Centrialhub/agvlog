-- Recovery rehearsal only. Restoring this policy REOPENS cross-tenant reads.
-- Prefer a forward correction; never execute as automatic recovery in production.
begin;
set local lock_timeout='3s';
set local statement_timeout='15s';
do $guard$
begin
  if (select count(*) from pg_policy where polrelid='public.idempotency_keys'::regclass)<>1
    or not exists(select 1 from pg_policy where polrelid='public.idempotency_keys'::regclass
      and polname='agvlog_select_authenticated' and polcmd='r' and polpermissive
      and polroles=array[(select oid from pg_roles where rolname='authenticated')]
      and polwithcheck is null
      and md5(replace(pg_get_expr(polqual,polrelid),E'\r\n',E'\n'))='a5e2fc2cb8bbeb71640ea0bc13d8b3a8') then
    raise exception 'Idempotency recovery refused: unknown policy';
  end if;
end;
$guard$;
alter policy agvlog_select_authenticated on public.idempotency_keys
to authenticated using (tenant_id = (select idempotency_keys.tenant_id
  from public.profiles where profiles.id = (select auth.uid())));
commit;
