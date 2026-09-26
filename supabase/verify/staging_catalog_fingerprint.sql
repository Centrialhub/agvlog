-- Read-only comparison of the application catalog before applying candidate SQL.
-- Run against production and a fresh staging branch using the same PostgreSQL major
-- version and the same search_path (prefer pg_catalog). The aggregate returns only
-- counts and MD5 digests, not function bodies, policy expressions, migration SQL,
-- or customer rows. This includes platform-managed objects and cluster
-- roles: category differences require object-level triage, and equality is not
-- proof of behavioral parity.
-- To locate a differing category without exposing definitions, replace the final
-- SELECT with: SELECT category, object_key, row_md5
--   FROM hashed_row WHERE category = '<category>'
--   ORDER BY object_key COLLATE "C", row_md5 COLLATE "C";
with app_schema(name) as (
  values
    ('public'), ('private'), ('finance_private'), ('control_tower_private'),
    ('cron_retention_private'), ('delivery_private'), ('driver_chat_private'),
    ('expense_creation_private'), ('payable_xml_private'),
    ('secure_upload_private'), ('settlement_adjustment_private'),
    ('ssx_private'), ('storage_evidence_private')
), scoped_relation as (
  select c.oid, n.nspname, c.relname, c.relkind, c.relrowsecurity,
    c.relforcerowsecurity, c.relacl, c.relowner, c.reloptions,
    c.relpersistence, c.relreplident
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in (select name from app_schema)
    or (n.nspname = 'auth' and c.relname = 'users')
    or (n.nspname = 'storage' and c.relname in ('objects', 'buckets'))
), catalog_row as (
  select 'schema_acl' as category, n.nspname as object_key,
    pg_get_userbyid(n.nspowner) || '|' || coalesce(n.nspacl::text, '') as definition
  from pg_namespace n where n.nspname in (select name from app_schema)
  union all
  select 'relation', r.nspname || '.' || r.relname,
    concat_ws('|', r.relkind, r.relrowsecurity, r.relforcerowsecurity,
      pg_get_userbyid(r.relowner), coalesce(r.relacl::text, ''),
      coalesce(r.reloptions::text, ''), r.relpersistence, r.relreplident)
  from scoped_relation r
  union all
  select 'column', r.nspname || '.' || r.relname || '.' || a.attnum,
    concat_ws('|', a.attname, format_type(a.atttypid, a.atttypmod),
      a.attnotnull, a.attidentity, a.attgenerated, a.attstorage,
      a.attcompression, coalesce(a.attacl::text, ''),
      jsonb_build_array(collns.nspname, coll.collname, coll.collprovider,
        coll.collisdeterministic, coll.collencoding, coll.collcollate,
        coll.collctype, coll.colllocale, coll.collicurules,
        coll.collversion)::text,
      coalesce(pg_get_expr(d.adbin, d.adrelid), ''))
  from scoped_relation r
  join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
  left join pg_attrdef d on d.adrelid = r.oid and d.adnum = a.attnum
  left join pg_collation coll on coll.oid = a.attcollation
  left join pg_namespace collns on collns.oid = coll.collnamespace
  union all
  select 'constraint', r.nspname || '.' || r.relname || '.' || c.conname,
    concat_ws('|', c.contype, c.convalidated, pg_get_constraintdef(c.oid, false))
  from scoped_relation r join pg_constraint c on c.conrelid = r.oid
  union all
  select 'index', r.nspname || '.' || r.relname || '.' || ic.relname,
    concat_ws('|', i.indisvalid, i.indisready, i.indisreplident,
      pg_get_indexdef(i.indexrelid, 0, false))
  from scoped_relation r
  join pg_index i on i.indrelid = r.oid
  join pg_class ic on ic.oid = i.indexrelid
  union all
  select 'view', r.nspname || '.' || r.relname, pg_get_viewdef(r.oid, false)
  from scoped_relation r where r.relkind in ('v', 'm')
  union all
  select 'routine', n.nspname || '.' || p.proname || '(' ||
      pg_get_function_identity_arguments(p.oid) || ')',
    pg_get_functiondef(p.oid) || chr(10) || pg_get_userbyid(p.proowner)
      || chr(10) || coalesce(p.proacl::text, '')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in (select name from app_schema) and p.prokind in ('f', 'p')
  union all
  select 'policy', r.nspname || '.' || r.relname || '.' || p.polname,
    concat_ws('|', p.polcmd, p.polpermissive,
      array(select case when role_oid = 0 then 'PUBLIC'
        else coalesce((select rolname from pg_roles where oid = role_oid), role_oid::text)
        end from unnest(p.polroles) as role_oid order by 1)::text,
      coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
      coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
  from scoped_relation r join pg_policy p on p.polrelid = r.oid
  union all
  select 'trigger', r.nspname || '.' || r.relname || '.' || t.tgname,
    t.tgenabled::text || '|' || pg_get_triggerdef(t.oid, false)
  from scoped_relation r
  join pg_trigger t on t.tgrelid = r.oid and not t.tgisinternal
  union all
  select 'default_acl', coalesce(n.nspname, '*') || '.' ||
      pg_get_userbyid(a.defaclrole) || '.' || a.defaclobjtype::text,
    a.defaclacl::text
  from pg_default_acl a
  left join pg_namespace n on n.oid = a.defaclnamespace
  where n.nspname in (select name from app_schema) or a.defaclnamespace = 0
  union all
  select 'role', r.rolname,
    concat_ws('|', r.rolsuper, r.rolinherit, r.rolcreaterole, r.rolcreatedb,
      r.rolcanlogin, r.rolreplication, r.rolbypassrls)
  from pg_roles r
  union all
  select 'role_membership', pg_get_userbyid(m.roleid) || '.' || pg_get_userbyid(m.member),
    concat_ws('|', m.admin_option, m.inherit_option, m.set_option)
  from pg_auth_members m
  union all
  select 'sequence', r.nspname || '.' || r.relname,
    concat_ws('|', s.seqstart, s.seqincrement, s.seqmax, s.seqmin, s.seqcache, s.seqcycle)
  from scoped_relation r join pg_sequence s on s.seqrelid = r.oid
  union all
  select 'type', n.nspname || '.' || t.typname,
    concat_ws('|', t.typtype, pg_get_userbyid(t.typowner), t.typnotnull,
      format_type(t.typbasetype, t.typtypmod), coalesce(t.typdefault, ''),
      (select string_agg(e.enumlabel, '|' order by e.enumsortorder)
        from pg_enum e where e.enumtypid = t.oid),
      (select string_agg(pg_get_constraintdef(c.oid, false), '|' order by c.conname)
        from pg_constraint c where c.contypid = t.oid))
  from pg_type t join pg_namespace n on n.oid = t.typnamespace
  where n.nspname in (select name from app_schema)
  union all
  select 'extension', e.extname, e.extversion || '|' || n.nspname
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  union all
  select 'event_trigger', e.evtname,
    concat_ws('|', e.evtevent, e.evtenabled, e.evttags::text,
      p.proname, n.nspname)
  from pg_event_trigger e
  join pg_proc p on p.oid = e.evtfoid
  join pg_namespace n on n.oid = p.pronamespace
  union all
  select 'storage_bucket', b.id,
    jsonb_build_object('name', b.name, 'public', b.public,
      'file_size_limit', b.file_size_limit,
      'allowed_mime_types', b.allowed_mime_types, 'type', b.type)::text
  from storage.buckets b
  union all
  select 'migration_ledger', m.version, m.name
  from supabase_migrations.schema_migrations m
), hashed_row as (
  select category, object_key,
    md5(jsonb_build_array(object_key, definition)::text) as row_md5
  from catalog_row
)
select category, count(*)::integer as object_count,
  md5(string_agg(row_md5, E'\n'
    order by object_key collate "C" nulls first,
      row_md5 collate "C"))
    as catalog_md5
from hashed_row
group by category
order by category;
