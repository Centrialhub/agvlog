-- Staged cutover; deliberately outside supabase/migrations.
-- Execute only after the GPS frontend is published and an authenticated smoke
-- confirms that calls use the four-argument overload. The additive migration
-- keeps the legacy RPC available until this separately reviewed step.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

do $arrival_cutover_preflight$
declare
  v_legacy_oid oid := pg_catalog.to_regprocedure('public.driver_mark_arrival(uuid)');
  v_gps_oid oid := pg_catalog.to_regprocedure(
    'public.driver_mark_arrival(uuid,double precision,double precision,double precision)'
  );
  v_hash text;
begin
  if v_legacy_oid is null or v_gps_oid is null then
    raise exception 'Arrival cutover preflight failed: both overloads must exist';
  end if;

  select pg_catalog.md5(pg_catalog.replace(
    pg_catalog.pg_get_functiondef(v_legacy_oid), pg_catalog.chr(13), ''
  )) into v_hash;
  if v_hash <> '71506404e6bafbaeb3dc17a3e2530a1c' then
    raise exception 'Arrival cutover preflight failed: legacy RPC hash changed (%)', v_hash;
  end if;

  select pg_catalog.md5(pg_catalog.replace(
    pg_catalog.pg_get_functiondef(v_gps_oid), pg_catalog.chr(13), ''
  )) into v_hash;
  if v_hash <> '74a957d4c16ef52847b8c7c6859f5e20' then
    raise exception 'Arrival cutover preflight failed: GPS RPC hash changed (%)', v_hash;
  end if;

  if pg_catalog.has_function_privilege('anon', v_legacy_oid, 'execute')
    or not pg_catalog.has_function_privilege('authenticated', v_legacy_oid, 'execute')
    or not pg_catalog.has_function_privilege('service_role', v_legacy_oid, 'execute')
    or pg_catalog.has_function_privilege('anon', v_gps_oid, 'execute')
    or not pg_catalog.has_function_privilege('authenticated', v_gps_oid, 'execute')
    or pg_catalog.has_function_privilege('service_role', v_gps_oid, 'execute') then
    raise exception 'Arrival cutover preflight failed: overload ACL changed';
  end if;
end;
$arrival_cutover_preflight$;

revoke all privileges on function public.driver_mark_arrival(uuid)
  from public, anon, authenticated, service_role;
drop function public.driver_mark_arrival(uuid);

do $arrival_cutover_postcondition$
begin
  if pg_catalog.to_regprocedure('public.driver_mark_arrival(uuid)') is not null
    or pg_catalog.to_regprocedure(
      'public.driver_mark_arrival(uuid,double precision,double precision,double precision)'
    ) is null then
    raise exception 'Arrival cutover postcondition failed: unexpected overload set';
  end if;

  if pg_catalog.has_function_privilege(
      'anon',
      'public.driver_mark_arrival(uuid,double precision,double precision,double precision)',
      'execute'
    )
    or not pg_catalog.has_function_privilege(
      'authenticated',
      'public.driver_mark_arrival(uuid,double precision,double precision,double precision)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'service_role',
      'public.driver_mark_arrival(uuid,double precision,double precision,double precision)',
      'execute'
    ) then
    raise exception 'Arrival cutover postcondition failed: GPS RPC ACL changed';
  end if;
end;
$arrival_cutover_postcondition$;

-- Function DDL can leave a stale PostgREST signature cache. The notification is
-- delivered only if this transaction commits successfully.
notify pgrst, 'reload schema';

commit;
