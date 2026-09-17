do $preflight$
begin
  if to_regclass('public.cost_centers') is null
     or to_regclass('public.finance_expense_items') is null
     or to_regnamespace('private') is null
     or to_regprocedure('private.request_tenant_id()') is null
     or to_regprocedure('public.is_tenant_operator_or_admin(uuid)') is null then
    raise exception 'finance_cost_center_predecessor_missing' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    where procedure.oid = 'private.request_tenant_id()'::regprocedure
      and not procedure.prosecdef
      and procedure.provolatile = 's'
      and not procedure.proisstrict
      and procedure.proconfig = array['search_path=""']::text[]
      and md5(procedure.prosrc) = '30c8d3e555172654bcb761b0a189eac2'
  ) or not exists (
    select 1
    from pg_proc procedure
    where procedure.oid = 'public.is_tenant_operator_or_admin(uuid)'::regprocedure
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and not procedure.proisstrict
      and procedure.proconfig = array['search_path=""']::text[]
      and md5(procedure.prosrc) = '12a3da73dd45088c8adb6cc208c8b88c'
  ) then
    raise exception 'finance_cost_center_dependency_changed' using errcode = '55000';
  end if;

  if to_regprocedure('private.normalize_cost_center_name(text)') is not null
     or to_regprocedure('public.create_or_reactivate_cost_center_v1(uuid,text)') is not null
     or to_regclass('public.cost_centers_tenant_normalized_name_key') is not null
     or exists (
       select 1 from pg_constraint
       where conname in (
         'cost_centers_name_canonical_check',
         'cost_centers_tenant_id_id_key',
         'finance_expense_items_tenant_cost_center_fkey'
       )
     ) then
    raise exception 'finance_cost_center_target_state_already_exists' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_class relation
    join pg_attribute name_column
      on name_column.attrelid = relation.oid
     and name_column.attname = 'name'
     and name_column.attnum > 0
     and not name_column.attisdropped
    where relation.oid = 'public.cost_centers'::regclass
      and relation.relrowsecurity
      and name_column.attnotnull
  )
     or not has_schema_privilege('authenticated', 'private', 'usage')
     or not has_table_privilege('authenticated', 'public.cost_centers', 'select')
     or not has_table_privilege('authenticated', 'public.cost_centers', 'insert')
     or not has_table_privilege('authenticated', 'public.cost_centers', 'update')
     or not has_table_privilege('authenticated', 'public.cost_centers', 'delete')
     or has_table_privilege('anon', 'public.cost_centers', 'select')
     or has_table_privilege('anon', 'public.cost_centers', 'insert')
     or has_table_privilege('anon', 'public.cost_centers', 'update')
     or has_table_privilege('anon', 'public.cost_centers', 'delete') then
    raise exception 'finance_cost_center_security_contract_changed' using errcode = '55000';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'cost_centers') <> 5
     or not exists (
       select 1 from pg_policies
       where schemaname = 'public' and tablename = 'cost_centers'
         and policyname = 'agvlog_active_tenant_context'
         and permissive = 'RESTRICTIVE' and cmd = 'ALL'
         and roles::text = '{authenticated}'
         and qual = 'private.is_request_tenant_member(tenant_id)'
         and with_check = 'private.is_request_tenant_member(tenant_id)'
     )
     or not exists (
       select 1 from pg_policies
       where schemaname = 'public' and tablename = 'cost_centers'
         and policyname = 'agvlog_select_authenticated'
         and permissive = 'PERMISSIVE' and cmd = 'SELECT'
         and roles::text = '{authenticated}'
         and qual = 'is_tenant_operator_or_admin(tenant_id)' and with_check is null
     )
     or not exists (
       select 1 from pg_policies
       where schemaname = 'public' and tablename = 'cost_centers'
         and policyname = 'agvlog_insert_authenticated'
         and permissive = 'PERMISSIVE' and cmd = 'INSERT'
         and roles::text = '{authenticated}'
         and qual is null and with_check = 'is_tenant_operator_or_admin(tenant_id)'
     )
     or not exists (
       select 1 from pg_policies
       where schemaname = 'public' and tablename = 'cost_centers'
         and policyname = 'agvlog_update_authenticated'
         and permissive = 'PERMISSIVE' and cmd = 'UPDATE'
         and roles::text = '{authenticated}'
         and qual = 'is_tenant_operator_or_admin(tenant_id)'
         and with_check = 'is_tenant_operator_or_admin(tenant_id)'
     )
     or not exists (
       select 1 from pg_policies
       where schemaname = 'public' and tablename = 'cost_centers'
         and policyname = 'agvlog_delete_authenticated'
         and permissive = 'PERMISSIVE' and cmd = 'DELETE'
         and roles::text = '{authenticated}'
         and qual = 'is_tenant_operator_or_admin(tenant_id)' and with_check is null
     ) then
    raise exception 'finance_cost_center_policy_contract_changed' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_record
    where constraint_record.conrelid = 'public.finance_expense_items'::regclass
      and constraint_record.conname = 'finance_expense_items_cost_center_id_fkey'
      and constraint_record.contype = 'f'
      and constraint_record.convalidated
      and pg_get_constraintdef(constraint_record.oid, true) =
        'FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id)'
  ) or not exists (
    select 1
    from pg_attribute tenant_column
    join pg_attribute center_column
      on center_column.attrelid = tenant_column.attrelid
    where tenant_column.attrelid = 'public.finance_expense_items'::regclass
      and tenant_column.attname = 'tenant_id'
      and tenant_column.atttypid = 'uuid'::regtype
      and tenant_column.attnotnull
      and center_column.attname = 'cost_center_id'
      and center_column.atttypid = 'uuid'::regtype
      and not center_column.attnotnull
      and tenant_column.attnum > 0 and not tenant_column.attisdropped
      and center_column.attnum > 0 and not center_column.attisdropped
  ) then
    raise exception 'finance_cost_center_link_contract_changed' using errcode = '55000';
  end if;
end
$preflight$;

create function private.normalize_cost_center_name(_name text)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $function$
  select btrim(
    _name,
    chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32) ||
    chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) ||
    chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
    chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) ||
    chr(8239) || chr(8287) || chr(12288) || chr(65279)
  )
$function$;

revoke all on function private.normalize_cost_center_name(text)
  from public, anon, authenticated, service_role;
grant execute on function private.normalize_cost_center_name(text)
  to authenticated, service_role;

do $data_preflight$
begin

  if exists (
    select 1
    from public.cost_centers
    where name is distinct from private.normalize_cost_center_name(name)
       or length(name) not between 1 and 200
  ) then
    raise exception 'finance_cost_center_name_cleanup_required' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.cost_centers
    group by tenant_id, lower(private.normalize_cost_center_name(name))
    having count(*) > 1
  ) then
    raise exception 'finance_cost_center_duplicate_cleanup_required' using errcode = '55000';
  end if;

  if exists (
    select 1
    from public.finance_expense_items expense
    join public.cost_centers center on center.id = expense.cost_center_id
    where center.tenant_id is distinct from expense.tenant_id
  ) then
    raise exception 'finance_cost_center_cross_tenant_cleanup_required' using errcode = '55000';
  end if;
end
$data_preflight$;

alter table public.cost_centers
  add constraint cost_centers_name_canonical_check
  check (name = private.normalize_cost_center_name(name) and length(name) between 1 and 200)
  not valid;

alter table public.cost_centers
  validate constraint cost_centers_name_canonical_check;

create unique index cost_centers_tenant_normalized_name_key
  on public.cost_centers (tenant_id, lower(private.normalize_cost_center_name(name)));

alter table public.cost_centers
  add constraint cost_centers_tenant_id_id_key unique (tenant_id, id);

create index finance_expense_items_tenant_cost_center_idx
  on public.finance_expense_items (tenant_id, cost_center_id)
  where cost_center_id is not null;

alter table public.finance_expense_items
  add constraint finance_expense_items_tenant_cost_center_fkey
  foreign key (tenant_id, cost_center_id)
  references public.cost_centers (tenant_id, id)
  on update restrict
  on delete restrict
  not valid;

alter table public.finance_expense_items
  validate constraint finance_expense_items_tenant_cost_center_fkey;

alter table public.finance_expense_items
  drop constraint finance_expense_items_cost_center_id_fkey;

create function public.create_or_reactivate_cost_center_v1(
  _tenant_id uuid,
  _name text
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_name text := private.normalize_cost_center_name(_name);
  v_status text;
  v_center public.cost_centers%rowtype;
begin
  if v_actor is null
     or _tenant_id is null
     or private.request_tenant_id() is distinct from _tenant_id
     or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'finance_cost_center_not_authorized' using errcode = '42501';
  end if;

  if v_name is null or length(v_name) not between 1 and 200 then
    raise exception 'finance_cost_center_invalid_name' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(_tenant_id::text || ':cost-centers', 0));

  if auth.uid() is distinct from v_actor
     or private.request_tenant_id() is distinct from _tenant_id
     or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'finance_cost_center_not_authorized' using errcode = '42501';
  end if;

  select center.*
  into v_center
  from public.cost_centers center
  where center.tenant_id = _tenant_id
    and lower(private.normalize_cost_center_name(center.name)) = lower(v_name)
  order by center.id
  limit 1
  for update;

  if found then
    if v_center.active then
      v_status := 'already_active';
    else
      update public.cost_centers
      set active = true,
          updated_at = clock_timestamp()
      where tenant_id = _tenant_id
        and id = v_center.id
      returning * into v_center;
      v_status := 'reactivated';
    end if;
  else
    begin
      insert into public.cost_centers (tenant_id, name)
      values (_tenant_id, v_name)
      returning * into v_center;
      v_status := 'created';
    exception
      when unique_violation then
        select center.*
        into v_center
        from public.cost_centers center
        where center.tenant_id = _tenant_id
          and lower(private.normalize_cost_center_name(center.name)) = lower(v_name)
        order by center.id
        limit 1
        for update;

        if not found then
          raise;
        end if;

        if v_center.active then
          v_status := 'already_active';
        else
          update public.cost_centers
          set active = true,
              updated_at = clock_timestamp()
          where tenant_id = _tenant_id
            and id = v_center.id
          returning * into v_center;
          v_status := 'reactivated';
        end if;
    end;
  end if;

  return jsonb_build_object(
    'version', 1,
    'tenant_id', _tenant_id,
    'actor_id', v_actor,
    'status', v_status,
    'confirmed', true,
    'cost_center', jsonb_build_object(
      'id', v_center.id,
      'tenant_id', v_center.tenant_id,
      'name', v_center.name,
      'active', v_center.active,
      'created_at', v_center.created_at,
      'updated_at', v_center.updated_at
    )
  );
end
$function$;

revoke all on function public.create_or_reactivate_cost_center_v1(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_or_reactivate_cost_center_v1(uuid, text)
  to authenticated;

comment on function public.create_or_reactivate_cost_center_v1(uuid, text) is
  'Creates or reactivates one canonical tenant-scoped cost center atomically. It never changes cash, obligations, or fiscal documents.';

comment on function private.normalize_cost_center_name(text) is
  'Trims the ECMAScript whitespace set used by the browser before enforcing cost-center identity.';

do $postflight$
begin
  if not exists (
    select 1
    from pg_proc procedure
    where procedure.oid = 'private.normalize_cost_center_name(text)'::regprocedure
      and not procedure.prosecdef
      and procedure.provolatile = 'i'
      and procedure.proisstrict
      and procedure.proconfig = array['search_path=""']::text[]
  )
     or not has_function_privilege('authenticated', 'private.normalize_cost_center_name(text)', 'execute')
     or not has_function_privilege('service_role', 'private.normalize_cost_center_name(text)', 'execute')
     or has_function_privilege('anon', 'private.normalize_cost_center_name(text)', 'execute')
     or has_function_privilege('public', 'private.normalize_cost_center_name(text)', 'execute') then
    raise exception 'finance_cost_center_normalizer_postflight_failed' using errcode = '55000';
  end if;

  if not exists (
    select 1
    from pg_proc procedure
    where procedure.oid = 'public.create_or_reactivate_cost_center_v1(uuid,text)'::regprocedure
      and not procedure.prosecdef
      and procedure.provolatile = 'v'
      and not procedure.proisstrict
      and procedure.proconfig = array['search_path=""']::text[]
  )
     or not has_function_privilege('authenticated', 'public.create_or_reactivate_cost_center_v1(uuid,text)', 'execute')
     or has_function_privilege('anon', 'public.create_or_reactivate_cost_center_v1(uuid,text)', 'execute')
     or has_function_privilege('service_role', 'public.create_or_reactivate_cost_center_v1(uuid,text)', 'execute')
     or has_function_privilege('public', 'public.create_or_reactivate_cost_center_v1(uuid,text)', 'execute') then
    raise exception 'finance_cost_center_rpc_postflight_failed' using errcode = '55000';
  end if;

  if to_regclass('public.cost_centers_tenant_normalized_name_key') is null
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.cost_centers'::regclass
         and conname in ('cost_centers_name_canonical_check', 'cost_centers_tenant_id_id_key')
         and convalidated
       group by conrelid having count(*) = 2
     )
     or not exists (
       select 1 from pg_constraint
       where conrelid = 'public.finance_expense_items'::regclass
         and conname = 'finance_expense_items_tenant_cost_center_fkey'
         and contype = 'f' and convalidated
         and pg_get_constraintdef(oid, true) =
           'FOREIGN KEY (tenant_id, cost_center_id) REFERENCES cost_centers(tenant_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT'
     )
     or exists (
       select 1 from pg_constraint
       where conrelid = 'public.finance_expense_items'::regclass
         and conname = 'finance_expense_items_cost_center_id_fkey'
     ) then
    raise exception 'finance_cost_center_constraints_postflight_failed' using errcode = '55000';
  end if;
end
$postflight$;
