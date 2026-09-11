-- Workspace administrators manage legal/fiscal tenants without weakening the
-- active-tenant boundary used by operational, document and finance tables.

create or replace function private.assert_workspace_tenant_admin_v1(_tenant_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if _tenant_id is null or _tenant_id is distinct from private.request_tenant_id() then
    raise exception 'active_tenant_context_mismatch' using errcode = '42501';
  end if;

  select t.workspace_id into v_workspace_id
  from public.tenants t
  where t.id = _tenant_id;

  if v_workspace_id is null
     or not public.is_tenant_admin(_tenant_id)
     or not private.is_workspace_admin(v_workspace_id) then
    raise exception 'workspace_admin_required' using errcode = '42501';
  end if;

  return v_workspace_id;
end;
$function$;

create or replace function private.normalize_company_profile_v1(_company jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_company jsonb := coalesce(_company, '{}'::jsonb);
  v_tax_id text;
begin
  if jsonb_typeof(v_company) <> 'object' then
    raise exception 'company_profile_invalid' using errcode = '22023';
  end if;

  v_tax_id := regexp_replace(coalesce(v_company ->> 'tax_id', ''), '[^0-9]', '', 'g');
  if v_tax_id <> '' and length(v_tax_id) <> 14 then
    raise exception 'company_tax_id_invalid' using errcode = '22023';
  end if;

  return jsonb_strip_nulls(v_company || jsonb_build_object(
    'tax_id', case when v_tax_id = '' then null else v_tax_id end,
    'legal_name', nullif(btrim(v_company ->> 'legal_name'), ''),
    'trade_name', nullif(btrim(v_company ->> 'trade_name'), '')
  ));
end;
$function$;

create or replace function private.insert_initial_tenant_emitter_v1(
  _tenant_id uuid,
  _emitter jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_emitter jsonb := coalesce(_emitter, '{}'::jsonb);
  v_cnpj text;
  v_razao_social text;
  v_emitter_id uuid;
begin
  if _emitter is null then
    return null;
  end if;
  if jsonb_typeof(v_emitter) <> 'object' then
    raise exception 'fiscal_emitter_invalid' using errcode = '22023';
  end if;

  v_cnpj := regexp_replace(coalesce(v_emitter ->> 'cnpj', ''), '[^0-9]', '', 'g');
  v_razao_social := nullif(btrim(v_emitter ->> 'razao_social'), '');
  if length(v_cnpj) <> 14 or v_razao_social is null then
    raise exception 'fiscal_emitter_required_fields' using errcode = '22023';
  end if;

  insert into public.tenant_emitters (
    tenant_id, branch_code, cnpj, razao_social, nome_fantasia, ie, im,
    regime_tributario, city_code, endereco, active, is_default
  ) values (
    _tenant_id,
    coalesce(nullif(btrim(v_emitter ->> 'branch_code'), ''), 'MATRIZ'),
    v_cnpj,
    v_razao_social,
    nullif(btrim(v_emitter ->> 'nome_fantasia'), ''),
    nullif(btrim(v_emitter ->> 'ie'), ''),
    nullif(btrim(v_emitter ->> 'im'), ''),
    nullif(btrim(v_emitter ->> 'regime_tributario'), ''),
    nullif(btrim(v_emitter ->> 'city_code'), ''),
    case when jsonb_typeof(v_emitter -> 'endereco') = 'object'
      then v_emitter -> 'endereco' else '{}'::jsonb end,
    true,
    true
  ) returning id into v_emitter_id;

  return v_emitter_id;
end;
$function$;

create or replace function public.list_workspace_tenants_v1(_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
begin
  v_workspace_id := private.assert_workspace_tenant_admin_v1(_tenant_id);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'workspace_id', t.workspace_id,
      'name', t.name,
      'plan_key', t.plan_key,
      'timezone', t.timezone,
      'company', coalesce(t.settings -> 'company', '{}'::jsonb),
      'emitters', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', e.id,
          'cnpj', e.cnpj,
          'razao_social', e.razao_social,
          'nome_fantasia', e.nome_fantasia,
          'branch_code', e.branch_code,
          'active', e.active,
          'is_default', e.is_default
        ) order by e.is_default desc, e.active desc, e.razao_social)
        from public.tenant_emitters e
        where e.tenant_id = t.id
      ), '[]'::jsonb)
    ) order by t.created_at, t.id)
    from public.tenants t
    where t.workspace_id = v_workspace_id
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.create_workspace_tenant_v1(
  _tenant_id uuid,
  _name text,
  _company jsonb default '{}'::jsonb,
  _timezone text default 'America/Sao_Paulo',
  _initial_emitter jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_new_tenant_id uuid;
  v_emitter_id uuid;
  v_company jsonb;
  v_name text := nullif(btrim(_name), '');
  v_timezone text := coalesce(nullif(btrim(_timezone), ''), 'America/Sao_Paulo');
  v_tax_id text;
begin
  v_workspace_id := private.assert_workspace_tenant_admin_v1(_tenant_id);
  if v_name is null then
    raise exception 'tenant_name_required' using errcode = '22023';
  end if;

  v_company := private.normalize_company_profile_v1(_company);
  v_tax_id := nullif(v_company ->> 'tax_id', '');
  if v_tax_id is not null and exists (
    select 1 from public.tenants t
    where t.workspace_id = v_workspace_id
      and regexp_replace(coalesce(t.settings -> 'company' ->> 'tax_id', ''), '[^0-9]', '', 'g') = v_tax_id
  ) then
    raise exception 'company_tax_id_already_registered' using errcode = '23505';
  end if;

  insert into public.tenants (workspace_id, name, plan_key, timezone, settings)
  select v_workspace_id, v_name, source.plan_key, v_timezone,
         jsonb_build_object('company', v_company)
  from public.tenants source
  where source.id = _tenant_id
  returning id into v_new_tenant_id;

  -- Workspace owners/admins can finish configuration immediately. Operational,
  -- driver and client access stays explicit per legal company.
  insert into public.tenant_memberships (tenant_id, user_id, role, active)
  select v_new_tenant_id, wm.user_id, wm.role, true
  from public.workspace_memberships wm
  where wm.workspace_id = v_workspace_id
    and wm.active
    and wm.role in ('owner', 'admin')
  on conflict (tenant_id, user_id) do update
  set role = excluded.role, active = true, updated_at = now();

  insert into public.tenant_memberships (tenant_id, user_id, role, active)
  values (v_new_tenant_id, auth.uid(), 'owner', true)
  on conflict (tenant_id, user_id) do update
  set role = 'owner', active = true, updated_at = now();

  v_emitter_id := private.insert_initial_tenant_emitter_v1(v_new_tenant_id, _initial_emitter);

  insert into public.entity_audit_log (
    tenant_id, entity_type, entity_id, action, new_data, actor_user_id, source
  ) values (
    v_new_tenant_id, 'tenant', v_new_tenant_id, 'workspace_tenant_created',
    jsonb_build_object('source_tenant_id', _tenant_id, 'workspace_id', v_workspace_id,
                       'default_emitter_id', v_emitter_id),
    auth.uid(), 'workspace_tenant_management'
  );

  return jsonb_build_object('tenant_id', v_new_tenant_id, 'default_emitter_id', v_emitter_id);
end;
$function$;

create or replace function public.update_workspace_tenant_v1(
  _tenant_id uuid,
  _target_tenant_id uuid,
  _name text,
  _company jsonb,
  _timezone text default 'America/Sao_Paulo'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
  v_company jsonb;
  v_name text := nullif(btrim(_name), '');
  v_tax_id text;
begin
  v_workspace_id := private.assert_workspace_tenant_admin_v1(_tenant_id);
  if v_name is null then raise exception 'tenant_name_required' using errcode = '22023'; end if;
  v_company := private.normalize_company_profile_v1(_company);
  v_tax_id := nullif(v_company ->> 'tax_id', '');

  if v_tax_id is not null and exists (
    select 1 from public.tenants t
    where t.workspace_id = v_workspace_id and t.id <> _target_tenant_id
      and regexp_replace(coalesce(t.settings -> 'company' ->> 'tax_id', ''), '[^0-9]', '', 'g') = v_tax_id
  ) then
    raise exception 'company_tax_id_already_registered' using errcode = '23505';
  end if;

  update public.tenants t
  set name = v_name,
      timezone = coalesce(nullif(btrim(_timezone), ''), t.timezone),
      settings = coalesce(t.settings, '{}'::jsonb) || jsonb_build_object('company', v_company)
  where t.id = _target_tenant_id and t.workspace_id = v_workspace_id;
  if not found then raise exception 'workspace_tenant_not_found' using errcode = '22023'; end if;

  insert into public.entity_audit_log (
    tenant_id, entity_type, entity_id, action, new_data, actor_user_id, source
  ) values (
    _target_tenant_id, 'tenant', _target_tenant_id, 'workspace_tenant_updated',
    jsonb_build_object('source_tenant_id', _tenant_id), auth.uid(), 'workspace_tenant_management'
  );
  return _target_tenant_id;
end;
$function$;

create or replace function public.set_workspace_tenant_default_emitter_v1(
  _tenant_id uuid,
  _target_tenant_id uuid,
  _emitter_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_workspace_id uuid;
begin
  v_workspace_id := private.assert_workspace_tenant_admin_v1(_tenant_id);
  if not exists (
    select 1 from public.tenants t
    where t.id = _target_tenant_id and t.workspace_id = v_workspace_id
  ) or not exists (
    select 1 from public.tenant_emitters e
    where e.id = _emitter_id and e.tenant_id = _target_tenant_id and e.active
  ) then
    raise exception 'active_emitter_not_found_in_workspace_tenant' using errcode = '22023';
  end if;

  perform e.id from public.tenant_emitters e
  where e.tenant_id = _target_tenant_id order by e.id for update;
  update public.tenant_emitters set is_default = (id = _emitter_id)
  where tenant_id = _target_tenant_id and (is_default or id = _emitter_id);

  insert into public.entity_audit_log (
    tenant_id, entity_type, entity_id, action, new_data, actor_user_id, source
  ) values (
    _target_tenant_id, 'tenant_emitter', _emitter_id, 'default_fiscal_emitter_changed',
    jsonb_build_object('source_tenant_id', _tenant_id), auth.uid(), 'workspace_tenant_management'
  );
  return _emitter_id;
end;
$function$;

revoke all on function private.assert_workspace_tenant_admin_v1(uuid),
                       private.normalize_company_profile_v1(jsonb),
                       private.insert_initial_tenant_emitter_v1(uuid, jsonb),
                       public.list_workspace_tenants_v1(uuid),
                       public.create_workspace_tenant_v1(uuid, text, jsonb, text, jsonb),
                       public.update_workspace_tenant_v1(uuid, uuid, text, jsonb, text),
                       public.set_workspace_tenant_default_emitter_v1(uuid, uuid, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.list_workspace_tenants_v1(uuid),
                          public.create_workspace_tenant_v1(uuid, text, jsonb, text, jsonb),
                          public.update_workspace_tenant_v1(uuid, uuid, text, jsonb, text),
                          public.set_workspace_tenant_default_emitter_v1(uuid, uuid, uuid)
to authenticated;
grant execute on function private.assert_workspace_tenant_admin_v1(uuid),
                          private.normalize_company_profile_v1(jsonb),
                          private.insert_initial_tenant_emitter_v1(uuid, jsonb),
                          public.list_workspace_tenants_v1(uuid),
                          public.create_workspace_tenant_v1(uuid, text, jsonb, text, jsonb),
                          public.update_workspace_tenant_v1(uuid, uuid, text, jsonb, text),
                          public.set_workspace_tenant_default_emitter_v1(uuid, uuid, uuid)
to service_role;

comment on function public.create_workspace_tenant_v1(uuid, text, jsonb, text, jsonb) is
  'Creates a legal/fiscal tenant inside the active workspace and optionally its first default emitter atomically.';
comment on function public.set_workspace_tenant_default_emitter_v1(uuid, uuid, uuid) is
  'Selects the active fiscal emitter for a workspace tenant without permitting a cross-tenant CNPJ.';
