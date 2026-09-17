CREATE OR REPLACE FUNCTION public.protect_tenant_owners()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_role public.app_role;
  v_tenant_id uuid := COALESCE(OLD.tenant_id, NEW.tenant_id);
  v_other_active_owners integer;
BEGIN
  -- Trusted server-side maintenance has no end-user identity and is not
  -- constrained by this API invariant.
  IF v_actor IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::text, 0));

  SELECT role
    INTO v_actor_role
    FROM public.tenant_memberships
   WHERE tenant_id = v_tenant_id
     AND user_id = v_actor
     AND active = true;

  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'owner' AND v_actor_role IS DISTINCT FROM 'owner' THEN
      -- Preserve the create_tenant_with_owner bootstrap path only.
      IF NEW.user_id <> v_actor OR EXISTS (
        SELECT 1 FROM public.tenant_memberships WHERE tenant_id = NEW.tenant_id
      ) THEN
        RAISE EXCEPTION 'only_an_owner_can_assign_owner';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW.tenant_id <> OLD.tenant_id OR NEW.user_id <> OLD.user_id) THEN
    RAISE EXCEPTION 'membership_identity_is_immutable';
  END IF;

  IF OLD.role = 'owner'
     OR (TG_OP = 'UPDATE' AND NEW.role = 'owner') THEN
    IF v_actor_role IS DISTINCT FROM 'owner' THEN
      RAISE EXCEPTION 'only_an_owner_can_manage_owners';
    END IF;
  END IF;

  IF OLD.role = 'owner' AND OLD.active = true AND (
    TG_OP = 'DELETE'
    OR NEW.role <> 'owner'
    OR NEW.active = false
  ) THEN
    SELECT count(*)
      INTO v_other_active_owners
      FROM public.tenant_memberships
     WHERE tenant_id = OLD.tenant_id
       AND role = 'owner'
       AND active = true
       AND id <> OLD.id;

    IF v_other_active_owners = 0 THEN
      RAISE EXCEPTION 'tenant_must_keep_an_active_owner';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_tenant_owners ON public.tenant_memberships;
CREATE TRIGGER trg_protect_tenant_owners
BEFORE INSERT OR UPDATE OR DELETE ON public.tenant_memberships
FOR EACH ROW EXECUTE FUNCTION public.protect_tenant_owners();

COMMENT ON FUNCTION public.protect_tenant_owners() IS
  'Prevents admins from assigning or mutating owners and preserves at least one active owner per tenant.';
