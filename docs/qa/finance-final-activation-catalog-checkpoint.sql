-- Read-only. Capture only after the complete reviewed chain and worker pause checks.
-- This fingerprint detects later drift; it does not approve the catalog automatically.
with entries as (
 select 'function:'||p.oid::regprocedure::text key, md5(jsonb_build_object('definition',pg_get_functiondef(p.oid),'acl',p.proacl::text,'owner',p.proowner::regrole::text)::text) value
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private','finance_private','expense_creation_private','settlement_adjustment_private','auth') and p.prokind='f'
 union all
 select 'table:'||n.nspname||'.'||c.relname,md5(jsonb_build_object('kind',c.relkind,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'owner',c.relowner::regrole::text,'acl',c.relacl::text,'options',c.reloptions,
 'columns',(select jsonb_agg(jsonb_build_array(a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attgenerated,(select pg_get_expr(d.adbin,d.adrelid) from pg_attrdef d where d.adrelid=a.attrelid and d.adnum=a.attnum)) order by a.attnum) from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped))::text)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','finance_private','expense_creation_private','settlement_adjustment_private','auth') and c.relkind in('r','p','v','m','S')
 union all
 select 'index:'||c.oid::regclass::text,md5(jsonb_build_object('definition',pg_get_indexdef(c.oid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive)::text)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_index i on i.indexrelid=c.oid where n.nspname in('public','private','finance_private','expense_creation_private','settlement_adjustment_private','auth')
 union all
 select 'view:'||c.oid::regclass::text,md5(pg_get_viewdef(c.oid)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in('v','m') and n.nspname in('public','private','finance_private','expense_creation_private','settlement_adjustment_private','auth')
 union all
 select 'policy:'||p.polrelid::regclass::text||':'||p.polname,md5(jsonb_build_object('permissive',p.polpermissive,'roles',p.polroles,'command',p.polcmd,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))::text)
 from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','finance_private','expense_creation_private','settlement_adjustment_private','auth')
 union all
 select 'trigger:'||t.tgrelid::regclass::text||':'||t.tgname,md5(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)::text)
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in('public','private','finance_private','expense_creation_private','settlement_adjustment_private','auth')
 union all
 select 'constraint:'||c.conrelid::regclass::text||':'||c.conname,md5(jsonb_build_object('definition',pg_get_constraintdef(c.oid),'validated',c.convalidated)::text)
 from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in('public','private','finance_private','expense_creation_private','settlement_adjustment_private','auth')
 union all
 select 'schema:'||n.nspname,md5(jsonb_build_object('owner',n.nspowner::regrole::text,'acl',n.nspacl::text)::text) from pg_namespace n where n.nspname in('public','private','finance_private','expense_creation_private','settlement_adjustment_private','auth')
)
select md5(coalesce(string_agg(key||':'||value,E'\n' order by key),'')) as catalog_revision from entries;
