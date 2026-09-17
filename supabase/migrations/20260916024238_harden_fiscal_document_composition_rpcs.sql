-- Close the document-composition BOLA surface without breaking the two
-- compatibility RPCs still used by browser bundles.  The v1 functions have no
-- remaining caller and are made owner-only.  The v2 functions retain their
-- signatures, but now authorize the authenticated actor before entering the
-- privileged composition implementation.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $preflight$
declare
  contract record;
begin
  for contract in
    select * from (values
      ('public._change_load_documents(uuid,uuid,uuid[],text,jsonb,text,text)', '8821275d0393e6b3599e84aceefd663b'),
      ('public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])', '73793256599bf96b8232ddc15a68d166'),
      ('public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])', '6ee516b30bc6d8fb5acdfd3a7820c9a4'),
      ('public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])', '151cc5f78065f8cbce15464d9d088933'),
      ('public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])', 'c2220961533993d755e6cae225c402ca'),
      ('public.is_tenant_operator_or_admin(uuid)', '682f66029dc9bb798f9f329b4e8f95aa')
    ) expected(signature, definition_hash)
  loop
    if to_regprocedure(contract.signature) is null
      or md5(replace(
        pg_get_functiondef(to_regprocedure(contract.signature)),
        E'\r\n',
        E'\n'
      )) is distinct from contract.definition_hash then
      raise exception 'fiscal_document_composition_contract_changed: %', contract.signature;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])', 'execute')
    or has_function_privilege('anon', 'public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])', 'execute')
    or has_function_privilege('anon', 'public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])', 'execute')
    or has_function_privilege('anon', 'public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])', 'execute')
    or not has_function_privilege('authenticated', 'public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])', 'execute')
    or not has_function_privilege('authenticated', 'public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])', 'execute')
    or not has_function_privilege('authenticated', 'public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])', 'execute')
    or not has_function_privilege('authenticated', 'public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])', 'execute')
    or not has_function_privilege('service_role', 'public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])', 'execute')
    or has_function_privilege('service_role', 'public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])', 'execute')
    or not has_function_privilege('service_role', 'public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])', 'execute')
    or has_function_privilege('service_role', 'public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])', 'execute') then
    raise exception 'fiscal_document_composition_acl_changed';
  end if;
end;
$preflight$;

create or replace function public.assign_fiscal_documents_to_load_v2(
  _tenant_id uuid,
  _load_id uuid,
  _document_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  perform 1
  from public.tenant_memberships
  where tenant_id = _tenant_id
    and user_id = auth.uid()
    and active
    and role::text in ('owner', 'admin', 'operator')
  for share;
  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return public._change_load_documents(
    _tenant_id,
    _load_id,
    _document_ids,
    'attach',
    null,
    'Inclusão pela operação',
    null
  );
end;
$function$;

create or replace function public.remove_fiscal_documents_from_load_v2(
  _tenant_id uuid,
  _load_id uuid,
  _document_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null
    or not coalesce(public.is_tenant_operator_or_admin(_tenant_id), false) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  perform 1
  from public.tenant_memberships
  where tenant_id = _tenant_id
    and user_id = auth.uid()
    and active
    and role::text in ('owner', 'admin', 'operator')
  for share;
  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return public._change_load_documents(
    _tenant_id,
    _load_id,
    _document_ids,
    'detach',
    null,
    'Remoção pela operação',
    null
  );
end;
$function$;

revoke all on function public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])
  from public, anon, authenticated, service_role;

grant execute on function public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])
  to authenticated;
grant execute on function public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])
  to authenticated;

comment on function public.assign_fiscal_documents_to_load(uuid,uuid,uuid[]) is
  'Owner-only legacy implementation. Use change_load_documents_v2(jsonb); the authenticated v2 compatibility RPC is tenant-scoped.';
comment on function public.remove_fiscal_documents_from_load(uuid,uuid,uuid[]) is
  'Owner-only legacy implementation. Use change_load_documents_v2(jsonb); the authenticated v2 compatibility RPC is tenant-scoped.';
comment on function public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[]) is
  'Tenant-authorized compatibility RPC. New clients must use change_load_documents_v2(jsonb).';
comment on function public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[]) is
  'Tenant-authorized compatibility RPC. New clients must use change_load_documents_v2(jsonb).';

do $postcondition$
begin
  if has_function_privilege('anon', 'public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])', 'execute')
    or has_function_privilege('anon', 'public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])', 'execute')
    or has_function_privilege('authenticated', 'public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])', 'execute')
    or has_function_privilege('authenticated', 'public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])', 'execute')
    or has_function_privilege('service_role', 'public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])', 'execute')
    or has_function_privilege('service_role', 'public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])', 'execute')
    or has_function_privilege('service_role', 'public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])', 'execute')
    or has_function_privilege('service_role', 'public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])', 'execute')
    or not has_function_privilege('authenticated', 'public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])', 'execute')
    or not has_function_privilege('authenticated', 'public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])', 'execute')
    or position('auth.uid() is null' in pg_get_functiondef(
      'public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])'::regprocedure
    )) = 0
    or position('tenant_memberships' in pg_get_functiondef(
      'public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])'::regprocedure
    )) = 0
    or position('auth.uid() is null' in pg_get_functiondef(
      'public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])'::regprocedure
    )) = 0
    or position('tenant_memberships' in pg_get_functiondef(
      'public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])'::regprocedure
    )) = 0 then
    raise exception 'fiscal_document_composition_acl_postcondition_failed';
  end if;
end;
$postcondition$;
