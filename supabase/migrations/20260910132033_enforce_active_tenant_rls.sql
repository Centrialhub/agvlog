-- A restrictive policy composes with every existing domain policy. Existing
-- role/ownership checks remain authoritative, but an authenticated request can
-- only see or mutate rows from its signed/explicit active tenant.
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
  'Resolves explicit REST/Function/Storage tenant header first, then signed JWT claim for Realtime.';
