-- The seven-argument v2 planner predates the recoverable route command and
-- still writes trips, loads and stops directly. Neither the current frontend
-- nor the currently published frontend calls this overload. Keep the v3 and
-- recoverable command APIs available, and remove only browser execution from
-- this exact legacy signature.

do $preflight$
declare
  target_oid oid := to_regprocedure(
    'public.plan_dispatch_trip_v2(uuid,uuid,uuid,text,uuid[],jsonb,text)'
  );
  replacement text;
  target_source_hash text;
  target_security_definer boolean;
  target_config text[];
begin
  if target_oid is null then
    raise exception 'Legacy dispatch planner ACL target is missing';
  end if;

  select md5(p.prosrc), p.prosecdef, p.proconfig
    into target_source_hash, target_security_definer, target_config
  from pg_proc p
  where p.oid = target_oid;

  if target_source_hash <> '14a016666f3beecff0b49e7b30b12632'
     or not target_security_definer
     or not ('search_path=public' = any(coalesce(target_config, array[]::text[]))) then
    raise exception 'Legacy dispatch planner changed before ACL closure';
  end if;

  if not has_function_privilege('authenticated', target_oid, 'EXECUTE')
     or has_function_privilege('anon', target_oid, 'EXECUTE')
     or not has_function_privilege('service_role', target_oid, 'EXECUTE') then
    raise exception 'Legacy dispatch planner ACL changed before closure';
  end if;

  foreach replacement in array array[
    'public.dispatch_planned_route(jsonb)',
    'public.plan_dispatch_trip_v3(uuid,text,uuid,uuid,text,uuid[],jsonb)'
  ] loop
    if to_regprocedure(replacement) is null
       or not has_function_privilege(
         'authenticated', to_regprocedure(replacement), 'EXECUTE'
       ) then
      raise exception 'Canonical dispatch planner is not ready: %', replacement;
    end if;
  end loop;

  if exists (
    select 1
    from pg_depend d
    where d.refclassid = 'pg_proc'::regclass
      and d.refobjid = target_oid
      and d.deptype in ('n', 'a')
      and d.classid in (
        'pg_policy'::regclass,
        'pg_rewrite'::regclass,
        'pg_trigger'::regclass
      )
  ) then
    raise exception 'Legacy dispatch planner gained a database dependency';
  end if;
end;
$preflight$;

revoke all privileges on function public.plan_dispatch_trip_v2(
  uuid, uuid, uuid, text, uuid[], jsonb, text
) from public, anon, authenticated;

comment on function public.plan_dispatch_trip_v2(
  uuid, uuid, uuid, text, uuid[], jsonb, text
) is 'Legacy dispatch planner; browser callers use dispatch_planned_route(jsonb).';

do $postflight$
declare
  target_oid oid := to_regprocedure(
    'public.plan_dispatch_trip_v2(uuid,uuid,uuid,text,uuid[],jsonb,text)'
  );
begin
  if has_function_privilege('authenticated', target_oid, 'EXECUTE')
     or has_function_privilege('anon', target_oid, 'EXECUTE')
     or not has_function_privilege('service_role', target_oid, 'EXECUTE') then
    raise exception 'Legacy dispatch planner ACL closure failed';
  end if;
end;
$postflight$;
