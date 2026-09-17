-- CREATED VIA CLI, MOVED OUT OF MIGRATIONS: NOT ARMED / DO NOT APPLY YET.
-- Root must review the final MAINDB catalog and replace the single expected hash
-- only after every dependency, boundary and worker checkpoint has been approved.
-- No GUC, JWT or client-controlled value can authorize this deployment.
set local lock_timeout='3s';set local statement_timeout='60s';
do $activation$
declare expected_catalog text:='49f3667e6229ea23178bef0e7df3a4f0';actual_catalog text;routine record;relation record;definition text;
 active_body text:=$active$
 select auth.uid() is not null and nullif(auth.jwt()->>'active_tenant_id','') is not null and private.is_request_tenant_member(_tenant)
 and exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant
   and m.user_id=auth.uid() and m.active and m.role::text in ('owner','admin','operator'))
 and not exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant
   and m.user_id=auth.uid() and m.active and m.role::text='driver')
 and not exists(select 1 from public.drivers d where d.tenant_id=_tenant
   and d.user_id=auth.uid() and d.active);
$active$;
begin
 if expected_catalog!~'^[a-f0-9]{32}$' then raise exception 'finance_activation_checkpoint_not_approved';end if;
 select checkpoint.catalog_revision into actual_catalog from (
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
select md5(coalesce(string_agg(key||':'||value,E'\n' order by key),'')) as catalog_revision from entries
 ) checkpoint;
 if actual_catalog is distinct from expected_catalog then raise exception 'finance_activation_catalog_changed';end if;
 select p.*,l.lanname into routine from pg_proc p join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('finance_private.can_access(uuid)');
 if not found then raise exception 'finance_activation_staged_gate_missing';end if;
 if routine.prosrc is distinct from ' select false; ' or routine.lanname<>'sql' or not routine.prosecdef or routine.provolatile<>'s'
  or routine.prorettype<>'boolean'::regtype or routine.proargnames is distinct from array['_tenant']::text[]
  or routine.proconfig is distinct from array['search_path=""']::text[]
  or has_function_privilege('anon',routine.oid,'execute') or not has_function_privilege('authenticated',routine.oid,'execute')
  or not has_function_privilege('service_role',routine.oid,'execute')
  or exists(select 1 from aclexplode(coalesce(routine.proacl,acldefault('f',routine.proowner))) a where a.privilege_type='EXECUTE'
    and a.grantee not in(routine.proowner,(select oid from pg_roles where rolname='authenticated'),(select oid from pg_roles where rolname='service_role'))) then
  raise exception 'finance_activation_staged_gate_contract_changed';end if;
 if to_regprocedure('private.is_request_tenant_member(uuid)') is null or to_regprocedure('private.request_tenant_id()') is null
   or to_regprocedure('finance_private.require_access(uuid)') is null then raise exception 'finance_activation_company_dependency_missing';end if;
 for relation in select c.oid,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in('r','p')
   and (c.relname like 'finance\_%' escape '\' or c.relname ~ '^(bank_|financial_|payables($|_)|payable_|receivables($|_)|receivable_|driver_expens|driver_settlement|payroll_|expense_creation_|expense_review_|settlement_adjustment_|client_invoice|closing_report)'
     or c.relname in('employee_advances','load_payments','load_unloading_charges'))
   and exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attname='tenant_id' and not a.attisdropped and a.atttypid='uuid'::regtype)
  order by c.relname
 loop
  if exists(select 1 from pg_policy p where p.polrelid=relation.oid and p.polname='finance_active_company_boundary') then raise exception 'finance_activation_policy_already_present: %',relation.relname;end if;
  execute format('alter table public.%I enable row level security',relation.relname);
  execute format('create policy finance_active_company_boundary on public.%I as restrictive for all to authenticated using(finance_private.can_access(tenant_id)) with check(finance_private.can_access(tenant_id))',relation.relname);
 end loop;
 definition:=pg_get_functiondef(routine.oid);execute replace(definition,routine.prosrc,active_body);
 comment on function finance_private.can_access(uuid) is 'Selected-company finance access: signed active tenant, current internal membership, no active driver identity. Activated only through reviewed catalog checkpoint.';
end;$activation$;
