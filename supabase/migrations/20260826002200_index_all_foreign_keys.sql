-- PostgreSQL does not create indexes on the referencing side of foreign keys.
-- Add a covering index for every public FK that still lacks one.
do $$
declare
  fk record;
  index_name text;
begin
  for fk in
    select
      c.oid,
      n.nspname as schema_name,
      t.relname as table_name,
      c.conname,
      string_agg(quote_ident(a.attname), ', ' order by k.ordinality) as columns_sql
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    cross join lateral unnest(c.conkey) with ordinality as k(attnum, ordinality)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
    where c.contype = 'f'
      and n.nspname = 'public'
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and i.indisvalid
          and (i.indkey::smallint[])[0:(array_length(c.conkey, 1) - 1)] = c.conkey
      )
    group by c.oid, n.nspname, t.relname, c.conname
    order by n.nspname, t.relname, c.conname
  loop
    index_name := left(
      format('idx_%s_%s_fk', fk.table_name, regexp_replace(fk.conname, '_fkey$', '')),
      54
    ) || '_' || left(md5(fk.oid::text), 8);

    execute format(
      'create index if not exists %I on %I.%I (%s)',
      index_name,
      fk.schema_name,
      fk.table_name,
      fk.columns_sql
    );
  end loop;
end
$$;
