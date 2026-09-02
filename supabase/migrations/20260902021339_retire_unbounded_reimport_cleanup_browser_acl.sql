-- The one-argument overload deletes every import-related row for a tenant.
-- The reimport UI (current and published) uses the bounded three-argument
-- overload after previewing the same date range. Keep the unbounded routine
-- available only to service_role for backend recovery compatibility.

set lock_timeout = '3s';

do $preflight$
declare
  target_oid oid := pg_catalog.to_regprocedure(
    'public.clear_reimport_batch_data(uuid)'
  );
  bounded_oid oid := pg_catalog.to_regprocedure(
    'public.clear_reimport_batch_data(uuid,date,date)'
  );
  preview_oid oid := pg_catalog.to_regprocedure(
    'public.preview_reimport_cleanup_counts(uuid,date,date)'
  );
  target_source_hash text;
  target_is_definer boolean;
  target_config text[];
  target_owner text;
  target_language text;
begin
  if target_oid is null then
    raise exception 'Unbounded reimport cleanup ACL target is missing';
  end if;

  select
    pg_catalog.md5(pg_catalog.replace(p.prosrc, E'\r\n', E'\n')),
    p.prosecdef,
    p.proconfig,
    pg_catalog.pg_get_userbyid(p.proowner),
    l.lanname
  into
    target_source_hash,
    target_is_definer,
    target_config,
    target_owner,
    target_language
  from pg_catalog.pg_proc p
  join pg_catalog.pg_language l on l.oid = p.prolang
  where p.oid = target_oid;

  if target_source_hash <> '8d0b04f70eb6f935e4faff7f871242b8'
     or not target_is_definer
     or target_config is distinct from array['search_path=public']::text[]
     or target_owner <> 'postgres'
     or target_language <> 'plpgsql' then
    raise exception 'Unbounded reimport cleanup changed before ACL closure';
  end if;

  if not pg_catalog.has_function_privilege(
       'authenticated', target_oid, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', target_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege(
       'service_role', target_oid, 'EXECUTE'
     )
     or exists (
       select 1
       from pg_catalog.aclexplode(
         coalesce(
           (select p.proacl from pg_catalog.pg_proc p where p.oid = target_oid),
           pg_catalog.acldefault('f', (
             select p.proowner from pg_catalog.pg_proc p where p.oid = target_oid
           ))
         )
       ) acl
       where acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'Unbounded reimport cleanup ACL changed before closure';
  end if;

  if bounded_oid is null
     or preview_oid is null then
    raise exception 'Bounded reimport cleanup contract is incomplete';
  end if;

  if exists (
    select 1
    from (
      values
        (bounded_oid, '1e0fc420e4d27711f296c4031e33307e'::text),
        (preview_oid, '46c3bf0e7b28d3bcf75c4711ae24b187'::text)
    ) replacement(oid, expected_hash)
    join pg_catalog.pg_proc p on p.oid = replacement.oid
    join pg_catalog.pg_language l on l.oid = p.prolang
    where pg_catalog.md5(
            pg_catalog.replace(p.prosrc, E'\r\n', E'\n')
          ) <> replacement.expected_hash
       or not p.prosecdef
       or p.proconfig is distinct from array['search_path=public']::text[]
       or pg_catalog.pg_get_userbyid(p.proowner) <> 'postgres'
       or l.lanname <> 'plpgsql'
       or not pg_catalog.has_function_privilege(
         'authenticated', replacement.oid, 'EXECUTE'
       )
       or pg_catalog.has_function_privilege(
         'anon', replacement.oid, 'EXECUTE'
       )
       or not pg_catalog.has_function_privilege(
         'service_role', replacement.oid, 'EXECUTE'
       )
  ) then
    raise exception 'Bounded reimport cleanup contract changed before cutover';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_depend d
    where d.refclassid = 'pg_catalog.pg_proc'::regclass
      and d.refobjid = target_oid
      and d.deptype in ('n', 'a')
      and d.classid in (
        'pg_catalog.pg_policy'::regclass,
        'pg_catalog.pg_rewrite'::regclass,
        'pg_catalog.pg_trigger'::regclass
      )
  )
  or exists (
    select 1
    from pg_catalog.pg_trigger t
    where t.tgfoid = target_oid
      and not t.tgisinternal
  )
  or exists (
    select 1
    from pg_catalog.pg_policy policy
    where coalesce(
      pg_catalog.pg_get_expr(policy.polqual, policy.polrelid), ''
    ) ~* 'clear_reimport_batch_data[[:space:]]*\('
       or coalesce(
         pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid), ''
       ) ~* 'clear_reimport_batch_data[[:space:]]*\('
  )
  or exists (
    select 1
    from pg_catalog.pg_rewrite rewrite
    join pg_catalog.pg_class relation on relation.oid = rewrite.ev_class
    where relation.relkind in ('v', 'm')
      and pg_catalog.pg_get_viewdef(rewrite.ev_class, true)
          ~* 'clear_reimport_batch_data[[:space:]]*\('
  )
  or exists (
    select 1
    from pg_catalog.pg_proc caller
    join pg_catalog.pg_namespace namespace
      on namespace.oid = caller.pronamespace
    where namespace.nspname in ('public', 'private')
      and caller.oid <> target_oid
      and caller.prosrc ~* 'clear_reimport_batch_data[[:space:]]*\('
  ) then
    raise exception 'Unbounded reimport cleanup gained a database caller';
  end if;
end;
$preflight$;

revoke all privileges on function public.clear_reimport_batch_data(uuid)
  from public, anon, authenticated;

comment on function public.clear_reimport_batch_data(uuid) is
  'Backend-only unbounded recovery cleanup. Browser reimports must preview and use clear_reimport_batch_data(uuid,date,date).';

do $postflight$
declare
  target_oid oid := pg_catalog.to_regprocedure(
    'public.clear_reimport_batch_data(uuid)'
  );
begin
  if target_oid is null
     or pg_catalog.has_function_privilege(
       'authenticated', target_oid, 'EXECUTE'
     )
     or pg_catalog.has_function_privilege('anon', target_oid, 'EXECUTE')
     or not pg_catalog.has_function_privilege(
       'service_role', target_oid, 'EXECUTE'
     ) then
    raise exception 'Unbounded reimport cleanup ACL closure failed';
  end if;
end;
$postflight$;
