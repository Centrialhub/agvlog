-- Re-run the active-tenant boundary after every feature migration in this
-- release. Several finance, delivery and cargo-custody tables are intentionally
-- created after the foundation migration, so they must receive the same
-- restrictive policy before the release is deployed.
do $active_tenant_rls$
declare
  relation record;
begin
  for relation in
    select n.nspname schema_name, c.relname table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and a.attname = 'tenant_id'
      and not a.attisdropped
    order by c.relname
  loop
    execute format(
      'alter table %I.%I enable row level security',
      relation.schema_name,
      relation.table_name
    );
    execute format(
      'drop policy if exists agvlog_active_tenant_context on %I.%I',
      relation.schema_name,
      relation.table_name
    );
    execute format(
      'create policy agvlog_active_tenant_context on %I.%I as restrictive for all to authenticated using (private.is_request_tenant_member(tenant_id)) with check (private.is_request_tenant_member(tenant_id))',
      relation.schema_name,
      relation.table_name
    );
  end loop;
end;
$active_tenant_rls$;

comment on function private.request_tenant_id() is
  'Resolves the signed active tenant and requires any explicit request header to match it.';
