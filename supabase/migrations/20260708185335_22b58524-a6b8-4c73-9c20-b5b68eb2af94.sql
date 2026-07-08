
-- 1. get_client_portal_tracking
CREATE OR REPLACE FUNCTION public.get_client_portal_tracking(_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  WITH allowed AS (
    SELECT client_id,
           bool_or(can_view_vehicle_live)   AS can_vehicle,
           bool_or(can_view_driver_contact) AS can_driver
    FROM public.client_portal_access
    WHERE tenant_id = _tenant_id
      AND user_id = auth.uid()
      AND active = true
    GROUP BY client_id
  ),
  base AS (
    SELECT DISTINCT
      l.id              AS load_id,
      l.load_number,
      l.status,
      l.updated_at,
      fd.client_id,
      a.can_vehicle,
      a.can_driver
    FROM public.fiscal_documents fd
    JOIN allowed a ON a.client_id = fd.client_id
    JOIN public.loads l ON l.id = fd.load_id
    WHERE fd.tenant_id = _tenant_id
      AND l.status IN ('planned','in_transit','arrived','loading','out_for_delivery')
  ),
  enriched AS (
    SELECT
      b.*,
      dt.id                 AS trip_id,
      dt.vehicle_id,
      dt.driver_id,
      dt.actual_start_at,
      dt.planned_end_at,
      v.plate,
      v.nickname            AS vehicle_nickname,
      d.name                AS driver_name,
      d.phone               AS driver_phone,
      pl.lat,
      pl.lng,
      pl.speed,
      pl.captured_at,
      (SELECT jsonb_build_object(
          'id', ds.id,
          'sequence', ds.sequence,
          'destination', ds.destination,
          'city', ds.city,
          'state', ds.state,
          'planned_arrival_at', ds.planned_arrival_at
        )
        FROM public.dispatch_stops ds
        WHERE ds.dispatch_trip_id = dt.id
          AND ds.actual_departure_at IS NULL
        ORDER BY ds.sequence ASC
        LIMIT 1) AS next_stop
    FROM base b
    LEFT JOIN public.dispatch_trip_loads dtl ON dtl.load_id = b.load_id
    LEFT JOIN public.dispatch_trips dt ON dt.id = dtl.dispatch_trip_id
    LEFT JOIN public.vehicles v ON v.id = dt.vehicle_id
    LEFT JOIN public.drivers d ON d.id = dt.driver_id
    LEFT JOIN public.positions_last pl
      ON pl.tenant_id = _tenant_id AND pl.vehicle_id = dt.vehicle_id
  )
  SELECT jsonb_build_object(
    'items', COALESCE(jsonb_agg(
      jsonb_build_object(
        'load_id', load_id,
        'load_number', load_number,
        'status', status,
        'updated_at', updated_at,
        'client_id', client_id,
        'trip_id', trip_id,
        'plate',            CASE WHEN can_vehicle THEN plate            ELSE NULL END,
        'vehicle_nickname', CASE WHEN can_vehicle THEN vehicle_nickname ELSE NULL END,
        'lat',              CASE WHEN can_vehicle THEN lat              ELSE NULL END,
        'lng',              CASE WHEN can_vehicle THEN lng              ELSE NULL END,
        'speed',            CASE WHEN can_vehicle THEN speed            ELSE NULL END,
        'captured_at',      CASE WHEN can_vehicle THEN captured_at      ELSE NULL END,
        'driver_name',      CASE WHEN can_driver  THEN driver_name      ELSE NULL END,
        'driver_phone',     CASE WHEN can_driver  THEN driver_phone     ELSE NULL END,
        'actual_start_at',  actual_start_at,
        'planned_end_at',   planned_end_at,
        'next_stop', next_stop,
        'can_view_vehicle_live', can_vehicle,
        'can_view_driver_contact', can_driver
      ) ORDER BY updated_at DESC
    ), '[]'::jsonb)
  ) INTO v_result
  FROM enriched;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_portal_tracking(uuid) TO authenticated, service_role;

-- 2. client_occurrence_messages
CREATE TABLE IF NOT EXISTS public.client_occurrence_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  occurrence_id uuid NOT NULL REFERENCES public.operational_events(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES auth.users(id),
  author_role text NOT NULL CHECK (author_role IN ('client','operator')),
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_com_occurrence ON public.client_occurrence_messages(occurrence_id, created_at);
CREATE INDEX IF NOT EXISTS idx_com_tenant     ON public.client_occurrence_messages(tenant_id);

GRANT SELECT, INSERT ON public.client_occurrence_messages TO authenticated;
GRANT ALL ON public.client_occurrence_messages TO service_role;

ALTER TABLE public.client_occurrence_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS com_deny_all ON public.client_occurrence_messages;
CREATE POLICY com_deny_all ON public.client_occurrence_messages
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- 3. list_client_occurrence_messages
CREATE OR REPLACE FUNCTION public.list_client_occurrence_messages(
  _tenant_id uuid,
  _occurrence_id uuid
)
RETURNS TABLE (
  id uuid,
  author_role text,
  author_name text,
  message text,
  created_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client uuid;
BEGIN
  SELECT client_id INTO v_client
  FROM public.operational_events
  WHERE id = _occurrence_id AND tenant_id = _tenant_id;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'Occurrence not found';
  END IF;
  IF NOT (v_client = ANY(public._portal_user_client_ids(_tenant_id))) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN QUERY
  SELECT m.id,
         m.author_role,
         COALESCE(p.full_name, CASE WHEN m.author_role = 'client' THEN 'Cliente' ELSE 'Operador' END) AS author_name,
         m.message,
         m.created_at
  FROM public.client_occurrence_messages m
  LEFT JOIN public.profiles p ON p.id = m.author_user_id
  WHERE m.tenant_id = _tenant_id
    AND m.occurrence_id = _occurrence_id
  ORDER BY m.created_at ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_client_occurrence_messages(uuid, uuid) TO authenticated, service_role;

-- 4. reply_client_occurrence
CREATE OR REPLACE FUNCTION public.reply_client_occurrence(
  _tenant_id uuid,
  _occurrence_id uuid,
  _message text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client uuid;
  v_id uuid;
BEGIN
  IF _message IS NULL OR btrim(_message) = '' THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;

  SELECT client_id INTO v_client
  FROM public.operational_events
  WHERE id = _occurrence_id AND tenant_id = _tenant_id;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'Occurrence not found';
  END IF;
  IF NOT (v_client = ANY(public._portal_user_client_ids(_tenant_id))) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  INSERT INTO public.client_occurrence_messages (
    tenant_id, occurrence_id, author_user_id, author_role, message
  ) VALUES (
    _tenant_id, _occurrence_id, auth.uid(), 'client', btrim(_message)
  ) RETURNING id INTO v_id;

  UPDATE public.operational_events
     SET client_opened = true,
         updated_at = now()
   WHERE id = _occurrence_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reply_client_occurrence(uuid, uuid, text) TO authenticated, service_role;

-- 5. cancel_client_pickup
CREATE OR REPLACE FUNCTION public.cancel_client_pickup(
  _tenant_id uuid,
  _pickup_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client uuid;
  v_status text;
BEGIN
  SELECT remitter_client_id, status INTO v_client, v_status
  FROM public.pickup_orders
  WHERE id = _pickup_id AND tenant_id = _tenant_id;
  IF v_client IS NULL THEN
    RAISE EXCEPTION 'Pickup not found';
  END IF;
  IF NOT public._portal_user_has_perm(_tenant_id, v_client, 'can_request_pickup') THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;
  IF v_status NOT IN ('pendente') THEN
    RAISE EXCEPTION 'Only pending pickups can be cancelled';
  END IF;

  UPDATE public.pickup_orders
     SET status = 'cancelada',
         updated_at = now()
   WHERE id = _pickup_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_client_pickup(uuid, uuid) TO authenticated, service_role;
