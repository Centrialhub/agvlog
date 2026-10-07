// Captured/restored hook verified read-only on 2026-09-28. A change requires
// review; a matching name alone must not activate an unknown function body.
export const AUTH_HOOK_BODY_MD5 = 'e205977747cf0c93bbde4b9f4322a88a';
export const applicationInventorySql = `SELECT json_build_object(
 'publicTables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),
 'publicTablesWithoutRls',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity),
 'buckets',(SELECT count(*) FROM storage.buckets),
 'authUsers',(SELECT count(*) FROM auth.users),
 'unexpectedUsers',(SELECT count(*) FROM auth.users WHERE id NOT IN (
   SELECT ('10000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid FROM generate_series(1,7) n)),
 'tenants',(SELECT count(*) FROM public.tenants),
 'workspaces',(SELECT count(*) FROM public.workspaces),
 'cronJobs',(SELECT count(*) FROM cron.job),
 'vaultSecrets',(SELECT count(*) FROM vault.secrets),
 'httpQueue',(SELECT count(*) FROM net.http_request_queue),
 'integrationAccounts',(SELECT count(*) FROM public.integration_accounts),
 'enabledIntegrations',(SELECT count(*) FROM public.tenant_feature_policy WHERE enabled),
 'hookValid',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
   WHERE p.oid=to_regprocedure('public.custom_access_token_hook(jsonb)')
     AND p.prokind='f' AND p.prorettype='jsonb'::regtype AND p.provolatile='s' AND p.prosecdef
     AND l.lanname='plpgsql' AND pg_get_userbyid(p.proowner)='postgres'
     AND p.proconfig=ARRAY['search_path=""'] AND md5(p.prosrc)='${AUTH_HOOK_BODY_MD5}'
     AND has_function_privilege('supabase_auth_admin',p.oid,'EXECUTE')
     AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
     AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
     AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
     AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
       WHERE a.grantee=0 AND a.privilege_type='EXECUTE')),
 'authRoleValid',EXISTS(SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin'
   AND rolcanlogin AND NOT rolsuper AND NOT rolbypassrls),
 'authSchemaUsage',has_schema_privilege('supabase_auth_admin','public','USAGE'))`;

// supabase_admin is used only to assume the real Auth role in a read-only
// transaction. No token or claims containing personal data are returned.
export const applicationHookProbeSql = `BEGIN READ ONLY;
SET LOCAL ROLE supabase_auth_admin;
WITH expected(user_id,tenant_id,workspace_id) AS (VALUES
 ('10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001'),
 ('10000000-0000-4000-8000-000000000005','20000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000002')),
 results AS (SELECT expected.*,public.custom_access_token_hook(jsonb_build_object(
   'user_id',user_id,'claims',jsonb_build_object('role','authenticated'))) -> 'claims' AS claims FROM expected),
 unknown_user AS (SELECT public.custom_access_token_hook('{
   "user_id":"10000000-0000-4000-8000-000000000099",
   "claims":{"role":"authenticated","active_tenant_id":"forged","active_workspace_id":"forged"}}') -> 'claims' AS claims)
SELECT json_build_object('authRole',current_user='supabase_auth_admin',
 'fixtureClaims',coalesce((SELECT bool_and(claims->>'active_tenant_id'=tenant_id AND
   claims->>'active_workspace_id'=workspace_id AND claims->>'role'='authenticated') FROM results),false),
 'unknownUserUnscoped',(SELECT NOT (claims ? 'active_tenant_id') AND NOT (claims ? 'active_workspace_id') FROM unknown_user));
ROLLBACK;`;

export function validApplicationInventory(value) {
  const expected = { publicTables: 327, publicTablesWithoutRls: 0, buckets: 8,
    authUsers: 7, unexpectedUsers: 0, tenants: 2, workspaces: 2,
    cronJobs: 0, vaultSecrets: 0, httpQueue: 0, integrationAccounts: 0, enabledIntegrations: 0,
    hookValid: true, authRoleValid: true, authSchemaUsage: true };
  return value && Object.keys(value).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, expectedValue]) => value[key] === expectedValue);
}
