import type { PGlite } from '@electric-sql/pglite';
import { writeFileSync } from 'node:fs';

// Exports only the synthetic in-memory fixture for an independent native replay.
export async function exportDriverSharedFixture(db: PGlite, path: string) {
  const quote = (value: string) => "'" + value.replace(/'/g, "''") + "'";
  const sql = ["create role anon;create role authenticated;create role service_role bypassrls;create role supabase_auth_admin;create role supabase_admin;",
    'create schema auth;create schema private;create schema extensions;create extension pgcrypto with schema extensions;',
    "create type public.app_role as enum('owner','admin','operator','client','driver');"];
  const sequences = await db.query<{name: string}>("select c.oid::regclass::text name from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='S' and n.nspname in('public','auth','private')");
  for (const row of sequences.rows) sql.push(`create sequence ${row.name};`);
  const tables = await db.query<{name: string; columns: string}>(`select c.oid::regclass::text name,
    string_agg(quote_ident(a.attname)||' '||format_type(a.atttypid,a.atttypmod)
      ||case when d.adbin is not null then ' default '||pg_get_expr(d.adbin,d.adrelid) else '' end
      ||case when a.attnotnull then ' not null' else '' end,',' order by a.attnum) columns
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where c.relkind='r' and n.nspname in('public','auth','private') group by c.oid order by c.oid`);
  for (const row of tables.rows) sql.push(`create table ${row.name}(${row.columns});`);
  const constraints = await db.query<{name: string; constraint_name: string; definition: string}>(`select conrelid::regclass::text name,quote_ident(conname) constraint_name,pg_get_constraintdef(oid) definition
    from pg_constraint where contype in('p','u','f','c') and connamespace in('public'::regnamespace,'auth'::regnamespace,'private'::regnamespace)
    order by case when contype='f' then 1 else 0 end,oid`);
  for (const row of constraints.rows) sql.push(`alter table ${row.name} add constraint ${row.constraint_name} ${row.definition};`);
  const functions = await db.query<{definition: string}>(`select pg_get_functiondef(oid) definition from pg_proc where pronamespace in('public'::regnamespace,'auth'::regnamespace,'private'::regnamespace) order by oid`);
  for (const row of functions.rows) sql.push(row.definition + ';');
  sql.push("set session_replication_role='replica';");
  for (const row of tables.rows) {
    const data = await db.query<{data: unknown}>(`select jsonb_agg(to_jsonb(x)) data from ${row.name} x`);
    if (data.rows[0].data) sql.push(`insert into ${row.name} select * from jsonb_populate_recordset(null::${row.name},${quote(JSON.stringify(data.rows[0].data))}::jsonb);`);
  }
  sql.push("set session_replication_role='origin';");
  const triggers = await db.query<{definition: string}>("select pg_get_triggerdef(oid) definition from pg_trigger where not tgisinternal order by oid");
  for (const row of triggers.rows) sql.push(row.definition + ';');
  sql.push('grant usage on schema public,auth,private,extensions to service_role,supabase_auth_admin,authenticated,anon;',
    'grant all on all tables in schema public,private to service_role;',
    'grant select,insert,update,delete on auth.users,auth.identities to supabase_auth_admin;',
    'grant usage,select on all sequences in schema public to service_role;');
  writeFileSync(path, sql.join('\n') + '\n', {flag: 'wx'});
}
