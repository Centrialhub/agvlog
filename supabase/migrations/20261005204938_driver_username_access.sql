-- Reviewed predecessor contract; refuse an unknown Auth invitation graph.
DO $guard$
DECLARE v record;
BEGIN
  IF to_regclass('private.auth_invite_authorizations') IS NULL
    OR to_regclass('public.drivers') IS NULL OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'driver_access_dependency_missing';
  END IF;
  FOR v IN SELECT p.*,x.expected_hash,x.definer,x.service_exec FROM (VALUES
    ('public.prepare_auth_invite_v2(text,uuid,uuid,text,public.app_role,uuid,text,jsonb)','450c58dc7832ae4fc3146c7cfe8aa932',false,true),
    ('private.enforce_invite_only_auth_user()','f7f4349038197d33f7edcc77fcf10749',true,false),
    ('private.attach_invited_user_access_v1()','c84055daa6384d504e3db7ab7a7849b6',true,false)
  ) AS x(signature,expected_hash,definer,service_exec) LEFT JOIN pg_proc p ON p.oid=to_regprocedure(x.signature)
  LOOP
    IF v.oid IS NULL OR v.proowner IS DISTINCT FROM 'postgres'::regrole::oid OR md5(v.prosrc)<>v.expected_hash OR v.prosecdef IS DISTINCT FROM v.definer
      OR v.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR has_function_privilege('anon',v.oid,'EXECUTE') OR has_function_privilege('authenticated',v.oid,'EXECUTE')
      OR has_function_privilege('service_role',v.oid,'EXECUTE') IS DISTINCT FROM v.service_exec
      OR EXISTS(SELECT 1 FROM aclexplode(coalesce(v.proacl,acldefault('f',v.proowner))) a
        WHERE a.is_grantable OR a.privilege_type<>'EXECUTE'
          OR (a.grantee<>v.proowner AND NOT(v.service_exec AND a.grantee='service_role'::regrole::oid))) THEN
      RAISE EXCEPTION 'driver_access_predecessor_changed';
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass
    AND tgname='enforce_invite_only_before_auth_user_created' AND tgfoid='private.enforce_invite_only_auth_user()'::regprocedure
    AND tgtype=7 AND tgenabled='O' AND tgqual IS NULL AND tgnargs=0 AND NOT tgisinternal)
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='auth.users'::regclass
    AND tgname='attach_invited_user_access_after_auth_user_created' AND tgfoid='private.attach_invited_user_access_v1()'::regprocedure
    AND tgtype=5 AND tgenabled='O' AND tgqual IS NULL AND tgnargs=0 AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'driver_access_invitation_trigger_changed';
  END IF;
END;
$guard$;

-- Prepared only: apply in coordinated homologation before deploying the new endpoint.
ALTER TABLE private.auth_invite_authorizations
  ADD COLUMN driver_id uuid REFERENCES public.drivers(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.prepare_driver_access_v1(
  _tenant_id uuid, _actor_id uuid, _driver_id uuid, _email text, _nonce text
)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_name text;
BEGIN
  PERFORM 1 FROM public.tenant_memberships
    WHERE tenant_id=_tenant_id AND user_id=_actor_id AND active AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'driver_access_forbidden'; END IF;
  IF _email !~ '^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]@usuario\.com$'
    OR split_part(_email,'@',1) LIKE '%..%' THEN
    RAISE EXCEPTION 'invalid_driver_username';
  END IF;
  SELECT name INTO v_name FROM public.drivers
    WHERE id=_driver_id AND tenant_id=_tenant_id AND active AND user_id IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'driver_unavailable_or_already_linked'; END IF;
  PERFORM public.prepare_auth_invite_v2(_email,_tenant_id,_actor_id,_nonce,'driver');
  UPDATE private.auth_invite_authorizations SET driver_id=_driver_id WHERE email=_email;
  RETURN v_name;
END;
$$;

-- The Auth row remains as a historical FK target after soft deletion. No password is stored here.
CREATE OR REPLACE FUNCTION private.driver_access_scope_v1(
  _tenant_id uuid, _actor_id uuid, _user_id uuid, _retire boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user record; v_workspace uuid;
BEGIN
  PERFORM 1 FROM public.tenant_memberships
    WHERE tenant_id=_tenant_id AND user_id=_actor_id AND active AND role IN ('owner','admin') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'driver_access_forbidden'; END IF;
  SELECT email,raw_app_meta_data,deleted_at INTO v_user FROM auth.users WHERE id=_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'driver_account_not_found'; END IF;
  SELECT workspace_id INTO v_workspace FROM public.tenants WHERE id=_tenant_id;
  IF (NOT EXISTS (SELECT 1 FROM public.tenant_memberships
    WHERE user_id=_user_id AND tenant_id=_tenant_id AND role='driver')
    AND NOT EXISTS (SELECT 1 FROM public.drivers
      WHERE user_id=_user_id AND tenant_id=_tenant_id)
    AND NOT (coalesce(v_user.raw_app_meta_data->>'driver_access_retired','false')='true'
      AND (v_user.raw_app_meta_data->>'driver_access_tenant_id') IS NOT DISTINCT FROM _tenant_id::text))
    OR EXISTS (SELECT 1 FROM public.tenant_memberships WHERE user_id=_user_id
      AND (tenant_id<>_tenant_id OR role<>'driver'))
    OR EXISTS (SELECT 1 FROM public.workspace_memberships WHERE user_id=_user_id
      AND (workspace_id<>v_workspace OR role<>'driver'))
    OR EXISTS (SELECT 1 FROM public.client_portal_access WHERE user_id=_user_id)
    OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role<>'driver')
    OR EXISTS (SELECT 1 FROM public.drivers WHERE user_id=_user_id AND tenant_id<>_tenant_id) THEN
    RAISE EXCEPTION 'driver_account_shared_or_other_role';
  END IF;
  IF _retire THEN
    IF coalesce(v_user.raw_app_meta_data->>'driver_username_managed','false')='true' THEN
      RAISE EXCEPTION 'new_driver_account_cannot_be_retired_as_legacy';
    END IF;
    UPDATE auth.users SET raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)
      || jsonb_build_object('driver_access_retired',true,'driver_access_tenant_id',_tenant_id)
      WHERE id=_user_id;
    -- Preserve discovery/retry for a legacy registry link that had no membership.
    -- The retired-account guard accepts this inactive historical marker only.
    INSERT INTO public.tenant_memberships(tenant_id,user_id,role,active)
      VALUES(_tenant_id,_user_id,'driver',false) ON CONFLICT(tenant_id,user_id) DO NOTHING;
    UPDATE public.tenant_memberships SET active=false WHERE user_id=_user_id;
    UPDATE public.workspace_memberships SET active=false WHERE user_id=_user_id;
    DELETE FROM public.user_roles WHERE user_id=_user_id AND role='driver';
    UPDATE public.drivers SET user_id=NULL WHERE tenant_id=_tenant_id AND user_id=_user_id;
  END IF;
  RETURN jsonb_build_object(
    'managed',coalesce(v_user.raw_app_meta_data->>'driver_username_managed','false')='true',
    'retired',coalesce(v_user.raw_app_meta_data->>'driver_access_retired','false')='true',
    'deleted',v_user.deleted_at IS NOT NULL,
    'email',v_user.email,
    'active',EXISTS(SELECT 1 FROM public.tenant_memberships
      WHERE tenant_id=_tenant_id AND user_id=_user_id AND active AND role='driver'),
    'tenant_id',v_user.raw_app_meta_data->>'driver_access_tenant_id');
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_access_scope_v1(
  _tenant_id uuid, _actor_id uuid, _user_id uuid, _retire boolean DEFAULT false
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.driver_access_scope_v1(_tenant_id,_actor_id,_user_id,_retire);
$$;
REVOKE ALL ON FUNCTION private.driver_access_scope_v1(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.driver_access_scope_v1(uuid,uuid,uuid,boolean) TO service_role;

-- Serialize account-scope changes with retirement; prohibit promotion/sharing of managed logins.
CREATE OR REPLACE FUNCTION private.guard_driver_account_scope_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
$$;

CREATE TRIGGER guard_driver_tenant_scope BEFORE INSERT OR UPDATE ON public.tenant_memberships
  FOR EACH ROW EXECUTE FUNCTION private.guard_driver_account_scope_v1();
CREATE TRIGGER guard_driver_workspace_scope BEFORE INSERT OR UPDATE ON public.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION private.guard_driver_account_scope_v1();
CREATE TRIGGER guard_driver_portal_scope BEFORE INSERT OR UPDATE ON public.client_portal_access
  FOR EACH ROW EXECUTE FUNCTION private.guard_driver_account_scope_v1();
CREATE TRIGGER guard_driver_global_role BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION private.guard_driver_account_scope_v1();
CREATE TRIGGER guard_driver_registry_link BEFORE INSERT OR UPDATE OF user_id,tenant_id ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION private.guard_driver_account_scope_v1();

REVOKE ALL ON FUNCTION public.prepare_driver_access_v1(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_driver_access_v1(uuid,uuid,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.driver_access_scope_v1(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.driver_access_scope_v1(uuid,uuid,uuid,boolean) TO service_role;
REVOKE ALL ON FUNCTION private.guard_driver_account_scope_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.attach_invited_user_access_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite private.auth_invite_authorizations%ROWTYPE;
BEGIN
  DELETE FROM private.auth_invite_authorizations
   WHERE email = lower(btrim(coalesce(new.email, '')))
   RETURNING * INTO v_invite;

  IF v_invite.email IS NULL OR v_invite.role IS NULL THEN
    RAISE EXCEPTION 'invitation_access_not_found';
  END IF;

  IF v_invite.driver_id IS NOT NULL THEN
    -- An admin revoked after reservation cannot create a managed login. Hold
    -- this membership through attachment; the Auth INSERT rolls back on denial.
    PERFORM 1 FROM public.tenant_memberships WHERE tenant_id=v_invite.tenant_id
      AND user_id=v_invite.invited_by AND active AND role IN ('owner','admin') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'driver_access_forbidden'; END IF;
  END IF;

  IF v_invite.role = 'client' THEN
    INSERT INTO public.client_portal_access (
      tenant_id, user_id, client_id, access_type, active,
      can_view_financial, can_download_documents, can_open_occurrences,
      can_request_pickup, can_view_vehicle_live, can_view_driver_contact, created_by
    ) VALUES (
      v_invite.tenant_id, new.id, v_invite.client_id, v_invite.access_type, true,
      coalesce((v_invite.permissions->>'can_view_financial')::boolean, false),
      coalesce((v_invite.permissions->>'can_download_documents')::boolean, false),
      coalesce((v_invite.permissions->>'can_open_occurrences')::boolean, false),
      coalesce((v_invite.permissions->>'can_request_pickup')::boolean, false),
      coalesce((v_invite.permissions->>'can_view_vehicle_live')::boolean, false),
      coalesce((v_invite.permissions->>'can_view_driver_contact')::boolean, false),
      v_invite.invited_by
    );
  ELSE
    INSERT INTO public.tenant_memberships (tenant_id, user_id, role, active)
    VALUES (v_invite.tenant_id, new.id, v_invite.role, true);
  END IF;
  IF v_invite.driver_id IS NOT NULL THEN
    IF v_invite.role <> 'driver'
      OR coalesce(new.raw_app_meta_data->>'driver_username_managed','false') <> 'true'
      OR (new.raw_app_meta_data->>'driver_access_tenant_id')::uuid IS DISTINCT FROM v_invite.tenant_id THEN
      RAISE EXCEPTION 'invalid_driver_account';
    END IF;
    UPDATE public.drivers SET user_id=new.id
      WHERE id=v_invite.driver_id AND tenant_id=v_invite.tenant_id AND active AND user_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'driver_unavailable_or_already_linked'; END IF;
  ELSIF v_invite.role='driver' THEN
    RAISE EXCEPTION 'driver_accounts_require_username_creation';
  END IF;
  RETURN new;
END;
$$;


CREATE OR REPLACE FUNCTION public.prepare_auth_invite_v2(
  _email text,
  _tenant_id uuid,
  _invited_by uuid,
  _nonce text,
  _role public.app_role,
  _client_id uuid DEFAULT NULL,
  _access_type text DEFAULT NULL,
  _permissions jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(_email, '')));
BEGIN
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR coalesce(length(_nonce), 0) < 32 THEN
    RAISE EXCEPTION 'invalid_invitation';
  END IF;
  IF _role = 'owner' OR (_role = 'client' AND (_client_id IS NULL OR _access_type IS NULL)) THEN
    RAISE EXCEPTION 'invalid_invitation_access';
  END IF;
  IF _client_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clients WHERE id = _client_id AND tenant_id = _tenant_id AND active = true
  ) THEN
    RAISE EXCEPTION 'invalid_invitation_client';
  END IF;

  DELETE FROM private.auth_invite_authorizations WHERE expires_at <= clock_timestamp();
  INSERT INTO private.auth_invite_authorizations (
    email, nonce_hash, tenant_id, invited_by, expires_at,
    role, client_id, access_type, permissions
  ) VALUES (
    v_email, extensions.digest(convert_to(_nonce, 'UTF8'), 'sha256'),
    _tenant_id, _invited_by, clock_timestamp() + interval '10 minutes',
    _role, _client_id, _access_type, coalesce(_permissions, '{}'::jsonb)
  )
  ON CONFLICT (email) DO UPDATE SET
    nonce_hash = excluded.nonce_hash,
    tenant_id = excluded.tenant_id,
    invited_by = excluded.invited_by,
    created_at = clock_timestamp(),
    expires_at = excluded.expires_at,
    role = excluded.role,
    client_id = excluded.client_id,
    access_type = excluded.access_type,
    permissions = excluded.permissions, driver_id = NULL;
END;
$$;


