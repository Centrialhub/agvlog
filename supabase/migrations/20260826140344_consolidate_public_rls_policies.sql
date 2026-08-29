-- Consolidate permissive RLS policies into one policy per table, command and
-- effective Data API role. PostgreSQL combines permissive policies with OR;
-- the generated predicates preserve that exact behavior while avoiding the
-- repeated-policy planner overhead reported by advisor lint 0006.
--
-- PUBLIC policies are expanded only to anon/authenticated. A preflight check
-- aborts the transaction if a PUBLIC policy protects a table granted to any
-- other non-bypass role, so the expansion cannot silently narrow real access.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

select pg_advisory_xact_lock(hashtext('agvlog:consolidate-public-rls-policies'));

create temporary table agvlog_rls_policy_source on commit drop as
select
  policy.oid as policy_oid,
  policy.polrelid,
  namespace.nspname::text as schema_name,
  relation.relname::text as table_name,
  policy.polname::text as policy_name,
  policy.polpermissive,
  policy.polcmd,
  policy.polroles,
  pg_get_expr(policy.polqual, policy.polrelid) as using_expr,
  pg_get_expr(policy.polwithcheck, policy.polrelid) as check_expr
from pg_policy as policy
join pg_class as relation on relation.oid = policy.polrelid
join pg_namespace as namespace on namespace.oid = relation.relnamespace
where namespace.nspname = 'public';

do $$
begin
  if exists (
    select 1
    from agvlog_rls_policy_source
    where not polpermissive
  ) then
    raise exception 'RLS consolidation aborted: restrictive policies require a separate preservation path';
  end if;

  if exists (
    select 1
    from agvlog_rls_policy_source as source_policy
    join information_schema.role_table_grants as table_grant
      on table_grant.table_schema = source_policy.schema_name
     and table_grant.table_name = source_policy.table_name
    left join pg_roles as granted_role on granted_role.rolname = table_grant.grantee
    where 0 = any(source_policy.polroles)
      and table_grant.grantee not in ('anon', 'authenticated', 'service_role', 'postgres')
      and not coalesce(granted_role.rolbypassrls, false)
      and not coalesce(granted_role.rolsuper, false)
  ) then
    raise exception 'RLS consolidation aborted: a PUBLIC policy serves another non-bypass table role';
  end if;
end
$$;

create temporary table agvlog_rls_policy_canonical on commit drop as
with target_roles as (
  select
    source_policy.*,
    target_role.oid as role_oid,
    target_role.rolname::text as role_name
  from agvlog_rls_policy_source as source_policy
  cross join lateral (
    select role.oid, role.rolname
    from pg_roles as role
    where
      (
        0 = any(source_policy.polroles)
        and role.rolname in ('anon', 'authenticated')
      )
      or role.oid = any(source_policy.polroles)
  ) as target_role
), commands(command_name, policy_command) as (
  values
    ('select'::text, 'r'::"char"),
    ('insert'::text, 'a'::"char"),
    ('update'::text, 'w'::"char"),
    ('delete'::text, 'd'::"char")
), expanded as (
  select
    target_roles.*,
    commands.command_name,
    commands.policy_command
  from target_roles
  cross join commands
  where target_roles.polcmd = '*'::"char"
     or target_roles.polcmd = commands.policy_command
)
select
  polrelid,
  schema_name,
  table_name,
  role_oid,
  role_name,
  command_name,
  policy_command,
  format('agvlog_%s_%s', command_name, role_name) as policy_name,
  string_agg(
    distinct format('(%s)', coalesce(using_expr, 'true')),
    ' OR '
    order by format('(%s)', coalesce(using_expr, 'true'))
  ) filter (where command_name in ('select', 'update', 'delete')) as using_expr,
  string_agg(
    distinct format('(%s)', coalesce(check_expr, using_expr, 'true')),
    ' OR '
    order by format('(%s)', coalesce(check_expr, using_expr, 'true'))
  ) filter (where command_name in ('insert', 'update')) as check_expr,
  count(*) as source_policy_count
from expanded
group by
  polrelid,
  schema_name,
  table_name,
  role_oid,
  role_name,
  command_name,
  policy_command;

do $$
declare
  target_table record;
  source_policy record;
  canonical_policy record;
begin
  -- Acquire every required table lock before the first destructive statement.
  -- If any table is busy for more than lock_timeout, the whole transaction
  -- aborts with the original policies untouched.
  for target_table in
    select distinct schema_name, table_name
    from agvlog_rls_policy_source
    order by schema_name, table_name
  loop
    execute format(
      'lock table %I.%I in access exclusive mode',
      target_table.schema_name,
      target_table.table_name
    );
  end loop;

  for source_policy in
    select schema_name, table_name, policy_name
    from agvlog_rls_policy_source
    order by schema_name, table_name, policy_name
  loop
    execute format(
      'drop policy %I on %I.%I',
      source_policy.policy_name,
      source_policy.schema_name,
      source_policy.table_name
    );
  end loop;

  for canonical_policy in
    select *
    from agvlog_rls_policy_canonical
    order by schema_name, table_name, role_name, command_name
  loop
    case canonical_policy.command_name
      when 'select' then
        execute format(
          'create policy %I on %I.%I as permissive for select to %I using (%s)',
          canonical_policy.policy_name,
          canonical_policy.schema_name,
          canonical_policy.table_name,
          canonical_policy.role_name,
          canonical_policy.using_expr
        );
      when 'insert' then
        execute format(
          'create policy %I on %I.%I as permissive for insert to %I with check (%s)',
          canonical_policy.policy_name,
          canonical_policy.schema_name,
          canonical_policy.table_name,
          canonical_policy.role_name,
          canonical_policy.check_expr
        );
      when 'update' then
        execute format(
          'create policy %I on %I.%I as permissive for update to %I using (%s) with check (%s)',
          canonical_policy.policy_name,
          canonical_policy.schema_name,
          canonical_policy.table_name,
          canonical_policy.role_name,
          canonical_policy.using_expr,
          canonical_policy.check_expr
        );
      when 'delete' then
        execute format(
          'create policy %I on %I.%I as permissive for delete to %I using (%s)',
          canonical_policy.policy_name,
          canonical_policy.schema_name,
          canonical_policy.table_name,
          canonical_policy.role_name,
          canonical_policy.using_expr
        );
      else
        raise exception 'Unsupported canonical RLS command: %', canonical_policy.command_name;
    end case;
  end loop;
end
$$;

-- Structural postcondition: every generated table/role/command combination
-- exists exactly once and no unexpected permissive overlap remains for the
-- Data API roles.
do $$
declare
  expected_count bigint;
  actual_count bigint;
begin
  select count(*) into expected_count from agvlog_rls_policy_canonical;

  select count(*)
  into actual_count
  from pg_policy as policy
  join pg_class as relation on relation.oid = policy.polrelid
  join pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and policy.polname like 'agvlog\_%' escape '\';

  if actual_count <> expected_count then
    raise exception 'RLS consolidation verification failed: expected % canonical policies, found %', expected_count, actual_count;
  end if;

  if exists (
    with effective as (
      select
        policy.polrelid,
        policy.polcmd,
        role.rolname,
        count(*) as policy_count
      from pg_policy as policy
      cross join lateral (
        select candidate.oid, candidate.rolname
        from pg_roles as candidate
        where candidate.rolname in ('anon', 'authenticated', 'service_role')
          and (
            0 = any(policy.polroles)
            or candidate.oid = any(policy.polroles)
          )
      ) as role
      where policy.polpermissive
        and policy.polrelid in (select polrelid from agvlog_rls_policy_source)
      group by policy.polrelid, policy.polcmd, role.rolname
    )
    select 1 from effective where policy_count > 1
  ) then
    raise exception 'RLS consolidation verification failed: permissive overlap remains';
  end if;

  if exists (
    select 1
    from agvlog_rls_policy_canonical as expected
    where not exists (
      select 1
      from pg_policy as actual
      where actual.polrelid = expected.polrelid
        and actual.polname = expected.policy_name
        and actual.polcmd = expected.policy_command
        and actual.polpermissive
        and actual.polroles = array[expected.role_oid]::oid[]
    )
  ) then
    raise exception 'RLS consolidation verification failed: a canonical role/command policy is missing';
  end if;
end
$$;

commit;
