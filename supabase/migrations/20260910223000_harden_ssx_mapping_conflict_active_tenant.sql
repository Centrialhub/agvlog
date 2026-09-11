set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $migration$
declare
  v_list_body text;
  v_resolve_body text;
  v_list_anchor text;
  v_resolve_select_anchor text;
begin
  if pg_catalog.to_regprocedure(
      'public.list_ssx_mapping_conflicts_v1(uuid,text,integer,integer)'
    ) is null
    or pg_catalog.to_regprocedure(
      'public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text)'
    ) is null
    or pg_catalog.to_regprocedure('private.request_tenant_id()') is null then
    raise exception 'ssx_mapping_conflict_active_tenant_prerequisites_missing';
  end if;

  select replace(
    pg_catalog.pg_get_functiondef(
      'public.list_ssx_mapping_conflicts_v1(uuid,text,integer,integer)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  ) into v_list_body;
  v_list_anchor :=
    E'begin\n  if not public.is_tenant_operator_or_admin(_tenant_id) then';
  if position(v_list_anchor in v_list_body) = 0 then
    raise exception 'ssx_mapping_conflict_list_contract_changed';
  end if;
  v_list_body := replace(
    v_list_body,
    v_list_anchor,
    E'begin\n  if auth.uid() is null'
      || E' or private.request_tenant_id() is distinct from _tenant_id then\n'
      || E'    raise exception ''not_authorized'' using errcode = ''42501'';\n'
      || E'  end if;\n'
      || E'  if not public.is_tenant_operator_or_admin(_tenant_id) then'
  );
  execute v_list_body;

  select replace(
    pg_catalog.pg_get_functiondef(
      'public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  ) into v_resolve_body;
  v_resolve_select_anchor :=
    E'  from public.ssx_mapping_conflicts\n'
      || E'  where id = _conflict_id\n'
      || E'  for update;';
  if position(v_resolve_select_anchor in v_resolve_body) = 0 then
    raise exception 'ssx_mapping_conflict_resolve_contract_changed';
  end if;
  v_resolve_body := replace(
    v_resolve_body,
    v_resolve_select_anchor,
    E'  from public.ssx_mapping_conflicts\n'
      || E'  where id = _conflict_id\n'
      || E'    and tenant_id = private.request_tenant_id()\n'
      || E'  for update;'
  );
  execute v_resolve_body;
end;
$migration$;

revoke all on function public.list_ssx_mapping_conflicts_v1(uuid,text,integer,integer)
  from public, anon;
revoke all on function public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text)
  from public, anon;
grant execute on function public.list_ssx_mapping_conflicts_v1(uuid,text,integer,integer)
  to authenticated;
grant execute on function public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text)
  to authenticated;

do $postcondition$
declare
  v_list_body text := pg_catalog.pg_get_functiondef(
    'public.list_ssx_mapping_conflicts_v1(uuid,text,integer,integer)'::regprocedure
  );
  v_resolve_body text := pg_catalog.pg_get_functiondef(
    'public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text)'::regprocedure
  );
begin
  if position('private.request_tenant_id()' in v_list_body) = 0
    or position('private.request_tenant_id()' in v_resolve_body) = 0
    or pg_catalog.has_function_privilege(
      'anon',
      'public.list_ssx_mapping_conflicts_v1(uuid,text,integer,integer)',
      'execute'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text)',
      'execute'
    )
    or not pg_catalog.has_function_privilege(
      'authenticated',
      'public.list_ssx_mapping_conflicts_v1(uuid,text,integer,integer)',
      'execute'
    )
    or not pg_catalog.has_function_privilege(
      'authenticated',
      'public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text)',
      'execute'
    ) then
    raise exception 'ssx_mapping_conflict_active_tenant_postcondition_failed';
  end if;
end;
$postcondition$;

comment on function public.list_ssx_mapping_conflicts_v1(uuid,text,integer,integer)
is 'Lists SSX mapping conflicts only for the active request tenant and an authorized operational member.';
comment on function public.resolve_ssx_mapping_conflict_v1(uuid,uuid,text)
is 'Resolves an SSX mapping conflict only when its tenant matches the active request tenant.';
