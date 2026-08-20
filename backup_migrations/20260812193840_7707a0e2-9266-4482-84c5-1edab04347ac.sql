
ALTER TABLE public.driver_settlements 
ADD COLUMN IF NOT EXISTS audited_start_location text,
ADD COLUMN IF NOT EXISTS audited_end_location text;

DROP FUNCTION IF EXISTS public.update_driver_settlement_km_review(uuid, numeric, text, text, numeric, numeric);

CREATE OR REPLACE FUNCTION public.update_driver_settlement_km_review(
  _settlement_id uuid, 
  _audited_km numeric, 
  _km_status text, 
  _notes text,
  _km_start numeric DEFAULT NULL,
  _km_end numeric DEFAULT NULL,
  _audited_start_location text DEFAULT NULL,
  _audited_end_location text DEFAULT NULL
)
RETURNS public.driver_settlements 
LANGUAGE plpgsql 
SECURITY DEFINER
  SET search_path = public 
SET search_path = public 
AS $$
DECLARE 
  v_s public.driver_settlements;
BEGIN
  SELECT * INTO v_s FROM public.driver_settlements WHERE id = _settlement_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  
  IF NOT public.is_tenant_operator_or_admin(v_s.tenant_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  
  IF v_s.status = 'closed' THEN RAISE EXCEPTION 'settlement_locked'; END IF;
  
  IF _km_status NOT IN ('pending','reviewed','disputed') THEN RAISE EXCEPTION 'invalid_km_status'; END IF;
  
  UPDATE public.driver_settlements 
  SET 
    audited_km = _audited_km, 
    km_review_status = _km_status, 
    km_review_notes = _notes,
    km_start = _km_start,
    km_end = _km_end,
    audited_start_location = _audited_start_location,
    audited_end_location = _audited_end_location
  WHERE id = _settlement_id 
  RETURNING * INTO v_s;
  
  PERFORM public._log_settlement_event(
    _settlement_id, 
    'km_reviewed', 
    NULL, 
    NULL, 
    _notes,
    jsonb_build_object(
      'audited_km', _audited_km, 
      'km_status', _km_status,
      'km_start', _km_start,
      'km_end', _km_end,
      'audited_start_location', _audited_start_location,
      'audited_end_location', _audited_end_location
    )
  );
  
  RETURN v_s;
END; $$;

GRANT EXECUTE ON FUNCTION public.update_driver_settlement_km_review(uuid, numeric, text, text, numeric, numeric, text, text) TO authenticated;
