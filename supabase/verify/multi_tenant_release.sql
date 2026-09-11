-- Post-deploy gate for the workspace/tenant release. Run with a database owner
-- against a restored production backup first, then staging and production.
-- This script is read-only and aborts on the first class of invariant failure.
begin transaction read only;

do $multi_tenant_release$
declare
  relation record;
  mismatch_exists boolean;
  violations text[] := array[]::text[];
  missing_active_policy text;
  invalid_workspaces text;
  invalid_ssx text;
begin
  select string_agg(format('%I.%I', n.nspname, c.relname), ', ' order by c.relname)
  into missing_active_policy
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
    and a.attname = 'tenant_id' and not a.attisdropped
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and (
      not c.relrowsecurity
      or not exists (
        select 1 from pg_policy p
        where p.polrelid = c.oid
          and p.polname = 'agvlog_active_tenant_context'
          and not p.polpermissive
      )
    );
  if missing_active_policy is not null then
    raise exception 'multi_tenant_missing_active_rls: %', missing_active_policy;
  end if;

  select string_agg(t.id::text, ', ' order by t.id)
  into invalid_workspaces
  from public.tenants t
  where t.workspace_id is null
     or not exists(select 1 from public.workspaces w where w.id = t.workspace_id);
  if invalid_workspaces is not null then
    raise exception 'multi_tenant_invalid_tenant_workspaces: %', invalid_workspaces;
  end if;

  -- Detect existing cross-tenant references generically. This covers fiscal,
  -- financial, operational and future tables whenever both sides carry a
  -- tenant_id, including legacy single-column foreign keys.
  for relation in
    select
      source_ns.nspname source_schema,
      source_table.relname source_table,
      target_ns.nspname target_schema,
      target_table.relname target_table,
      constraint_row.conname constraint_name,
      string_agg(
        format('source.%I = target.%I', source_column.attname, target_column.attname),
        ' and ' order by source_key.ordinality
      ) join_expression
    from pg_constraint constraint_row
    join pg_class source_table on source_table.oid = constraint_row.conrelid
    join pg_namespace source_ns on source_ns.oid = source_table.relnamespace
    join pg_class target_table on target_table.oid = constraint_row.confrelid
    join pg_namespace target_ns on target_ns.oid = target_table.relnamespace
    cross join lateral unnest(constraint_row.conkey) with ordinality source_key(attnum, ordinality)
    join lateral unnest(constraint_row.confkey) with ordinality target_key(attnum, ordinality)
      on target_key.ordinality = source_key.ordinality
    join pg_attribute source_column
      on source_column.attrelid = source_table.oid and source_column.attnum = source_key.attnum
    join pg_attribute target_column
      on target_column.attrelid = target_table.oid and target_column.attnum = target_key.attnum
    where constraint_row.contype = 'f'
      and source_ns.nspname = 'public'
      and target_ns.nspname = 'public'
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = source_table.oid and a.attname = 'tenant_id' and not a.attisdropped
      )
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = target_table.oid and a.attname = 'tenant_id' and not a.attisdropped
      )
    group by source_ns.nspname, source_table.relname,
      target_ns.nspname, target_table.relname, constraint_row.conname
  loop
    execute format(
      'select exists(select 1 from %I.%I source join %I.%I target on %s where source.tenant_id is distinct from target.tenant_id limit 1)',
      relation.source_schema, relation.source_table,
      relation.target_schema, relation.target_table,
      relation.join_expression
    ) into mismatch_exists;
    if mismatch_exists then
      violations := array_append(
        violations,
        format('%I.%I[%I] -> %I.%I', relation.source_schema,
          relation.source_table, relation.constraint_name,
          relation.target_schema, relation.target_table)
      );
    end if;
  end loop;
  if cardinality(violations) > 0 then
    raise exception 'multi_tenant_cross_tenant_references: %', array_to_string(violations, ', ');
  end if;

  select string_agg(problem.workspace_id::text, ', ' order by problem.workspace_id)
  into invalid_ssx
  from (
    select account.workspace_id
    from public.integration_accounts account
    where lower(account.provider) = 'ssx'
    group by account.workspace_id
    having count(*) <> 1
       or count(*) filter (
         where exists (
           select 1 from public.workspace_ssx_accounts registry
           where registry.workspace_id = account.workspace_id
             and registry.integration_account_id = account.id
             and registry.migration_state = 'ready'
         )
       ) <> 1
    union
    select registry.workspace_id
    from public.workspace_ssx_accounts registry
    left join public.integration_accounts account
      on account.id = registry.integration_account_id
    where account.id is null
       or account.workspace_id <> registry.workspace_id
       or lower(account.provider) <> 'ssx'
       or registry.migration_state <> 'ready'
  ) problem;
  if invalid_ssx is not null then
    raise exception 'multi_tenant_invalid_workspace_ssx: %', invalid_ssx;
  end if;
end;
$multi_tenant_release$;

select
  (select count(*) from public.workspaces) workspace_count,
  (select count(*) from public.tenants) tenant_count,
  (select count(*) from public.workspace_parties) shared_party_count,
  (select count(*) from public.workspace_people) shared_people_count,
  (select count(*) from public.workspace_vehicles) shared_vehicle_count,
  (select count(*) from public.workspace_ssx_accounts where migration_state = 'ready') ready_ssx_count;

commit;
