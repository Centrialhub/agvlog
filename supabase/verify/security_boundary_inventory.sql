-- Read-only security inventory for a restored branch, staging, or production.
-- It does not silence advisors and does not mutate ACLs. Review every returned
-- authenticated SECURITY DEFINER row before adding it to an API allowlist.

begin transaction read only;

do $security_boundary_contract$
declare
  violation_count integer;
  tenant_provisioner regprocedure;
begin
  tenant_provisioner := to_regprocedure(
    'public.create_tenant_with_owner(text)'
  );
  if tenant_provisioner is null then
    raise exception 'Security boundary failed: tenant provisioner is missing';
  end if;

  select count(*)
    into violation_count
  from unnest(array['anon', 'authenticated', 'service_role']) role_name
  where has_function_privilege(
    role_name,
    tenant_provisioner,
    'EXECUTE'
  );
  if violation_count <> 0 then
    raise exception
      'Security boundary failed: create_tenant_with_owner is executable by % Data API roles',
      violation_count;
  end if;

  select count(*)
    into violation_count
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.prosecdef
    and has_function_privilege('anon', procedure.oid, 'EXECUTE');
  if violation_count <> 0 then
    raise exception
      'Security boundary failed: anon can execute % public SECURITY DEFINER functions',
      violation_count;
  end if;

  select count(*)
    into violation_count
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname in ('public', 'private')
    and procedure.prosecdef
    and not exists (
      select 1
      from unnest(coalesce(procedure.proconfig, array[]::text[])) setting
      where setting like 'search_path=%'
    );
  if violation_count <> 0 then
    raise exception
      'Security boundary failed: % application SECURITY DEFINER functions lack a fixed search_path',
      violation_count;
  end if;

  select count(*)
    into violation_count
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.prosecdef
    and procedure.prorettype = 'pg_catalog.trigger'::regtype
    and has_function_privilege('authenticated', procedure.oid, 'EXECUTE');
  if violation_count <> 0 then
    raise exception
      'Security boundary failed: authenticated can directly execute % trigger functions',
      violation_count;
  end if;

  with backend_only(table_name) as (
    values
      ('application_error_events'),
      ('application_web_vitals'),
      ('secure_upload_rate_events')
  ), relations as (
    select expected.table_name, relation.oid, relation.relrowsecurity
    from backend_only expected
    left join pg_namespace namespace on namespace.nspname = 'public'
    left join pg_class relation
      on relation.relnamespace = namespace.oid
     and relation.relname = expected.table_name
     and relation.relkind in ('r', 'p')
  )
  select count(*)
    into violation_count
  from relations relation
  where relation.oid is null
     or not relation.relrowsecurity
     or exists (
       select 1 from pg_policy policy where policy.polrelid = relation.oid
     )
     or has_table_privilege(
       'anon', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
     )
     or has_table_privilege(
       'authenticated', relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE'
     )
     or has_any_column_privilege(
       'anon', relation.oid, 'SELECT,INSERT,UPDATE'
     )
     or has_any_column_privilege(
       'authenticated', relation.oid, 'SELECT,INSERT,UPDATE'
     )
     or not has_table_privilege('service_role', relation.oid, 'SELECT')
     or not has_table_privilege('service_role', relation.oid, 'INSERT')
     or not has_table_privilege('service_role', relation.oid, 'DELETE')
     or has_table_privilege('service_role', relation.oid, 'UPDATE,TRUNCATE');
  if violation_count <> 0 then
    raise exception
      'Security boundary failed: % backend-only RLS tables have an unexpected policy or ACL',
      violation_count;
  end if;
end;
$security_boundary_contract$;

-- Full function-level inventory. The hash makes review/approval specific to a
-- body version; a name alone is never treated as sufficient authorization.
select
  procedure.oid::regprocedure::text as signature,
  pg_get_userbyid(procedure.proowner) as owner_name,
  language.lanname as language_name,
  md5(replace(pg_get_functiondef(procedure.oid), E'\r\n', E'\n')) as definition_md5,
  procedure.prosecdef as security_definer,
  has_function_privilege('anon', procedure.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', procedure.oid, 'EXECUTE') as service_role_execute,
  coalesce(procedure.proconfig, array[]::text[]) as runtime_settings,
  coalesce(obj_description(procedure.oid, 'pg_proc'), '') as function_comment,
  exists (
    select 1
    from pg_trigger trigger_row
    where trigger_row.tgfoid = procedure.oid
      and not trigger_row.tgisinternal
  ) as used_by_trigger,
  (
    select count(*)::integer
    from pg_policy policy
    where coalesce(pg_get_expr(policy.polqual, policy.polrelid), '')
          like '%'
            || quote_ident(procedure.proname)
            || '(%'
       or coalesce(pg_get_expr(policy.polwithcheck, policy.polrelid), '')
          like '%'
            || quote_ident(procedure.proname)
            || '(%'
  ) as policy_text_references,
  (
    select coalesce(
      array_agg(caller.oid::regprocedure::text order by caller.oid::regprocedure::text),
      array[]::text[]
    )
    from pg_proc caller
    join pg_namespace caller_namespace
      on caller_namespace.oid = caller.pronamespace
    where caller_namespace.nspname in ('public', 'private')
      and caller.oid <> procedure.oid
      and caller.prosrc ~* (
        procedure.proname || '[[:space:]]*\('
      )
  ) as sql_body_callers,
  (
    select count(*)::integer
    from pg_views view_row
    where view_row.definition ~* (
      procedure.proname || '[[:space:]]*\('
    )
  ) as view_text_references,
  pg_get_functiondef(procedure.oid) ~* (
    'auth\.uid\(|tenant_memberships|client_portal_access|'
    || 'is_tenant_|has_tenant_role|current_driver_id'
  ) as guard_signal_detected,
  case
    when not has_function_privilege(
      'authenticated', procedure.oid, 'EXECUTE'
    ) then 'backend_or_internal_not_browser_executable'
    when procedure.prorettype = 'pg_catalog.trigger'::regtype
      then 'deny_authenticated_trigger'
    when procedure.proname like '\_%' escape '\'
      then 'review_internal_helper'
    when pg_get_functiondef(procedure.oid) ~* (
      'auth\.uid\(|tenant_memberships|client_portal_access|'
      || 'is_tenant_|has_tenant_role|current_driver_id'
    ) then 'review_api_with_guard_signal'
    else 'review_api_without_detected_guard'
  end as review_bucket,
  coalesce(procedure.proacl::text, '<default>') as acl
from pg_proc procedure
join pg_namespace namespace on namespace.oid = procedure.pronamespace
join pg_language language on language.oid = procedure.prolang
where namespace.nspname in ('public', 'private')
  and procedure.prosecdef
order by authenticated_execute desc, review_bucket, signature;

-- The three no-policy relations are intentionally backend-only. Returning the
-- matrix makes a post-deploy evidence record possible without exposing rows.
select
  relation.relname as table_name,
  relation.relrowsecurity as rls_enabled,
  (select count(*) from pg_policy policy where policy.polrelid = relation.oid)
    as policy_count,
  role_name,
  has_table_privilege(role_name, relation.oid, 'SELECT') as can_select,
  has_table_privilege(role_name, relation.oid, 'INSERT') as can_insert,
  has_table_privilege(role_name, relation.oid, 'UPDATE') as can_update,
  has_table_privilege(role_name, relation.oid, 'DELETE') as can_delete,
  has_table_privilege(role_name, relation.oid, 'TRUNCATE') as can_truncate
from pg_class relation
join pg_namespace namespace on namespace.oid = relation.relnamespace
cross join unnest(array['anon', 'authenticated', 'service_role']) role_name
where namespace.nspname = 'public'
  and relation.relname in (
    'application_error_events',
    'application_web_vitals',
    'secure_upload_rate_events'
  )
order by relation.relname, role_name;

commit;
