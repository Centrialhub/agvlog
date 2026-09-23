set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $guard$
begin
  if to_regclass('public.freight_tables') is null then
    raise exception 'freight_tables dependency is missing';
  end if;
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.freight_tables'::regclass
      and conname = 'freight_tables_nonblank_name'
  ) then
    raise exception 'freight_tables_nonblank_name is already installed';
  end if;
end;
$guard$;

-- NOT VALID preserves any legacy bad row for explicit cleanup, while PostgreSQL
-- still enforces the condition on every new insert or updated row.
alter table public.freight_tables
  add constraint freight_tables_nonblank_name
  check (btrim(table_name) <> '') not valid;
