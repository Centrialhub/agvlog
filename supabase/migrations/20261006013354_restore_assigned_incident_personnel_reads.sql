-- Authorize assigned incident reads through a private Boolean-only lookup.
-- Preserve employees/RH RLS, restrictive tenant context and all writer policies.
do $a6$
declare
  expected_policies constant jsonb := $policies$[
  {
    "cmd": "ALL",
    "qual": "private.is_request_tenant_member(tenant_id)",
    "check": "private.is_request_tenant_member(tenant_id)",
    "roles": [
      "authenticated"
    ],
    "table": "employee_incident_actions",
    "policy": "agvlog_active_tenant_context",
    "permissive": "RESTRICTIVE"
  },
  {
    "cmd": "DELETE",
    "qual": "is_tenant_admin(tenant_id)",
    "check": null,
    "roles": [
      "authenticated"
    ],
    "table": "employee_incident_actions",
    "policy": "agvlog_delete_authenticated",
    "permissive": "PERMISSIVE"
  },
  {
    "cmd": "INSERT",
    "qual": null,
    "check": "is_tenant_operator_or_admin(tenant_id)",
    "roles": [
      "authenticated"
    ],
    "table": "employee_incident_actions",
    "policy": "agvlog_insert_authenticated",
    "permissive": "PERMISSIVE"
  },
  {
    "cmd": "UPDATE",
    "qual": "is_tenant_operator_or_admin(tenant_id)",
    "check": "is_tenant_operator_or_admin(tenant_id)",
    "roles": [
      "authenticated"
    ],
    "table": "employee_incident_actions",
    "policy": "agvlog_update_authenticated",
    "permissive": "PERMISSIVE"
  },
  {
    "cmd": "SELECT",
    "qual": "(is_tenant_operator_or_admin(tenant_id) OR (is_tenant_member(tenant_id) AND (EXISTS ( SELECT 1\n   FROM employees employee\n  WHERE ((employee.id = employee_incident_actions.employee_id) AND (employee.tenant_id = employee_incident_actions.tenant_id) AND (employee.user_id = ( SELECT auth.uid() AS uid)))))))",
    "check": null,
    "roles": [
      "authenticated"
    ],
    "table": "employee_incident_actions",
    "policy": "eia_select",
    "permissive": "PERMISSIVE"
  },
  {
    "cmd": "ALL",
    "qual": "private.is_request_tenant_member(tenant_id)",
    "check": "private.is_request_tenant_member(tenant_id)",
    "roles": [
      "authenticated"
    ],
    "table": "employees",
    "policy": "agvlog_active_tenant_context",
    "permissive": "RESTRICTIVE"
  },
  {
    "cmd": "DELETE",
    "qual": "is_tenant_admin(tenant_id)",
    "check": null,
    "roles": [
      "authenticated"
    ],
    "table": "employees",
    "policy": "agvlog_delete_authenticated",
    "permissive": "PERMISSIVE"
  },
  {
    "cmd": "INSERT",
    "qual": null,
    "check": "is_tenant_admin(tenant_id)",
    "roles": [
      "authenticated"
    ],
    "table": "employees",
    "policy": "agvlog_insert_authenticated",
    "permissive": "PERMISSIVE"
  },
  {
    "cmd": "SELECT",
    "qual": "is_tenant_operator_or_admin(tenant_id)",
    "check": null,
    "roles": [
      "authenticated"
    ],
    "table": "employees",
    "policy": "agvlog_select_authenticated",
    "permissive": "PERMISSIVE"
  },
  {
    "cmd": "UPDATE",
    "qual": "is_tenant_admin(tenant_id)",
    "check": "is_tenant_admin(tenant_id)",
    "roles": [
      "authenticated"
    ],
    "table": "employees",
    "policy": "agvlog_update_authenticated",
    "permissive": "PERMISSIVE"
  },
  {
    "cmd": "SELECT",
    "qual": "(is_tenant_operator_or_admin(tenant_id) OR (is_tenant_member(tenant_id) AND (EXISTS ( SELECT 1\n   FROM employees employee\n  WHERE ((employee.id = incident_responsible.employee_id) AND (employee.tenant_id = incident_responsible.tenant_id) AND (employee.user_id = ( SELECT auth.uid() AS uid)))))))",
    "check": null,
    "roles": [
      "authenticated"
    ],
    "table": "incident_responsible",
    "policy": "Assigned employees and operators can view incident_responsible",
    "permissive": "PERMISSIVE"
  },
  {
    "cmd": "ALL",
    "qual": "private.is_request_tenant_member(tenant_id)",
    "check": "private.is_request_tenant_member(tenant_id)",
    "roles": [
      "authenticated"
    ],
    "table": "incident_responsible",
    "policy": "agvlog_active_tenant_context",
    "permissive": "RESTRICTIVE"
  },
  {
    "cmd": "DELETE",
    "qual": "is_tenant_admin(tenant_id)",
    "check": null,
    "roles": [
      "authenticated"
    ],
    "table": "incident_responsible",
    "policy": "agvlog_delete_authenticated",
    "permissive": "PERMISSIVE"
  },
  {
    "cmd": "INSERT",
    "qual": null,
    "check": "is_tenant_admin(tenant_id)",
    "roles": [
      "authenticated"
    ],
    "table": "incident_responsible",
    "policy": "agvlog_insert_authenticated",
    "permissive": "PERMISSIVE"
  },
  {
    "cmd": "UPDATE",
    "qual": "is_tenant_admin(tenant_id)",
    "check": "is_tenant_admin(tenant_id)",
    "roles": [
      "authenticated"
    ],
    "table": "incident_responsible",
    "policy": "agvlog_update_authenticated",
    "permissive": "PERMISSIVE"
  }
]$policies$::jsonb;
  expected_functions constant jsonb := $context$[
  {
    "signature": "auth.jwt()",
    "sourceSignature": "auth.jwt()",
    "definition": "CREATE OR REPLACE FUNCTION auth.jwt()\n RETURNS jsonb\n LANGUAGE sql\n STABLE\nAS $function$\n  select \n    coalesce(\n        nullif(current_setting('request.jwt.claim', true), ''),\n        nullif(current_setting('request.jwt.claims', true), '')\n    )::jsonb\n$function$\n",
    "bodyMd5": "2db09c3fc855ba90e71d3ae28cfadae3",
    "acl": [
      "=X/supabase_auth_admin",
      "supabase_auth_admin=X/supabase_auth_admin",
      "postgres=X/supabase_auth_admin",
      "dashboard_user=X/supabase_auth_admin"
    ],
    "ownerName": "supabase_auth_admin"
  },
  {
    "signature": "auth.uid()",
    "sourceSignature": "auth.uid()",
    "definition": "CREATE OR REPLACE FUNCTION auth.uid()\n RETURNS uuid\n LANGUAGE sql\n STABLE\nAS $function$\n  select \n  coalesce(\n    nullif(current_setting('request.jwt.claim.sub', true), ''),\n    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')\n  )::uuid\n$function$\n",
    "bodyMd5": "cdef18c69c4f4cbbced2eaf81e628b49",
    "acl": [
      "=X/supabase_auth_admin",
      "supabase_auth_admin=X/supabase_auth_admin",
      "dashboard_user=X/supabase_auth_admin"
    ],
    "ownerName": "supabase_auth_admin"
  },
  {
    "signature": "private.is_request_tenant_member(uuid)",
    "sourceSignature": "private.is_request_tenant_member(uuid)",
    "definition": "CREATE OR REPLACE FUNCTION private.is_request_tenant_member(_tenant_id uuid)\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\n  select _tenant_id = private.request_tenant_id()\n    and private.user_can_access_tenant(auth.uid(), _tenant_id);\n$function$\n",
    "bodyMd5": "27bf2e71e1cf52212ac213a23de03dd7",
    "acl": [
      "postgres=X/postgres",
      "authenticated=X/postgres",
      "service_role=X/postgres"
    ],
    "ownerName": "postgres"
  },
  {
    "signature": "private.request_tenant_id()",
    "sourceSignature": "private.request_tenant_id()",
    "definition": "CREATE OR REPLACE FUNCTION private.request_tenant_id()\n RETURNS uuid\n LANGUAGE plpgsql\n STABLE\n SET search_path TO ''\nAS $function$\ndeclare\n  v_headers jsonb;\n  v_header_raw text;\n  v_claim_raw text;\n  v_raw text;\nbegin\n  begin\n    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;\n  exception\n    when invalid_text_representation then\n      raise exception 'tenant_context_invalid_headers' using errcode = '22023';\n  end;\n\n  v_header_raw := nullif(btrim(v_headers ->> 'x-agvlog-tenant-id'), '');\n  v_claim_raw := nullif(btrim(auth.jwt() ->> 'active_tenant_id'), '');\n\n  if v_header_raw is not null and v_claim_raw is not null and v_header_raw <> v_claim_raw then\n    raise exception 'tenant_context_claim_mismatch' using errcode = '42501';\n  end if;\n\n  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated' and v_claim_raw is null then\n    raise exception 'tenant_context_claim_required' using errcode = '42501';\n  end if;\n\n  v_raw := coalesce(v_header_raw, v_claim_raw);\n  if v_raw is null then\n    raise exception 'tenant_context_required' using errcode = '22023';\n  end if;\n\n  begin\n    return v_raw::uuid;\n  exception\n    when invalid_text_representation then\n      raise exception 'tenant_context_invalid' using errcode = '22023';\n  end;\nend;\n$function$\n",
    "bodyMd5": "30c8d3e555172654bcb761b0a189eac2",
    "acl": [
      "postgres=X/postgres",
      "authenticated=X/postgres",
      "service_role=X/postgres"
    ],
    "ownerName": "postgres"
  },
  {
    "signature": "private.user_can_access_tenant(uuid,uuid)",
    "sourceSignature": "private.user_can_access_tenant(uuid,uuid)",
    "definition": "CREATE OR REPLACE FUNCTION private.user_can_access_tenant(_user_id uuid, _tenant_id uuid)\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\n  select exists (\n    select 1\n    from public.tenant_memberships tm\n    where tm.user_id = _user_id\n      and tm.tenant_id = _tenant_id\n      and tm.active\n  ) or exists (\n    select 1\n    from public.client_portal_access cpa\n    where cpa.user_id = _user_id\n      and cpa.tenant_id = _tenant_id\n      and cpa.active\n  );\n$function$\n",
    "bodyMd5": "dce939739de87bf3dbf8be673ba30187",
    "acl": [
      "postgres=X/postgres",
      "authenticated=X/postgres",
      "service_role=X/postgres"
    ],
    "ownerName": "postgres"
  },
  {
    "signature": "public.is_tenant_admin(uuid)",
    "sourceSignature": "is_tenant_admin(uuid)",
    "definition": "CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant_id uuid)\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\n  select exists (\n    select 1\n    from public.tenant_memberships membership\n    where membership.user_id = auth.uid()\n      and membership.tenant_id = _tenant_id\n      and membership.role::text in ('owner', 'admin')\n      and membership.active\n  );\n$function$\n",
    "bodyMd5": "495068d5fd73ba2559f4a676d1f193b0",
    "acl": [
      "authenticated=X/postgres",
      "postgres=X/postgres",
      "service_role=X/postgres"
    ],
    "ownerName": "postgres"
  },
  {
    "signature": "public.is_tenant_member(uuid)",
    "sourceSignature": "is_tenant_member(uuid)",
    "definition": "CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant_id uuid)\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\n  select exists (\n    select 1\n    from public.tenant_memberships membership\n    where membership.user_id = auth.uid()\n      and membership.tenant_id = _tenant_id\n      and membership.active\n  );\n$function$\n",
    "bodyMd5": "9dc8218defa0226b77bcb3d8b6718fcb",
    "acl": [
      "authenticated=X/postgres",
      "postgres=X/postgres",
      "service_role=X/postgres"
    ],
    "ownerName": "postgres"
  },
  {
    "signature": "public.is_tenant_operator_or_admin(uuid)",
    "sourceSignature": "is_tenant_operator_or_admin(uuid)",
    "definition": "CREATE OR REPLACE FUNCTION public.is_tenant_operator_or_admin(_tenant_id uuid)\n RETURNS boolean\n LANGUAGE sql\n STABLE SECURITY DEFINER\n SET search_path TO ''\nAS $function$\n  select exists (\n    select 1\n    from public.tenant_memberships membership\n    where membership.user_id = auth.uid()\n      and membership.tenant_id = _tenant_id\n      and membership.active\n      and membership.role::text in ('owner', 'admin', 'operator')\n  );\n$function$\n",
    "bodyMd5": "12a3da73dd45088c8adb6cc208c8b88c",
    "acl": [
      "authenticated=X/postgres",
      "postgres=X/postgres",
      "service_role=X/postgres"
    ],
    "ownerName": "postgres"
  }
]$context$::jsonb;
  helper_body constant text := $body$
declare
  v_user uuid := auth.uid();
  v_workspace uuid;
begin
  if v_user is null or _tenant is null or _employee is null
    or coalesce(auth.jwt()->>'role','') <> 'authenticated' then return false; end if;
  if not coalesce(private.is_request_tenant_member(_tenant),false)
    or not coalesce(public.is_tenant_member(_tenant),false) then return false; end if;
  select t.workspace_id into v_workspace from public.tenants t where t.id=_tenant;
  if v_workspace is null
    or nullif(auth.jwt()->>'active_workspace_id','')::uuid is distinct from v_workspace then return false; end if;
  return exists(
    select 1 from public.employees e
    join public.tenant_memberships tm on tm.tenant_id=e.tenant_id and tm.user_id=v_user
    where e.id=_employee and e.tenant_id=_tenant and e.workspace_id=v_workspace
      and e.user_id=v_user and e.status='active' and tm.active
      and tm.role::text in('owner','admin','operator','driver')
  );
end;
$body$;
  helper_hash constant text := 'a248443c43a6a42547776e4dd79de03c';
  helper regprocedure;
  before_graph jsonb;
  after_graph jsonb;
  expected jsonb;
  actual record;
  ir_snapshot boolean;
  old_qual text;
  new_qual text;
  ir_post text;
  action_post text := '(is_tenant_operator_or_admin(tenant_id) OR private.is_assigned_incident_employee_v1(tenant_id, employee_id))';
  state_old integer:=0;
  state_post integer:=0;
begin
  perform set_config('lock_timeout','3s',true);
  perform set_config('statement_timeout','30s',true);
  if md5(helper_body) is distinct from helper_hash then raise exception 'a6_helper_source_hash_changed'; end if;
  if not exists(select 1 from pg_namespace n join pg_roles r on r.oid=n.nspowner
    where n.nspname='private' and r.rolname='postgres')
    or not has_schema_privilege('authenticated','private','USAGE') then raise exception 'a6_private_schema_changed'; end if;
  if exists(select 1 from pg_class c join pg_roles r on r.oid=c.relowner
    where c.oid in('public.employees'::regclass,'public.incident_responsible'::regclass,
      'public.employee_incident_actions'::regclass) and (not c.relrowsecurity or r.rolname<>'postgres')) then
    raise exception 'a6_rls_or_table_owner_changed';
  end if;
  if not exists(select 1 from pg_attribute where attrelid='public.employees'::regclass
      and attname='status' and atttypid='text'::regtype and attnotnull and not attisdropped)
    or not exists(select 1 from pg_attribute where attrelid='public.employees'::regclass
      and attname='workspace_id' and atttypid='uuid'::regtype and attnotnull and not attisdropped) then
    raise exception 'a6_employee_binding_schema_changed';
  end if;
  for actual in select * from (values
    ('private.request_tenant_id()','30c8d3e555172654bcb761b0a189eac2'),
    ('private.is_request_tenant_member(uuid)','27bf2e71e1cf52212ac213a23de03dd7'),
    ('private.user_can_access_tenant(uuid,uuid)','dce939739de87bf3dbf8be673ba30187'),
    ('public.is_tenant_member(uuid)','9dc8218defa0226b77bcb3d8b6718fcb'),
    ('public.is_tenant_operator_or_admin(uuid)','12a3da73dd45088c8adb6cc208c8b88c'),
    ('auth.uid()','cdef18c69c4f4cbbced2eaf81e628b49'),
    ('auth.jwt()','2db09c3fc855ba90e71d3ae28cfadae3')
  ) p(signature,body_hash) loop
    if (select md5(prosrc) from pg_proc where oid=to_regprocedure(actual.signature)) is distinct from actual.body_hash then
      raise exception 'a6_authorization_predecessor_changed: %',actual.signature;
    end if;
  end loop;
  for expected in select value from jsonb_array_elements(expected_functions) loop
    if (select pg_get_functiondef(p.oid) from pg_proc p where p.oid=to_regprocedure(expected->>'signature'))
        is distinct from expected->>'definition'
      or (select r.rolname from pg_proc p join pg_roles r on r.oid=p.proowner
        where p.oid=to_regprocedure(expected->>'signature')) is distinct from expected->>'ownerName'
      or (select to_jsonb(array(select a::text from unnest(p.proacl) a order by a::text))
        from pg_proc p where p.oid=to_regprocedure(expected->>'signature'))
        is distinct from (select jsonb_agg(value order by value) from jsonb_array_elements(expected->'acl')) then
      raise exception 'a6_authorization_metadata_or_acl_changed: %',expected->>'signature';
    end if;
  end loop;
  if exists(select 1 from pg_attribute where attrelid='public.incident_responsible'::regclass
    and attname='assigned_user_id' and atttypid<>'uuid'::regtype and not attisdropped) then
    raise exception 'a6_assignment_snapshot_schema_changed';
  end if;
  ir_snapshot:=exists(select 1 from pg_attribute where attrelid='public.incident_responsible'::regclass
    and attname='assigned_user_id' and atttypid='uuid'::regtype and not attisdropped);
  ir_post:=case when ir_snapshot then '(is_tenant_operator_or_admin(tenant_id) OR ((assigned_user_id = ( SELECT auth.uid() AS uid)) AND private.is_assigned_incident_employee_v1(tenant_id, employee_id)))'
    else action_post end;
  -- Exact captured native policy predecessor, preserving roles/commands/mode/check.
  if (select count(*) from pg_policies where schemaname='public'
    and tablename in('employees','incident_responsible','employee_incident_actions'))<>jsonb_array_length(expected_policies) then
    raise exception 'a6_policy_catalog_count_changed';
  end if;
  for expected in select value from jsonb_array_elements(expected_policies) loop
    select * into actual from pg_policies where schemaname='public'
      and tablename=expected->>'table' and policyname=expected->>'policy';
    if not found or actual.cmd is distinct from expected->>'cmd'
      or actual.permissive is distinct from expected->>'permissive'
      or to_jsonb(actual.roles) is distinct from expected->'roles'
      or actual.with_check is distinct from expected->>'check' then raise exception 'a6_policy_metadata_changed'; end if;
    old_qual:=expected->>'qual';
    if actual.tablename='incident_responsible' and actual.policyname='Assigned employees and operators can view incident_responsible' then
      if ir_snapshot then
        old_qual:=replace(old_qual,'OR (is_tenant_member(tenant_id)',
          'OR ((assigned_user_id = ( SELECT auth.uid() AS uid)) AND is_tenant_member(tenant_id)');
      end if;
      new_qual:=ir_post;
    elsif actual.tablename='employee_incident_actions' and actual.policyname='eia_select' then new_qual:=action_post;
    else new_qual:=null; end if;
    if new_qual is null then
      if regexp_replace(actual.qual,'\s','','g') is distinct from regexp_replace(old_qual,'\s','','g') then
        raise exception 'a6_protected_policy_changed: %.%',actual.tablename,actual.policyname; end if;
    elsif regexp_replace(actual.qual,'\s','','g')=regexp_replace(old_qual,'\s','','g') then state_old:=state_old+1;
    elsif regexp_replace(actual.qual,'\s','','g')=regexp_replace(new_qual,'\s','','g') then state_post:=state_post+1;
    else raise exception 'a6_select_policy_predecessor_changed: %.%',actual.tablename,actual.policyname; end if;
  end loop;
  if not(state_old=2 and state_post=0 or state_old=0 and state_post=2) then raise exception 'a6_mixed_policy_state'; end if;
  helper:=to_regprocedure('private.is_assigned_incident_employee_v1(uuid,uuid)');
  if helper is not null then
    if not exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner join pg_language l on l.oid=p.prolang
      where p.oid=helper and r.rolname='postgres' and l.lanname='plpgsql' and p.prosecdef
        and p.proconfig=array['search_path=""'] and p.prorettype='boolean'::regtype and not p.proretset
        and not p.proisstrict and not p.proleakproof and p.provolatile='s' and p.prokind='f'
        and p.pronargs=2 and p.pronargdefaults=0 and md5(p.prosrc)=helper_hash)
      or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where p.oid=helper and (a.grantee not in(p.proowner,'authenticated'::regrole::oid)
          or a.is_grantable or a.privilege_type<>'EXECUTE'))
      or not has_function_privilege('authenticated',helper,'EXECUTE') then raise exception 'a6_helper_metadata_or_acl_changed'; end if;
  elsif state_post=2 then raise exception 'a6_post_policy_helper_missing'; end if;
  select jsonb_build_object(
    'tables',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_class c where c.oid in('public.employees'::regclass,'public.incident_responsible'::regclass,'public.employee_incident_actions'::regclass)),
    'columns',(select jsonb_agg(to_jsonb(a) order by a.attrelid,a.attnum) from pg_attribute a where a.attrelid in('public.employees'::regclass,'public.incident_responsible'::regclass,'public.employee_incident_actions'::regclass)),
    'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c where c.conrelid in('public.employees'::regclass,'public.incident_responsible'::regclass,'public.employee_incident_actions'::regclass)),
    'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t where t.tgrelid in('public.employees'::regclass,'public.incident_responsible'::regclass,'public.employee_incident_actions'::regclass)),
    'policies',(select jsonb_agg(case when (p.polrelid='public.incident_responsible'::regclass and p.polname='Assigned employees and operators can view incident_responsible') or (p.polrelid='public.employee_incident_actions'::regclass and p.polname='eia_select') then to_jsonb(p)-'polqual' else to_jsonb(p) end order by p.oid) from pg_policy p where p.polrelid in('public.employees'::regclass,'public.incident_responsible'::regclass,'public.employee_incident_actions'::regclass)),
    'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p where p.oid in('private.request_tenant_id()'::regprocedure,'private.is_request_tenant_member(uuid)'::regprocedure,'private.user_can_access_tenant(uuid,uuid)'::regprocedure,'public.is_tenant_member(uuid)'::regprocedure,'public.is_tenant_operator_or_admin(uuid)'::regprocedure,'auth.uid()'::regprocedure,'auth.jwt()'::regprocedure))
  ) into before_graph;
  if helper is null then
    execute 'create function private.is_assigned_incident_employee_v1(_tenant uuid,_employee uuid) returns boolean language plpgsql stable security definer set search_path='''' as '||quote_literal(helper_body);
    alter function private.is_assigned_incident_employee_v1(uuid,uuid) owner to postgres;
    revoke all on function private.is_assigned_incident_employee_v1(uuid,uuid) from public,anon,authenticated,service_role;
    grant execute on function private.is_assigned_incident_employee_v1(uuid,uuid) to authenticated;
  end if;
  if state_old=2 then
    execute format('alter policy %I on public.incident_responsible using (%s)',
      'Assigned employees and operators can view incident_responsible',ir_post);
    execute format('alter policy eia_select on public.employee_incident_actions using (%s)',action_post);
  end if;
  helper:='private.is_assigned_incident_employee_v1(uuid,uuid)'::regprocedure;
  -- Validate first creation too: ALTER DEFAULT PRIVILEGES may add another grantee.
  if not exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner join pg_language l on l.oid=p.prolang
    where p.oid=helper and r.rolname='postgres' and l.lanname='plpgsql' and p.prosecdef
      and p.proconfig=array['search_path=""'] and p.prorettype='boolean'::regtype and not p.proretset
      and not p.proisstrict and not p.proleakproof and p.provolatile='s' and p.prokind='f'
      and p.pronargs=2 and p.pronargdefaults=0 and md5(p.prosrc)=helper_hash)
    or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=helper and (a.grantee not in(p.proowner,'authenticated'::regrole::oid)
        or a.is_grantable or a.privilege_type<>'EXECUTE'))
    or not has_function_privilege('authenticated',helper,'EXECUTE') then raise exception 'a6_helper_metadata_or_acl_changed'; end if;
  select jsonb_build_object(
    'tables',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_class c where c.oid in('public.employees'::regclass,'public.incident_responsible'::regclass,'public.employee_incident_actions'::regclass)),
    'columns',(select jsonb_agg(to_jsonb(a) order by a.attrelid,a.attnum) from pg_attribute a where a.attrelid in('public.employees'::regclass,'public.incident_responsible'::regclass,'public.employee_incident_actions'::regclass)),
    'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c where c.conrelid in('public.employees'::regclass,'public.incident_responsible'::regclass,'public.employee_incident_actions'::regclass)),
    'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t where t.tgrelid in('public.employees'::regclass,'public.incident_responsible'::regclass,'public.employee_incident_actions'::regclass)),
    'policies',(select jsonb_agg(case when (p.polrelid='public.incident_responsible'::regclass and p.polname='Assigned employees and operators can view incident_responsible') or (p.polrelid='public.employee_incident_actions'::regclass and p.polname='eia_select') then to_jsonb(p)-'polqual' else to_jsonb(p) end order by p.oid) from pg_policy p where p.polrelid in('public.employees'::regclass,'public.incident_responsible'::regclass,'public.employee_incident_actions'::regclass)),
    'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p where p.oid in('private.request_tenant_id()'::regprocedure,'private.is_request_tenant_member(uuid)'::regprocedure,'private.user_can_access_tenant(uuid,uuid)'::regprocedure,'public.is_tenant_member(uuid)'::regprocedure,'public.is_tenant_operator_or_admin(uuid)'::regprocedure,'auth.uid()'::regprocedure,'auth.jwt()'::regprocedure))
  ) into after_graph;
  if after_graph is distinct from before_graph
    or (select md5(prosrc) from pg_proc where oid='private.is_assigned_incident_employee_v1(uuid,uuid)'::regprocedure) is distinct from helper_hash
    or (select regexp_replace(qual,'\s','','g') from pg_policies where schemaname='public' and tablename='incident_responsible' and policyname='Assigned employees and operators can view incident_responsible') is distinct from regexp_replace(ir_post,'\s','','g')
    or (select regexp_replace(qual,'\s','','g') from pg_policies where schemaname='public' and tablename='employee_incident_actions' and policyname='eia_select') is distinct from regexp_replace(action_post,'\s','','g') then
    raise exception 'a6_catalog_postcondition_failed';
  end if;
end;
$a6$;
