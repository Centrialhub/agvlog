-- AGV Log — preflight Supabase estritamente SELECT-only
-- Não contém DDL, DML, BEGIN/COMMIT/ROLLBACK, SET, GRANT ou REVOKE.
-- Mantenha `exposed_schemas` sincronizado com API Settings > Exposed schemas.

select
  current_database() as database_name,
  current_user as database_role,
  current_setting('server_version') as postgres_version,
  now() as checked_at;

-- Tabelas expostas sem RLS. Resultado esperado: zero.
with exposed_schemas(schema_name) as (
  values ('public'::name)
)
select
  n.nspname as schema_name,
  c.relname as table_name,
  c.relkind,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join exposed_schemas e on e.schema_name = n.nspname
where c.relkind in ('r', 'p')
  and not c.relrowsecurity
order by n.nspname, c.relname;

-- Views expostas sem security_invoker. Revisar ou retirar da Data API.
with exposed_schemas(schema_name) as (
  values ('public'::name)
)
select
  n.nspname as schema_name,
  c.relname as view_name,
  c.relkind,
  coalesce(c.reloptions, array[]::text[]) as reloptions
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join exposed_schemas e on e.schema_name = n.nspname
where c.relkind in ('v', 'm')
  and not (
    'security_invoker=true' = any(coalesce(c.reloptions, array[]::text[]))
  )
order by n.nspname, c.relname;

-- RLS habilitada sem policy, com privilégios efetivos por role.
with rls_without_policy as (
  select
    n.nspname as schema_name,
    c.relname as table_name,
    c.relkind,
    has_schema_privilege('anon', n.oid, 'usage')
      and has_table_privilege('anon', c.oid, 'select,insert,update,delete')
      as effective_anon_dml,
    has_schema_privilege('authenticated', n.oid, 'usage')
      and has_table_privilege(
        'authenticated', c.oid, 'select,insert,update,delete'
      ) as effective_authenticated_dml,
    has_schema_privilege('service_role', n.oid, 'usage')
      and has_table_privilege(
        'service_role', c.oid, 'select,insert,update,delete'
      ) as effective_service_role_dml
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and c.relrowsecurity
    and n.nspname not in ('pg_catalog', 'information_schema')
    and not exists (
      select 1 from pg_policy p where p.polrelid = c.oid
    )
)
select *
from rls_without_policy
order by schema_name, table_name;

-- SECURITY DEFINER executável pela API. Toda linha requer allowlist explícita.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  pg_get_userbyid(p.proowner) as owner_name,
  coalesce(array_to_string(p.proconfig, ','), '(unset)') as settings,
  has_function_privilege('anon', p.oid, 'execute') as anon_execute,
  has_function_privilege(
    'authenticated', p.oid, 'execute'
  ) as authenticated_execute,
  has_function_privilege(
    'service_role', p.oid, 'execute'
  ) as service_role_execute,
  p.proacl is not null as has_explicit_acl,
  position('auth.uid(' in lower(pg_get_functiondef(p.oid))) > 0
    as direct_auth_uid_check
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and n.nspname not in ('pg_catalog', 'information_schema')
  and (
    has_function_privilege('anon', p.oid, 'execute')
    or has_function_privilege('authenticated', p.oid, 'execute')
  )
order by n.nspname, p.proname, arguments;

-- Gate de SECURITY DEFINER da aplicação. Extensões ficam em allowlist própria.
-- A ausência de auth.uid direto pode ser válida somente quando um helper
-- autenticador revisado aparece no call graph.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  coalesce(array_to_string(p.proconfig, ','), '(unset)') as settings,
  p.proacl is not null as has_explicit_acl,
  position('auth.uid(' in lower(pg_get_functiondef(p.oid))) > 0
    as direct_auth_uid_check
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and n.nspname not in (
    'pg_catalog', 'information_schema', 'extensions'
  )
  and (
    coalesce(array_to_string(p.proconfig, ','), '')
      not like '%search_path=""%'
    or p.proacl is null
    or position('auth.uid(' in lower(pg_get_functiondef(p.oid))) = 0
  )
order by n.nspname, p.proname, arguments;

-- Origem dos grants EXECUTE. PUBLIC deve ser zero para funções da aplicação.
with functions as (
  select
    p.oid,
    p.proacl,
    p.proowner,
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in (
    'pg_catalog', 'information_schema', 'extensions'
  )
), expanded_acl as (
  select
    f.schema_name,
    f.function_name,
    f.arguments,
    coalesce(pg_get_userbyid(a.grantee), 'PUBLIC') as grantee,
    a.is_grantable
  from functions f
  cross join lateral aclexplode(
    coalesce(f.proacl, acldefault('f', f.proowner))
  ) a
  where a.privilege_type = 'EXECUTE'
)
select *
from expanded_acl
where grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
order by schema_name, function_name, arguments, grantee;

-- Default privileges que podem criar grants implícitos no futuro.
select
  pg_get_userbyid(d.defaclrole) as owner_name,
  coalesce(n.nspname, '(all schemas)') as schema_name,
  d.defaclobjtype,
  d.defaclacl
from pg_default_acl d
left join pg_namespace n on n.oid = d.defaclnamespace
where d.defaclobjtype in ('f', 'r', 'S')
order by owner_name, schema_name, d.defaclobjtype;

-- Policies com auth.* possivelmente reavaliado por linha. A confirmação final
-- é o Performance Advisor; não transformar funções dependentes da linha.
with policy_text as (
  select
    schemaname,
    tablename,
    policyname,
    roles,
    cmd,
    qual,
    with_check,
    lower(
      coalesce(qual, '') || ' ' || coalesce(with_check, '')
    ) as expression
  from pg_policies
  where schemaname not in ('pg_catalog', 'information_schema')
)
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from policy_text
where (
    expression like '%auth.uid()%'
    or expression like '%auth.jwt()%'
    or expression like '%auth.role()%'
    or expression like '%auth.email()%'
  )
  and expression not like '%select auth.%'
order by schemaname, tablename, policyname;

-- Múltiplas policies permissivas. ALL é expandida para captar sobreposição com
-- SELECT/INSERT/UPDATE/DELETE.
with expanded_policies as (
  select
    p.schemaname,
    p.tablename,
    p.policyname,
    role_name,
    action_name,
    p.qual,
    p.with_check
  from pg_policies p
  cross join lateral unnest(p.roles) role_name
  cross join lateral unnest(
    case
      when p.cmd = 'ALL'
        then array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
      else array[p.cmd]::text[]
    end
  ) action_name
  where p.permissive = 'PERMISSIVE'
    and p.schemaname not in ('pg_catalog', 'information_schema')
)
select
  schemaname,
  tablename,
  role_name,
  action_name,
  count(*) as policy_count,
  array_agg(policyname order by policyname) as policies
from expanded_policies
group by schemaname, tablename, role_name, action_name
having count(*) > 1
order by schemaname, tablename, role_name, action_name;

-- Definições completas para revisão semântica; nunca consolidar apenas pelo nome.
with expanded_policies as (
  select
    p.schemaname,
    p.tablename,
    role_name,
    action_name
  from pg_policies p
  cross join lateral unnest(p.roles) role_name
  cross join lateral unnest(
    case
      when p.cmd = 'ALL'
        then array['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
      else array[p.cmd]::text[]
    end
  ) action_name
  where p.permissive = 'PERMISSIVE'
), duplicated_tables as (
  select distinct schemaname, tablename
  from expanded_policies
  group by schemaname, tablename, role_name, action_name
  having count(*) > 1
)
select p.*
from pg_policies p
join duplicated_tables d
  on d.schemaname = p.schemaname
 and d.tablename = p.tablename
order by p.schemaname, p.tablename, p.cmd, p.policyname;

-- Configuração Auth não tem fonte SQL pública estável. Reexecute os advisors.
select
  'dashboard/advisor check required' as auth_configuration_check,
  'auth_leaked_password_protection' as leaked_password_advisor,
  'auth_insufficient_mfa_options' as mfa_advisor;
