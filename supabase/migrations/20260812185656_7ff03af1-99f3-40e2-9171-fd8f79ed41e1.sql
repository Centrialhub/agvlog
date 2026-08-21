CREATE OR REPLACE FUNCTION public.list_available_loads_for_settlement(
  _tenant_id uuid,
  _driver_id uuid DEFAULT NULL,
  _search text DEFAULT NULL,
  _include_settlement_id uuid DEFAULT NULL,
  _limit int DEFAULT 200
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb) INTO v
  FROM (
    SELECT
      l.id,
      l.load_number,
      l.origin,
      l.destination,
      l.status,
      l.total_weight_kg,
      l.total_pallet_count,
      l.gross_cargo_value,
      l.freight_amount,
      l.invoice_count,
      l.load_date,
      l.driver_id,
      d.name AS driver_name,
      v.plate AS vehicle_plate
    FROM public.loads l
    LEFT JOIN public.drivers d ON d.id = l.driver_id
    LEFT JOIN public.vehicles v ON v.id = l.vehicle_id
    WHERE l.tenant_id = _tenant_id
      AND l.driver_id IS NOT NULL
      AND (_driver_id IS NULL OR l.driver_id = _driver_id)
      AND (_search IS NULL OR _search = '' OR
           l.load_number ILIKE '%'||_search||'%' OR
           l.origin ILIKE '%'||_search||'%' OR
           l.destination ILIKE '%'||_search||'%' OR
           l.external_load_number ILIKE '%'||_search||'%')
      AND public._load_available_for_settlement(_tenant_id, l.id, _include_settlement_id)
    ORDER BY l.load_date DESC NULLS LAST, l.created_at DESC
    LIMIT _limit
  ) x;
  RETURN v;
END;
$$;