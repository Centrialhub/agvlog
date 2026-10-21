begin;

-- Reservation is service-only. Identity comes from the canonical person links,
-- never from a matching name/CPF or a client-supplied list of companies.
create or replace function private.driver_workspace_creation_scope_v1(_tenant uuid,_actor uuid,_driver uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_person uuid;v_workspace uuid;v_ids jsonb;v_tenants jsonb;v_count integer;
begin
  select l.workspace_person_id,l.workspace_id into v_person,v_workspace
  from public.workspace_person_tenant_links l
  join public.drivers d on d.id=l.driver_id and d.tenant_id=l.tenant_id
  join public.tenants t on t.id=d.tenant_id and t.workspace_id=l.workspace_id
  where d.id=_driver and d.tenant_id=_tenant and d.active and d.user_id is null;
  if not found then raise exception 'driver_unavailable_or_already_linked';end if;
  perform p.id from public.workspace_people p where p.id=v_person and p.workspace_id=v_workspace
    and coalesce((to_jsonb(p)->>'active')::boolean,true)
    for update nowait;
  if not found then raise exception 'driver_workspace_identity_missing';end if;
  perform w.id from public.workspaces w where w.id=v_workspace
    and coalesce((to_jsonb(w)->>'active')::boolean,true) for share nowait;
  if not found then raise exception 'driver_workspace_identity_missing';end if;
  perform t.id from public.tenants t where t.workspace_id=v_workspace order by t.id for share nowait;
  perform l.driver_id from public.workspace_person_tenant_links l
    where l.workspace_person_id=v_person and l.driver_id is not null
    order by l.tenant_id,l.driver_id for share nowait;
  if exists(select 1 from public.workspace_person_tenant_links l
    join public.drivers d on d.id=l.driver_id join public.tenants t on t.id=d.tenant_id
    where l.workspace_person_id=v_person and (l.workspace_id is distinct from v_workspace or t.workspace_id is distinct from v_workspace
      or d.workspace_id is distinct from v_workspace or d.tenant_id is distinct from l.tenant_id)) then
    raise exception 'driver_workspace_identity_mismatch';end if;
  perform d.id from public.drivers d join public.workspace_person_tenant_links l on l.driver_id=d.id
    where l.workspace_person_id=v_person order by d.tenant_id,d.id for update of d nowait;
  if exists(select 1 from public.drivers d join public.workspace_person_tenant_links l on l.driver_id=d.id
    where l.workspace_person_id=v_person and d.user_id is not null) then
    raise exception 'driver_unavailable_or_already_linked';end if;
  select jsonb_agg(d.id order by d.tenant_id,d.id),jsonb_agg(d.tenant_id order by d.tenant_id,d.id),count(*)
    into v_ids,v_tenants,v_count
    from public.drivers d join public.workspace_person_tenant_links l on l.driver_id=d.id
    join public.tenants t on t.id=d.tenant_id
    where l.workspace_person_id=v_person and d.active
      and coalesce((to_jsonb(t)->>'active')::boolean,true);
  if coalesce(v_count,0)=0 or not (v_ids ? _driver::text)
    or v_count<>(select count(distinct value) from jsonb_array_elements_text(v_tenants)) then
    raise exception 'driver_workspace_identity_mismatch';end if;
  perform m.id from public.tenant_memberships m
    where m.user_id=_actor and v_tenants ? m.tenant_id::text order by m.tenant_id for share nowait;
  if exists(select 1 from jsonb_array_elements_text(v_tenants) x(tenant)
    where not exists(select 1 from public.tenant_memberships m where m.user_id=_actor
      and m.tenant_id=x.tenant::uuid and m.active and m.role in('owner','admin'))) then
    raise exception 'driver_access_forbidden';end if;
  return jsonb_build_object('driver_workspace_creation_v1',true,'workspace_id',v_workspace,
    'workspace_person_id',v_person,'driver_ids',v_ids,'tenant_ids',v_tenants);
end;$function$;
revoke all on function private.driver_workspace_creation_scope_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.driver_workspace_creation_scope_v1(uuid,uuid,uuid) to service_role;

create or replace function public.prepare_driver_access_v1(_tenant_id uuid,_actor_id uuid,_driver_id uuid,_email text,_nonce text)
returns text language plpgsql set search_path='' as $function$
declare v_name text;v_scope jsonb;
begin
  if _email !~ '^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]@usuario\.com$'
    or split_part(_email,'@',1) like '%..%' then raise exception 'invalid_driver_username';end if;
  v_scope:=private.driver_workspace_creation_scope_v1(_tenant_id,_actor_id,_driver_id);
  select name into v_name from public.drivers where id=_driver_id and tenant_id=_tenant_id;
  perform public.prepare_auth_invite_v2(_email,_tenant_id,_actor_id,_nonce,'driver');
  update private.auth_invite_authorizations set driver_id=_driver_id,permissions=v_scope where email=_email;
  return v_name;
end;$function$;
revoke all on function public.prepare_driver_access_v1(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.prepare_driver_access_v1(uuid,uuid,uuid,text,text) to service_role;

-- Patch only known predecessors; preserve owner, ACL, security mode and signatures.
do $patch$
declare v_def text;v_old text;v_new text;
begin
  v_def:=pg_get_functiondef('private.enforce_invite_only_auth_user()'::regprocedure);
  if position('driver_workspace_creation_v1' in v_def)=0 then
    v_old:='  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, ''{}''::jsonb) - ''agvlog_invite_nonce'';';
    v_new:=$body$
  if coalesce((v_invite.permissions->>'driver_workspace_creation_v1')::boolean,false) then
    if private.driver_workspace_creation_scope_v1(v_invite.tenant_id,v_invite.invited_by,v_invite.driver_id)
      is distinct from v_invite.permissions then raise exception 'driver_creation_scope_changed';end if;
    -- Only this nonce-validated BEFORE INSERT may bind the reserved scope to NEW.id.
    update private.auth_invite_authorizations set permissions=permissions||jsonb_build_object('driver_creation_user_id',new.id)
      where email=v_invite.email;
    new.raw_app_meta_data:=new.raw_app_meta_data||jsonb_build_object(
      'driver_workspace_managed',true,'driver_access_workspace_id',v_invite.permissions->>'workspace_id');
  end if;
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'agvlog_invite_nonce';$body$;
    if position(v_old in v_def)=0 then raise exception 'driver_creation_before_predecessor_changed';end if;
    execute replace(v_def,v_old,v_new);
  end if;

  v_def:=pg_get_functiondef('private.attach_invited_user_access_v1()'::regprocedure);
  if position('driver_workspace_creation_v1' in v_def)=0 then
    v_old:=$body$  DELETE FROM private.auth_invite_authorizations
   WHERE email = lower(btrim(coalesce(new.email, '')))
   RETURNING * INTO v_invite;$body$;
    v_new:=$body$  SELECT * INTO v_invite FROM private.auth_invite_authorizations
   WHERE email = lower(btrim(coalesce(new.email, ''))) FOR UPDATE;$body$;
    if position(v_old in v_def)=0 then raise exception 'driver_creation_attach_predecessor_changed';end if;
    v_def:=replace(v_def,v_old,v_new);
    v_old:='  IF v_invite.role = ''client'' THEN';
    v_new:=$body$
  if coalesce((v_invite.permissions->>'driver_workspace_creation_v1')::boolean,false) then
    if v_invite.permissions->>'driver_creation_user_id' is distinct from new.id::text
      or new.raw_app_meta_data->>'driver_workspace_managed' is distinct from 'true'
      or new.raw_app_meta_data->>'driver_access_workspace_id' is distinct from v_invite.permissions->>'workspace_id'
      or (v_invite.permissions-'driver_creation_user_id') is distinct from
        private.driver_workspace_creation_scope_v1(v_invite.tenant_id,v_invite.invited_by,v_invite.driver_id) then
      raise exception 'driver_creation_scope_changed';end if;
    insert into public.workspace_memberships(workspace_id,user_id,role,active)
      values((v_invite.permissions->>'workspace_id')::uuid,new.id,'driver',true);
    insert into public.tenant_memberships(tenant_id,user_id,role,active)
      select value::uuid,new.id,'driver'::public.app_role,true
      from jsonb_array_elements_text(v_invite.permissions->'tenant_ids') order by value;
    update public.drivers set user_id=new.id
      where id in(select value::uuid from jsonb_array_elements_text(v_invite.permissions->'driver_ids'));
    delete from private.auth_invite_authorizations where email=v_invite.email;
    return new;
  end if;
  IF v_invite.role = 'client' THEN$body$;
    if position(v_old in v_def)=0 then raise exception 'driver_creation_attach_branch_changed';end if;
    v_def:=replace(v_def,v_old,v_new);
    v_old:='  RETURN new;';
    -- Uppercase original RETURN is unique; workspace branch above uses lowercase.
    v_new:='  DELETE FROM private.auth_invite_authorizations WHERE email=v_invite.email;'||chr(10)||v_old;
    if position(v_old in v_def)=0 then raise exception 'driver_creation_attach_return_changed';end if;
    execute replace(v_def,v_old,v_new);
  end if;

  v_def:=pg_get_functiondef('private.guard_driver_account_scope_v1()'::regprocedure);
  if position('driver_workspace_creation_v1' in v_def)=0 then
    v_old:='  -- Converted workspace identity: existing links only; no implicit new access.';
    v_new:=$body$
  -- A nonce-validated Auth INSERT owns this private, uncommitted capability.
  -- It is consumed before Auth commits; subsequent direct links stay forbidden.
  if coalesce(v_meta->>'driver_workspace_managed','false')='true' and exists(
    select 1 from private.auth_invite_authorizations i join auth.users u on u.email=i.email
    where u.id=v_id and i.role='driver' and i.driver_id is not null and i.expires_at>clock_timestamp()
      and i.permissions->>'driver_workspace_creation_v1'='true'
      and i.permissions->>'driver_creation_user_id'=v_id::text
      and i.permissions->>'workspace_id'=v_meta->>'driver_access_workspace_id'
      and (
        (TG_TABLE_NAME='drivers' and TG_OP='UPDATE' and to_jsonb(old)->>'user_id' is null
          and i.permissions->'driver_ids' ? (to_jsonb(new)->>'id')
          and i.permissions->'tenant_ids' ? (to_jsonb(new)->>'tenant_id'))
        or (TG_TABLE_NAME='tenant_memberships' and TG_OP='INSERT' and to_jsonb(new)->>'role'='driver'
          and i.permissions->'tenant_ids' ? (to_jsonb(new)->>'tenant_id'))
        or (TG_TABLE_NAME='workspace_memberships' and TG_OP='INSERT' and to_jsonb(new)->>'role'='driver'
          and i.permissions->>'workspace_id'=to_jsonb(new)->>'workspace_id')
      )) then return new;end if;
  -- Converted workspace identity: existing links only; no implicit new access.$body$;
    if position(v_old in v_def)=0 then raise exception 'driver_creation_guard_predecessor_changed';end if;
    execute replace(v_def,v_old,v_new);
  end if;
end;$patch$;
commit;
