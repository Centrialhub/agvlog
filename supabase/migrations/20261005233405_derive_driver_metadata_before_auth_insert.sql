-- WORKSPACE DRAFT ONLY; root creates the new supplemental filename with CLI.
-- Change only the invite-only BEFORE body. Never disable or weaken driver/sync
-- guards. Mark NEW from the nonce-authorized server ledger before Auth INSERT.
do $driver_auth_before$
declare
  signature regprocedure := 'private.enforce_invite_only_auth_user()'::regprocedure;
  metadata jsonb;
  original_body text;
  definition text;
  before_graph jsonb;
  after_graph jsonb;
  expected_post_hash constant text := 'fe9013b16fc8a550e293c717263c9fa8';
  patched_body constant text := $body$
DECLARE
  v_nonce text := coalesce(new.raw_user_meta_data, '{}'::jsonb) ->> 'agvlog_invite_nonce';
  v_invite private.auth_invite_authorizations%ROWTYPE;
  v_driver uuid;
  v_meta jsonb;
BEGIN
  SELECT * INTO v_invite
    FROM private.auth_invite_authorizations
   WHERE email = lower(btrim(coalesce(new.email, '')))
     AND nonce_hash = extensions.digest(convert_to(v_nonce, 'UTF8'), 'sha256')
     AND expires_at > clock_timestamp()
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User creation requires an authorized invitation' USING errcode = '28000';
  END IF;
  IF v_invite.driver_id IS NOT NULL THEN
    IF v_invite.role IS DISTINCT FROM 'driver'::public.app_role THEN
      RAISE EXCEPTION 'invalid_driver_account';
    END IF;
    PERFORM 1 FROM public.tenant_memberships
      WHERE tenant_id=v_invite.tenant_id AND user_id=v_invite.invited_by
        AND active AND role IN ('owner','admin') FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'driver_access_forbidden'; END IF;
    SELECT id INTO v_driver FROM public.drivers
      WHERE id=v_invite.driver_id AND tenant_id=v_invite.tenant_id
        AND active AND user_id IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'driver_unavailable_or_already_linked'; END IF;
    v_meta := coalesce(new.raw_app_meta_data,'{}'::jsonb);
    IF jsonb_typeof(v_meta) IS DISTINCT FROM 'object'
      OR (v_meta ? 'driver_username_managed'
        AND v_meta->'driver_username_managed' IS DISTINCT FROM 'true'::jsonb)
      OR (v_meta ? 'driver_access_tenant_id'
        AND (v_meta->>'driver_access_tenant_id')::uuid IS DISTINCT FROM v_invite.tenant_id) THEN
      RAISE EXCEPTION 'invalid_driver_account';
    END IF;
    -- user_metadata is never an authority. Provider-only initial app metadata
    -- is legitimate; trusted reservation supplies the two protected markers.
    new.raw_app_meta_data := v_meta || jsonb_build_object(
      'driver_username_managed',true,'driver_access_tenant_id',v_invite.tenant_id);
  ELSIF v_invite.role='driver' THEN
    RAISE EXCEPTION 'driver_accounts_require_username_creation';
  END IF;
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'agvlog_invite_nonce';
  RETURN new;
END;
$body$;
begin
  if to_regclass('private.auth_invite_authorizations') is null
    or not exists(select 1 from pg_attribute where attrelid='private.auth_invite_authorizations'::regclass
      and attname='driver_id' and atttypid='uuid'::regtype and not attisdropped)
    or to_regprocedure('private.attach_invited_user_access_v1()') is null
    or to_regprocedure('private.guard_driver_account_scope_v1()') is null then
    raise exception 'driver_auth_before_dependency_missing';
  end if;
  select to_jsonb(p)-'prosrc',prosrc into metadata,original_body from pg_proc p where oid=signature;
  if not exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
      join pg_language l on l.oid=p.prolang where p.oid=signature and r.rolname='postgres'
      and l.lanname='plpgsql' and p.prosecdef and p.proconfig=array['search_path=""']
      and p.prokind='f' and p.prorettype='trigger'::regtype and p.provolatile='v'
      and not p.proretset and not p.proleakproof)
    or exists(select 1 from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      where p.oid=signature and (a.grantee<>p.proowner or a.privilege_type<>'EXECUTE' or a.is_grantable)) then
    raise exception 'driver_auth_before_metadata_or_acl_changed';
  end if;
  if md5(original_body) not in('f7f4349038197d33f7edcc77fcf10749',expected_post_hash)
    or md5(patched_body) is distinct from expected_post_hash then
    raise exception 'driver_auth_before_body_changed';
  end if;
  if (select md5(prosrc) from pg_proc where oid='private.attach_invited_user_access_v1()'::regprocedure)
      is distinct from '6e6a6cd983ce9ebe27d0c4b8c31c9ed0'
    or (select md5(prosrc) from pg_proc where oid='private.guard_driver_account_scope_v1()'::regprocedure)
      is distinct from 'ffb3e58ae5f4915a997cf1b26fe587ad' then
    raise exception 'driver_auth_before_driver_graph_changed';
  end if;
  if not exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass
      and tgname='enforce_invite_only_before_auth_user_created' and tgfoid=signature
      and tgtype=7 and tgenabled='O' and tgqual is null and tgnargs=0 and octet_length(tgargs)=0 and not tgisinternal)
    or not exists(select 1 from pg_trigger where tgrelid='auth.users'::regclass
      and tgname='attach_invited_user_access_after_auth_user_created'
      and tgfoid='private.attach_invited_user_access_v1()'::regprocedure
      and tgtype=5 and tgenabled='O' and tgqual is null and tgnargs=0 and octet_length(tgargs)=0 and not tgisinternal) then
    raise exception 'driver_auth_before_trigger_changed';
  end if;
  -- Capture ALL trigger objects and non-target function objects in the relevant
  -- graph. SAFE native sync hashes were independently captured and match Git.
  select jsonb_build_object(
    'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t
      where t.tgrelid in('auth.users'::regclass,'public.tenant_memberships'::regclass,
        'public.workspace_memberships'::regclass,'public.drivers'::regclass,
        'public.client_portal_access'::regclass,'public.user_roles'::regclass)),
    'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p
      where p.oid<>signature and p.oid in(select tgfoid from pg_trigger
        where tgrelid in('auth.users'::regclass,'public.tenant_memberships'::regclass,
          'public.workspace_memberships'::regclass,'public.drivers'::regclass,
          'public.client_portal_access'::regclass,'public.user_roles'::regclass)))) into before_graph;
  if md5(original_body)='f7f4349038197d33f7edcc77fcf10749' then
    definition := pg_get_functiondef(signature);
    execute replace(definition,original_body,patched_body);
  end if;
  select jsonb_build_object(
    'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t
      where t.tgrelid in('auth.users'::regclass,'public.tenant_memberships'::regclass,
        'public.workspace_memberships'::regclass,'public.drivers'::regclass,
        'public.client_portal_access'::regclass,'public.user_roles'::regclass)),
    'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p
      where p.oid<>signature and p.oid in(select tgfoid from pg_trigger
        where tgrelid in('auth.users'::regclass,'public.tenant_memberships'::regclass,
          'public.workspace_memberships'::regclass,'public.drivers'::regclass,
          'public.client_portal_access'::regclass,'public.user_roles'::regclass)))) into after_graph;
  if after_graph is distinct from before_graph
    or (select to_jsonb(p)-'prosrc' from pg_proc p where oid=signature) is distinct from metadata
    or (select md5(prosrc) from pg_proc where oid=signature) is distinct from expected_post_hash then
    raise exception 'driver_auth_before_postcondition_failed';
  end if;
end;
$driver_auth_before$;
