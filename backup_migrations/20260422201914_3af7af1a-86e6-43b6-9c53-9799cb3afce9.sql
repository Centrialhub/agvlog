CREATE UNIQUE INDEX IF NOT EXISTS loads_tenant_load_number_unique
ON public.loads (tenant_id, load_number);

CREATE OR REPLACE FUNCTION public.create_load_with_next_number(
  _tenant_id uuid,
  _origin text DEFAULT NULL,
  _destination text DEFAULT NULL,
  _vehicle_id uuid DEFAULT NULL,
  _driver_id uuid DEFAULT NULL,
  _trip_id text DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.loads
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _next_number integer;
  _created public.loads;
BEGIN
  IF NOT public.is_tenant_member(_tenant_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_tenant_id::text, 0));

  SELECT GREATEST(
    COALESCE(MAX((regexp_match(load_number, '[0-9]+$'))[1]::integer), 1000) + 1,
    1001
  )
  INTO _next_number
  FROM public.loads
  WHERE tenant_id = _tenant_id;

  INSERT INTO public.loads (
    tenant_id,
    load_number,
    origin,
    destination,
    vehicle_id,
    driver_id,
    trip_id,
    notes,
    created_by
  ) VALUES (
    _tenant_id,
    _next_number::text,
    _origin,
    _destination,
    _vehicle_id,
    _driver_id,
    _trip_id,
    _notes,
    auth.uid()
  )
  RETURNING * INTO _created;

  RETURN _created;
END;
$$;