ALTER TABLE public.tenant_emitters
  ADD CONSTRAINT tenant_emitters_default_requires_active
  CHECK (NOT is_default OR active);

CREATE OR REPLACE FUNCTION public.set_default_tenant_emitter(
  _tenant_id uuid,
  _emitter_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  _target_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT public.is_tenant_admin(_tenant_id) THEN
    RAISE EXCEPTION 'Only active tenant owners and admins can change the default emitter'
      USING ERRCODE = '42501';
  END IF;

  -- Lock the tenant emitter set in a stable order so concurrent changes serialize.
  PERFORM emitter.id
  FROM public.tenant_emitters AS emitter
  WHERE emitter.tenant_id = _tenant_id
  ORDER BY emitter.id
  FOR UPDATE;

  SELECT emitter.id
  INTO _target_id
  FROM public.tenant_emitters AS emitter
  WHERE emitter.tenant_id = _tenant_id
    AND emitter.id = _emitter_id
    AND emitter.active;

  IF _target_id IS NULL THEN
    RAISE EXCEPTION 'Active emitter not found in the selected tenant'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.tenant_emitters
  SET is_default = false
  WHERE tenant_id = _tenant_id
    AND is_default
    AND id <> _target_id;

  UPDATE public.tenant_emitters
  SET is_default = true
  WHERE tenant_id = _tenant_id
    AND id = _target_id;

  RETURN _target_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_default_tenant_emitter(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_default_tenant_emitter(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.set_default_tenant_emitter(uuid, uuid) IS
  'Atomically selects one active default emitter after tenant-admin authorization.';
