do $verify_active_tenant_rls$
declare
  missing_tables text;
begin
  select string_agg(format('%I.%I', n.nspname, c.relname), ', ' order by c.relname)
  into missing_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and a.attname = 'tenant_id'
    and not a.attisdropped
    and (
      not c.relrowsecurity
      or not exists (
        select 1
        from pg_policy p
        where p.polrelid = c.oid
          and p.polname = 'agvlog_active_tenant_context'
          and not p.polpermissive
      )
    );

  if missing_tables is not null then
    raise exception 'tenant-scoped tables without restrictive active context: %', missing_tables;
  end if;
end;
$verify_active_tenant_rls$;
