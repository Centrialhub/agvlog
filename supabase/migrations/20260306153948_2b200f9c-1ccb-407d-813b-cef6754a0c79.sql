
-- Phase 0: Onboarding RPC (SECURITY DEFINER + SET search_path = public to bypass RLS)
CREATE OR REPLACE FUNCTION public.create_tenant_with_owner(_tenant_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _user_id uuid;
  _tenant_id uuid;
BEGIN
  _user_id := auth.uid();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Create tenant
  INSERT INTO public.tenants (name, plan_key)
  VALUES (_tenant_name, 'free')
  RETURNING id INTO _tenant_id;

  -- Create owner membership
  INSERT INTO public.tenant_memberships (tenant_id, user_id, role, active)
  VALUES (_tenant_id, _user_id, 'owner', true);

  RETURN _tenant_id;
END;
$$;
