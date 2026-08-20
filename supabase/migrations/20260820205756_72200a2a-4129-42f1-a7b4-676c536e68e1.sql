CREATE OR REPLACE FUNCTION public.get_next_load_number_v1(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_max_num integer;
BEGIN
  SELECT MAX(NULLIF(regexp_replace(load_number, '\D', '', 'g'), '')::integer)
  INTO v_max_num
  FROM public.loads
  WHERE tenant_id = p_tenant_id;
  
  IF v_max_num IS NULL OR v_max_num < 1000 THEN
    RETURN '1000';
  ELSE
    RETURN (v_max_num + 1)::text;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_next_load_number_v1(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_next_load_number_v1(uuid) TO authenticated;