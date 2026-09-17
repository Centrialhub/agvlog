ALTER TABLE private.auth_invite_authorizations
  ADD COLUMN IF NOT EXISTS role public.app_role,
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS access_type text,
  ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb;

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
    permissions = excluded.permissions;
END;
$$;

CREATE OR REPLACE FUNCTION private.enforce_invite_only_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_nonce text := coalesce(new.raw_user_meta_data, '{}'::jsonb) ->> 'agvlog_invite_nonce';
  v_authorized boolean;
BEGIN
  SELECT true INTO v_authorized
    FROM private.auth_invite_authorizations
   WHERE email = lower(btrim(coalesce(new.email, '')))
     AND nonce_hash = extensions.digest(convert_to(v_nonce, 'UTF8'), 'sha256')
     AND expires_at > clock_timestamp()
   FOR UPDATE;
  IF v_authorized IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'User creation requires an authorized invitation' USING errcode = '28000';
  END IF;
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'agvlog_invite_nonce';
  RETURN new;
END;
$$;

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
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS attach_invited_user_access_after_auth_user_created ON auth.users;
CREATE TRIGGER attach_invited_user_access_after_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.attach_invited_user_access_v1();

REVOKE ALL ON FUNCTION public.prepare_auth_invite_v2(text, uuid, uuid, text, public.app_role, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_auth_invite_v2(text, uuid, uuid, text, public.app_role, uuid, text, jsonb)
  TO service_role;
REVOKE ALL ON FUNCTION private.attach_invited_user_access_v1()
  FROM PUBLIC, anon, authenticated, service_role;
