-- Exact local forward; prerequisites must be reconciled before deployment.
do $preflight$
declare v_table text;v_trigger text;
begin
  if not exists(select 1 from pg_proc where oid=to_regprocedure('private.guard_driver_account_scope_v1()')
    and md5(prosrc)='ffb3e58ae5f4915a997cf1b26fe587ad' and prosecdef and proowner='postgres'::regrole and proconfig=array['search_path=""']::text[]) then
    raise exception 'driver_workspace_credential_scope_predecessor_changed';end if;
  for v_table,v_trigger in select * from(values
    ('tenant_memberships','guard_driver_tenant_scope'),('workspace_memberships','guard_driver_workspace_scope'),
    ('drivers','guard_driver_registry_link'),('user_roles','guard_driver_global_role'),('client_portal_access','guard_driver_portal_scope')) x loop
    if not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||v_table) and tgname=v_trigger
      and tgfoid='private.guard_driver_account_scope_v1()'::regprocedure and tgenabled='O' and not tgisinternal) then
      raise exception 'driver_workspace_credential_scope_trigger_changed';end if;
  end loop;
  if to_regclass('private.driver_credential_commands_v1') is not null
    or to_regprocedure('private.finalize_driver_workspace_credentials_v1()') is not null then
    raise exception 'driver_workspace_credential_forward_already_present';end if;
end;$preflight$;
-- Local candidate. Auth is mutated only by the Admin API, never by a password SQL RPC.
-- Authorization and its receipt are committed with Auth's multi-UPDATE transaction.
create table private.driver_credential_commands_v1 (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id),
  actor_id uuid not null references auth.users(id),
  tenant_id uuid not null references public.tenants(id),
  driver_id uuid references public.drivers(id),
  workspace_id uuid not null references public.workspaces(id),
  action text not null check(action in('convert','password')),
  desired_email text not null,
  nonce_hash text not null,
  password_before_digest text not null,
  password_after_digest text,
  state text not null default 'pending' check(state in('pending','succeeded','cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp()+interval '2 minutes',
  completed_at timestamptz,
  applied_txid bigint
);
create unique index driver_credential_one_pending_v1 on private.driver_credential_commands_v1(user_id) where state='pending';
alter table private.driver_credential_commands_v1 enable row level security;
revoke all on private.driver_credential_commands_v1 from public,anon,authenticated,service_role;

-- A timeout can precede preparation itself. Keep an immutable cancellation fence.
create table private.driver_credential_cancellations_v1 (
  request_id uuid primary key,
  user_id uuid not null references auth.users(id),
  actor_id uuid not null references auth.users(id),
  tenant_id uuid not null references public.tenants(id),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.driver_credential_cancellations_v1 enable row level security;
revoke all on private.driver_credential_cancellations_v1 from public,anon,authenticated,service_role;

create function private.driver_workspace_credential_scope_v1(_tenant uuid,_actor uuid,_user uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $fn$
declare v_user auth.users%rowtype;v_workspace uuid;v_managed boolean;v_meta jsonb;
begin
  if _tenant is null or _actor is null or _user is null or _actor=_user then
    raise exception 'driver_credential_forbidden' using errcode='42501';end if;
  -- Auth row serializes with all existing BEFORE INSERT/UPDATE account-scope guards.
  select * into v_user from auth.users where id=_user for update nowait;
  if not found then raise exception 'driver_credential_forbidden' using errcode='42501';end if;
  perform m.id from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=_actor
    and m.active and m.role in('owner','admin') for share nowait;
  if not found then raise exception 'driver_credential_forbidden' using errcode='42501';end if;
  -- Lock every represented legal-company mapping, including inactive memberships.
  perform t.id from public.tenants t where t.id=_tenant or t.id in(
    select tenant_id from public.tenant_memberships where user_id=_user
    union select tenant_id from public.drivers where user_id=_user
  ) order by t.id for share nowait;
  select workspace_id into v_workspace from public.tenants where id=_tenant;
  if v_workspace is null then raise exception 'driver_credential_scope_restricted' using errcode='42501';end if;
  perform w.id from public.workspaces w where w.id=v_workspace for share nowait;
  if not exists(select 1 from public.workspaces w where w.id=v_workspace
    and coalesce((to_jsonb(w)->>'active')::boolean,true)) then
    raise exception 'driver_credential_scope_restricted' using errcode='42501';end if;
  perform m.id from public.tenant_memberships m where m.user_id=_user order by m.id for share nowait;
  perform w.id from public.workspace_memberships w where w.user_id=_user order by w.id for share nowait;
  perform d.id from public.drivers d where d.user_id=_user order by d.id for share nowait;
  perform r.id from public.user_roles r where r.user_id=_user order by r.id for share nowait;
  perform p.id from public.client_portal_access p where p.user_id=_user order by p.id for share nowait;
  perform i.id from auth.identities i where i.user_id=_user order by i.id for share nowait;
  v_meta:=coalesce(v_user.raw_app_meta_data,'{}'::jsonb);
  if v_user.deleted_at is not null or coalesce(v_meta->>'driver_access_retired','false')='true'
    or coalesce((to_jsonb(v_user)->>'is_super_admin')::boolean,false)
    or coalesce((to_jsonb(v_user)->>'is_sso_user')::boolean,false)
    or coalesce(to_jsonb(v_user)->>'role','authenticated')<>'authenticated'
    or nullif(to_jsonb(v_user)->>'banned_until','')::timestamptz>clock_timestamp()
    or (v_meta ?| array['role','roles','permissions','is_admin','is_super_admin'])
    or exists(select 1 from auth.identities i where i.user_id=_user and i.provider<>'email')
    or not exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant
      and m.user_id=_user and m.role='driver' and m.active)
    or not exists(select 1 from public.drivers d where d.tenant_id=_tenant and d.user_id=_user and d.active)
    or exists(select 1 from public.tenant_memberships m left join public.tenants t on t.id=m.tenant_id
      where m.user_id=_user and (m.role<>'driver' or t.workspace_id is distinct from v_workspace))
    or exists(select 1 from public.workspace_memberships w where w.user_id=_user
      and (w.role<>'driver' or w.workspace_id<>v_workspace))
    or exists(select 1 from public.drivers d left join public.tenants t on t.id=d.tenant_id
      where d.user_id=_user and t.workspace_id is distinct from v_workspace)
    or exists(select 1 from public.client_portal_access where user_id=_user)
    or exists(select 1 from public.user_roles where user_id=_user and role<>'driver') then
    raise exception 'driver_credential_scope_restricted' using errcode='42501';
  end if;
  v_managed:=coalesce(v_meta->>'driver_username_managed','false')='true';
  if v_managed and coalesce(v_meta->>'driver_workspace_managed','false')='true'
    and (v_meta->>'driver_access_workspace_id') is distinct from v_workspace::text then
    raise exception 'driver_credential_scope_restricted' using errcode='42501';end if;
  if v_managed and coalesce(v_meta->>'driver_workspace_managed','false')<>'true'
    and not exists(select 1 from public.tenants t where t.id::text=v_meta->>'driver_access_tenant_id'
      and t.workspace_id=v_workspace) then
    raise exception 'driver_credential_scope_restricted' using errcode='42501';end if;
  return jsonb_build_object('workspace_id',v_workspace,'managed',v_managed,'email',v_user.email,'active',true);
end;$fn$;
revoke all on function private.driver_workspace_credential_scope_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function public.inspect_driver_workspace_credentials_v1(_tenant_id uuid,_actor_id uuid,_user_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $fn$
declare v_scope jsonb;v_command private.driver_credential_commands_v1%rowtype;
begin
  v_scope:=private.driver_workspace_credential_scope_v1(_tenant_id,_actor_id,_user_id);
  -- The scope helper holds Auth FOR UPDATE; a late Auth transaction cannot cross cancellation.
  update private.driver_credential_commands_v1 set state='cancelled',completed_at=clock_timestamp()
    where user_id=_user_id and state='pending' and expires_at<clock_timestamp();
  select * into v_command from private.driver_credential_commands_v1 where user_id=_user_id and state='pending';
  return v_scope||jsonb_build_object('command_pending',found,'pending_request_id',
    case when v_command.actor_id=_actor_id and v_command.tenant_id=_tenant_id then v_command.request_id else null end);
end;
$fn$;
revoke all on function public.inspect_driver_workspace_credentials_v1(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.inspect_driver_workspace_credentials_v1(uuid,uuid,uuid) to service_role;

create function public.prepare_driver_workspace_credentials_v1(
  _tenant_id uuid,_actor_id uuid,_user_id uuid,_request_id uuid,_action text,_email text,_nonce text,_driver_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_scope jsonb;v_command private.driver_credential_commands_v1%rowtype;v_email text;v_before text;
  v_cancel private.driver_credential_cancellations_v1%rowtype;
begin
  if _request_id is null or _action not in('convert','password') or length(coalesce(_nonce,''))<48 then
    raise exception 'driver_credential_request_invalid' using errcode='22023';end if;
  v_scope:=private.driver_workspace_credential_scope_v1(_tenant_id,_actor_id,_user_id);
  select * into v_cancel from private.driver_credential_cancellations_v1 where request_id=_request_id;
  if found then
    if v_cancel.tenant_id<>_tenant_id or v_cancel.actor_id<>_actor_id or v_cancel.user_id<>_user_id then
      raise exception 'driver_credential_request_conflict' using errcode='23505';end if;
    return jsonb_build_object('state','cancelled','request_id',_request_id,'dispatch',false);
  end if;
  if _driver_id is not null and not exists(select 1 from public.drivers where id=_driver_id and tenant_id=_tenant_id
      and user_id=_user_id and active) then raise exception 'driver_credential_target_changed' using errcode='42501';end if;
  if not exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass
    and tgname='driver_workspace_credential_commit_v1' and tgenabled='O' and tgdeferrable and tginitdeferred
    and tgfoid='private.finalize_driver_workspace_credentials_v1()'::regprocedure)
    or not exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass
      and tgname='driver_workspace_credential_before_v1' and tgenabled='O' and tgtype=19
      and tgfoid='private.check_driver_workspace_credentials_before_v1()'::regprocedure) then
    raise exception 'driver_credential_commit_guard_missing';end if;
  select * into v_command from private.driver_credential_commands_v1 where request_id=_request_id for update;
  if found then
    if v_command.tenant_id<>_tenant_id or v_command.actor_id<>_actor_id or v_command.user_id<>_user_id
      or v_command.action<>_action or v_command.driver_id is distinct from _driver_id
      or (_action='convert' and v_command.desired_email is distinct from _email) then
      raise exception 'driver_credential_request_conflict' using errcode='23505';end if;
    -- Never dispatch Auth twice, including after a network failure.
    return jsonb_build_object('state',v_command.state,'request_id',_request_id,'dispatch',false);
  end if;
  if (_action='convert' and (v_scope->>'managed')::boolean)
    or (_action='password' and not (v_scope->>'managed')::boolean) then
    raise exception 'driver_credential_action_unavailable' using errcode='42501';end if;
  v_email:=case when _action='convert' then _email else v_scope->>'email' end;
  if v_email is null or v_email !~ '^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]@usuario\.com$'
    or split_part(v_email,'@',1) like '%..%' then raise exception 'invalid_driver_username';end if;
  if exists(select 1 from private.driver_credential_commands_v1 where user_id=_user_id and state='pending') then
    raise exception 'driver_credential_reconciliation_required' using errcode='55000';end if;
  select encode(extensions.digest(coalesce(encrypted_password,''),'sha256'),'hex') into v_before from auth.users where id=_user_id;
  insert into private.driver_credential_commands_v1(request_id,user_id,actor_id,tenant_id,driver_id,workspace_id,action,desired_email,nonce_hash,password_before_digest)
    values(_request_id,_user_id,_actor_id,_tenant_id,_driver_id,(v_scope->>'workspace_id')::uuid,_action,v_email,
      encode(extensions.digest(_nonce,'sha256'),'hex'),v_before);
  return jsonb_build_object('state','pending','request_id',_request_id,'dispatch',true,'email',v_email);
end;$fn$;
revoke all on function public.prepare_driver_workspace_credentials_v1(uuid,uuid,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.prepare_driver_workspace_credentials_v1(uuid,uuid,uuid,uuid,text,text,text,uuid) to service_role;

-- Validate the current OLD authority before GoTrue can overwrite metadata loaded earlier.
-- The deferred guard below additionally verifies its final ticket and atomic result.
create function private.check_driver_workspace_credentials_before_v1()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare v_command private.driver_credential_commands_v1%rowtype;
begin
  if new.email is not distinct from old.email and new.encrypted_password is not distinct from old.encrypted_password
    and new.raw_app_meta_data is not distinct from old.raw_app_meta_data then return new;end if;
  select * into v_command from private.driver_credential_commands_v1 where user_id=old.id and state='pending' for update;
  if not found then return new;end if;
  if v_command.expires_at<clock_timestamp() then raise exception 'driver_credential_command_invalid' using errcode='42501';end if;
  perform private.driver_workspace_credential_scope_v1(v_command.tenant_id,v_command.actor_id,old.id);
  if v_command.driver_id is not null and not exists(select 1 from public.drivers where id=v_command.driver_id
      and tenant_id=v_command.tenant_id and user_id=old.id and active) then
    raise exception 'driver_credential_target_changed' using errcode='42501';end if;
  return new;
end;$fn$;
revoke all on function private.check_driver_workspace_credentials_before_v1() from public,anon,authenticated,service_role;
create trigger driver_workspace_credential_before_v1 before update on auth.users
  for each row execute function private.check_driver_workspace_credentials_before_v1();

-- A deferred constraint observes the final row across GoTrue's password/email/metadata UPDATEs.
-- Raising here rolls back the entire Auth transaction, including its email identity update.
create function private.finalize_driver_workspace_credentials_v1()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare v_user auth.users%rowtype;v_command private.driver_credential_commands_v1%rowtype;
  v_id uuid;v_nonce text;v_scope jsonb;v_sensitive boolean;
begin
  v_sensitive:=new.email is distinct from old.email or new.encrypted_password is distinct from old.encrypted_password
    or (new.raw_app_meta_data->'driver_credential_request_id') is distinct from (old.raw_app_meta_data->'driver_credential_request_id')
    or (new.raw_app_meta_data->'driver_credential_nonce') is distinct from (old.raw_app_meta_data->'driver_credential_nonce')
    or (new.raw_app_meta_data->'driver_workspace_managed') is distinct from (old.raw_app_meta_data->'driver_workspace_managed')
    or (new.raw_app_meta_data->'driver_access_workspace_id') is distinct from (old.raw_app_meta_data->'driver_access_workspace_id');
  if not v_sensitive then return null;end if;
  select * into v_user from auth.users where id=new.id for update;
  -- Subsequent queued events from this same authorized transaction are already covered.
  select * into v_command from private.driver_credential_commands_v1 where user_id=new.id
    and state='succeeded' and applied_txid=txid_current();
  if found then
    if v_command.desired_email is distinct from v_user.email
      or v_command.password_after_digest is distinct from encode(extensions.digest(coalesce(v_user.encrypted_password,''),'sha256'),'hex')
      or v_user.raw_app_meta_data ?| array['driver_credential_nonce','driver_credential_request_id']
      or coalesce(v_user.raw_app_meta_data->>'driver_workspace_managed','false')<>'true'
      or v_user.raw_app_meta_data->>'driver_access_workspace_id' is distinct from v_command.workspace_id::text then
      raise exception 'driver_credential_result_mismatch' using errcode='42501';end if;
    return null;
  end if;
  v_nonce:=v_user.raw_app_meta_data->>'driver_credential_nonce';
  if v_user.raw_app_meta_data->>'driver_credential_request_id' is null then
    if coalesce(old.raw_app_meta_data->>'driver_workspace_managed','false')='true'
      or coalesce(new.raw_app_meta_data->>'driver_workspace_managed','false')='true'
      or exists(select 1 from private.driver_credential_commands_v1 where user_id=new.id and state='pending') then
      raise exception 'driver_credential_command_required' using errcode='42501';end if;
    return null; -- Existing unrelated Auth flows are not redefined by this feature.
  end if;
  begin v_id:=(v_user.raw_app_meta_data->>'driver_credential_request_id')::uuid;
  exception when invalid_text_representation then raise exception 'driver_credential_command_invalid' using errcode='42501';end;
  select * into v_command from private.driver_credential_commands_v1 where request_id=v_id and user_id=new.id for update;
  if not found or v_command.state<>'pending' or v_command.expires_at<clock_timestamp()
    or v_nonce is null or encode(extensions.digest(v_nonce,'sha256'),'hex')<>v_command.nonce_hash then
    raise exception 'driver_credential_command_invalid' using errcode='42501';end if;
  v_scope:=private.driver_workspace_credential_scope_v1(v_command.tenant_id,v_command.actor_id,new.id);
  if v_command.driver_id is not null and not exists(select 1 from public.drivers where id=v_command.driver_id
      and tenant_id=v_command.tenant_id and user_id=new.id and active) then
    raise exception 'driver_credential_target_changed' using errcode='42501';end if;
  if (v_scope->>'workspace_id')::uuid<>v_command.workspace_id or v_user.email<>v_command.desired_email
    or coalesce(v_user.encrypted_password,'')='' or encode(extensions.digest(v_user.encrypted_password,'sha256'),'hex')=v_command.password_before_digest then
    raise exception 'driver_credential_result_mismatch' using errcode='42501';end if;
  -- Record success before our metadata cleanup, so its deferred event is recognized.
  update private.driver_credential_commands_v1 set state='succeeded',completed_at=clock_timestamp(),applied_txid=txid_current(),
    password_after_digest=encode(extensions.digest(v_user.encrypted_password,'sha256'),'hex')
    where request_id=v_id;
  update auth.users set raw_app_meta_data=(coalesce(raw_app_meta_data,'{}'::jsonb)-array['driver_credential_nonce','driver_credential_request_id'])
    ||jsonb_build_object('driver_username_managed',true,'driver_workspace_managed',true,
      'driver_access_workspace_id',v_command.workspace_id,
      'driver_access_tenant_id',case when v_command.action='convert' then v_command.tenant_id::text
        else coalesce(raw_app_meta_data->>'driver_access_tenant_id',v_command.tenant_id::text) end)
    where id=new.id;
  return null;
end;$fn$;
revoke all on function private.finalize_driver_workspace_credentials_v1() from public,anon,authenticated,service_role;
create constraint trigger driver_workspace_credential_commit_v1 after update on auth.users
  deferrable initially deferred for each row execute function private.finalize_driver_workspace_credentials_v1();

create function public.driver_workspace_credential_status_v1(
  _tenant_id uuid,_actor_id uuid,_user_id uuid,_request_id uuid,_cancel boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare v_command private.driver_credential_commands_v1%rowtype;
  v_cancel private.driver_credential_cancellations_v1%rowtype;
begin
  -- Same lock order as Auth/prepare. Cancellation fences a delayed Auth response.
  perform id from auth.users where id=_user_id for update nowait;
  if not found or _request_id is null then raise exception 'driver_credential_forbidden' using errcode='42501';end if;
  perform id from public.tenant_memberships where tenant_id=_tenant_id and user_id=_actor_id
    and active and role in('owner','admin') for share nowait;
  if not found then raise exception 'driver_credential_forbidden' using errcode='42501';end if;
  select * into v_command from private.driver_credential_commands_v1 where request_id=_request_id for update;
  if not found then
    insert into private.driver_credential_cancellations_v1(request_id,user_id,actor_id,tenant_id)
      values(_request_id,_user_id,_actor_id,_tenant_id) on conflict(request_id) do nothing;
    select * into v_cancel from private.driver_credential_cancellations_v1 where request_id=_request_id;
    if v_cancel.user_id<>_user_id or v_cancel.actor_id<>_actor_id or v_cancel.tenant_id<>_tenant_id then
      raise exception 'driver_credential_forbidden' using errcode='42501';end if;
    return jsonb_build_object('state','cancelled','request_id',_request_id);
  end if;
  if v_command.user_id<>_user_id or v_command.actor_id<>_actor_id or v_command.tenant_id<>_tenant_id then
    raise exception 'driver_credential_forbidden' using errcode='42501';end if;
  if v_command.state='pending' and (_cancel or v_command.expires_at<clock_timestamp()) then
    update private.driver_credential_commands_v1 set state='cancelled',completed_at=clock_timestamp() where request_id=_request_id;
    v_command.state:='cancelled';
  end if;
  return jsonb_build_object('state',v_command.state,'request_id',_request_id,'action',v_command.action,
    'username',case when v_command.state='succeeded' then split_part(v_command.desired_email,'@',1) else null end);
end;$fn$;
revoke all on function public.driver_workspace_credential_status_v1(uuid,uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.driver_workspace_credential_status_v1(uuid,uuid,uuid,uuid,boolean) to service_role;

do $guard$
declare original text;definition text;metadata jsonb;revised text:=$body$
DECLARE v_meta jsonb; v_deleted timestamptz; v_tenant uuid; v_workspace uuid; v_id uuid;
BEGIN
  v_id := new.user_id;
  IF v_id IS NULL THEN RETURN new; END IF;
  SELECT raw_app_meta_data,deleted_at INTO v_meta,v_deleted FROM auth.users WHERE id=v_id FOR SHARE;
  IF v_deleted IS NOT NULL OR coalesce(v_meta->>'driver_access_retired','false')='true' THEN
    IF TG_TABLE_NAME IN ('user_roles','drivers') THEN
      RAISE EXCEPTION 'driver_account_retired';
    ELSIF new.active THEN
      RAISE EXCEPTION 'driver_account_retired';
    END IF;
    IF coalesce(v_meta->>'driver_access_retired','false')='true'
      OR coalesce(v_meta->>'driver_username_managed','false')='true' THEN
      IF TG_TABLE_NAME='client_portal_access' THEN
        RAISE EXCEPTION 'driver_account_retired';
      ELSIF TG_TABLE_NAME IN ('tenant_memberships','workspace_memberships') THEN
        IF new.role<>'driver' THEN RAISE EXCEPTION 'driver_account_retired'; END IF;
        v_tenant := (v_meta->>'driver_access_tenant_id')::uuid;
        IF v_tenant IS NULL THEN RAISE EXCEPTION 'driver_account_retired'; END IF;
        IF TG_TABLE_NAME='tenant_memberships' THEN
          IF new.tenant_id IS DISTINCT FROM v_tenant THEN RAISE EXCEPTION 'driver_account_retired'; END IF;
        ELSE
          SELECT workspace_id INTO v_workspace FROM public.tenants WHERE id=v_tenant;
          IF new.workspace_id IS DISTINCT FROM v_workspace THEN RAISE EXCEPTION 'driver_account_retired'; END IF;
        END IF;
      END IF;
    END IF;
    RETURN new;
  END IF;
  -- Converted workspace identity: existing links only; no implicit new access.
  IF coalesce(v_meta->>'driver_workspace_managed','false')='true' THEN
    v_workspace := (v_meta->>'driver_access_workspace_id')::uuid;
    IF v_workspace IS NULL OR TG_OP='INSERT' OR new.user_id IS DISTINCT FROM old.user_id THEN
      RAISE EXCEPTION 'workspace_driver_link_change_forbidden';
    END IF;
    IF TG_TABLE_NAME='client_portal_access' THEN RAISE EXCEPTION 'managed_driver_has_no_portal_access';
    ELSIF TG_TABLE_NAME='drivers' THEN
      IF new.tenant_id IS DISTINCT FROM old.tenant_id OR NOT EXISTS(
        SELECT 1 FROM public.tenants WHERE id=new.tenant_id AND workspace_id=v_workspace) THEN
        RAISE EXCEPTION 'workspace_driver_link_change_forbidden';END IF;
    ELSIF TG_TABLE_NAME='tenant_memberships' THEN
      IF new.role<>'driver' OR new.role IS DISTINCT FROM old.role OR new.tenant_id IS DISTINCT FROM old.tenant_id
        OR NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=new.tenant_id AND workspace_id=v_workspace) THEN
        RAISE EXCEPTION 'workspace_driver_link_change_forbidden';END IF;
    ELSIF TG_TABLE_NAME='workspace_memberships' THEN
      IF new.role<>'driver' OR new.role IS DISTINCT FROM old.role OR new.workspace_id IS DISTINCT FROM old.workspace_id
        OR new.workspace_id IS DISTINCT FROM v_workspace THEN RAISE EXCEPTION 'workspace_driver_link_change_forbidden';END IF;
    ELSIF new.role<>'driver' OR new.role IS DISTINCT FROM old.role THEN
      RAISE EXCEPTION 'workspace_driver_link_change_forbidden';
    END IF;
    RETURN new;
  END IF;
  IF coalesce(v_meta->>'driver_username_managed','false')<>'true' THEN
    IF TG_TABLE_NAME IN ('tenant_memberships','workspace_memberships') THEN
      IF new.role='driver' THEN
        IF TG_OP='INSERT' THEN RAISE EXCEPTION 'driver_accounts_require_username_creation'; END IF;
        IF new.user_id IS DISTINCT FROM old.user_id OR new.role IS DISTINCT FROM old.role
          OR (new.active AND NOT old.active) THEN
          RAISE EXCEPTION 'driver_accounts_require_username_creation';
        END IF;
      END IF;
    ELSIF TG_TABLE_NAME='user_roles' THEN
      IF new.role='driver' THEN RAISE EXCEPTION 'driver_accounts_require_username_creation'; END IF;
    ELSIF TG_TABLE_NAME='drivers' THEN
      IF TG_OP='INSERT' THEN RAISE EXCEPTION 'driver_accounts_require_username_creation'; END IF;
      IF new.user_id IS DISTINCT FROM old.user_id THEN RAISE EXCEPTION 'driver_accounts_require_username_creation'; END IF;
    END IF;
    RETURN new;
  END IF;
  v_tenant := (v_meta->>'driver_access_tenant_id')::uuid;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'managed_driver_tenant_required'; END IF;
  IF TG_TABLE_NAME='client_portal_access' THEN
    RAISE EXCEPTION 'managed_driver_has_no_portal_access';
  ELSIF TG_TABLE_NAME='drivers' THEN
    IF new.tenant_id<>v_tenant OR EXISTS(SELECT 1 FROM public.drivers WHERE user_id=v_id AND id<>new.id) THEN
      RAISE EXCEPTION 'managed_driver_invalid_link';
    END IF;
  ELSIF TG_TABLE_NAME='tenant_memberships' THEN
    IF new.tenant_id<>v_tenant OR new.role<>'driver' THEN RAISE EXCEPTION 'managed_driver_invalid_membership'; END IF;
  ELSIF TG_TABLE_NAME='workspace_memberships' THEN
    SELECT workspace_id INTO v_workspace FROM public.tenants WHERE id=v_tenant;
    IF new.workspace_id<>v_workspace OR new.role<>'driver' THEN RAISE EXCEPTION 'managed_driver_invalid_workspace'; END IF;
  ELSIF new.role<>'driver' THEN
    RAISE EXCEPTION 'managed_driver_invalid_role';
  END IF;
  RETURN new;
END;
$body$;
begin
  select prosrc,pg_get_functiondef(oid),to_jsonb(p)-'prosrc' into original,definition,metadata
    from pg_proc p where oid='private.guard_driver_account_scope_v1()'::regprocedure;
  if md5(original)<>'ffb3e58ae5f4915a997cf1b26fe587ad' or md5(revised)<>'2ee9f8e664c19efdc6226d6cd1a8190b' then raise exception 'driver_workspace_guard_changed';end if;
  execute replace(definition,original,revised);
  if (select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.guard_driver_account_scope_v1()'::regprocedure) is distinct from metadata then
    raise exception 'driver_workspace_guard_metadata_changed';end if;
end;$guard$;
