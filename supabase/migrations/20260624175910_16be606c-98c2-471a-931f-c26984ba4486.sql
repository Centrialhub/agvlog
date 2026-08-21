-- Helpers
CREATE OR REPLACE FUNCTION public.is_tenant_operator_or_admin(_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.is_user_internal_role(_tenant_id);
$$;

CREATE OR REPLACE FUNCTION public.current_driver_id(_tenant_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT id FROM public.drivers
  WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.driver_owns_trip(_trip_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dispatch_trips dt
    JOIN public.drivers d ON d.id = dt.driver_id
    WHERE dt.id = _trip_id AND d.user_id = auth.uid() AND d.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.driver_can_access_vehicle(_vehicle_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dispatch_trips dt
    JOIN public.drivers d ON d.id = dt.driver_id
    WHERE dt.vehicle_id = _vehicle_id AND d.user_id = auth.uid() AND d.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.driver_owns_stop(_stop_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.dispatch_stops ds
    JOIN public.dispatch_trips dt ON dt.id = ds.dispatch_trip_id
    JOIN public.drivers d ON d.id = dt.driver_id
    WHERE ds.id = _stop_id AND d.user_id = auth.uid() AND d.active = true
  );
$$;

-- trip_live_status (uses trip_id)
DROP POLICY IF EXISTS trip_live_status_select_member ON public.trip_live_status;
DROP POLICY IF EXISTS trip_live_status_write_member ON public.trip_live_status;
CREATE POLICY trip_live_status_select_internal ON public.trip_live_status FOR SELECT
  USING (public.is_user_internal_role(tenant_id));
CREATE POLICY trip_live_status_select_driver ON public.trip_live_status FOR SELECT
  USING (public.driver_owns_trip(trip_id));
CREATE POLICY trip_live_status_write_internal ON public.trip_live_status FOR ALL
  USING (public.is_user_internal_role(tenant_id))
  WITH CHECK (public.is_user_internal_role(tenant_id));

-- trip_alerts
DROP POLICY IF EXISTS trip_alerts_select_member ON public.trip_alerts;
DROP POLICY IF EXISTS trip_alerts_write_member ON public.trip_alerts;
CREATE POLICY trip_alerts_select_internal ON public.trip_alerts FOR SELECT
  USING (public.is_user_internal_role(tenant_id));
CREATE POLICY trip_alerts_select_driver ON public.trip_alerts FOR SELECT
  USING (public.driver_owns_trip(trip_id));
CREATE POLICY trip_alerts_write_internal ON public.trip_alerts FOR ALL
  USING (public.is_user_internal_role(tenant_id))
  WITH CHECK (public.is_user_internal_role(tenant_id));

-- trip_routes
DROP POLICY IF EXISTS trip_routes_select_member ON public.trip_routes;
DROP POLICY IF EXISTS trip_routes_write_member ON public.trip_routes;
CREATE POLICY trip_routes_select_internal ON public.trip_routes FOR SELECT
  USING (public.is_user_internal_role(tenant_id));
CREATE POLICY trip_routes_select_driver ON public.trip_routes FOR SELECT
  USING (public.driver_owns_trip(trip_id));
CREATE POLICY trip_routes_write_internal ON public.trip_routes FOR ALL
  USING (public.is_user_internal_role(tenant_id))
  WITH CHECK (public.is_user_internal_role(tenant_id));

-- positions_last
DROP POLICY IF EXISTS "Members can view positions_last" ON public.positions_last;
CREATE POLICY positions_last_select_internal ON public.positions_last FOR SELECT
  USING (public.is_user_internal_role(tenant_id));
CREATE POLICY positions_last_select_driver ON public.positions_last FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.dispatch_trips dt
      JOIN public.drivers d ON d.id = dt.driver_id
      WHERE dt.vehicle_id = positions_last.vehicle_id
        AND d.user_id = auth.uid() AND d.active = true
        AND dt.status IN ('planned','in_progress','en_route','loading','arrived')
    )
  );

-- vehicles
DROP POLICY IF EXISTS "Members can view vehicles" ON public.vehicles;
CREATE POLICY vehicles_select_internal ON public.vehicles FOR SELECT
  USING (public.is_user_internal_role(tenant_id));
CREATE POLICY vehicles_select_driver ON public.vehicles FOR SELECT
  USING (public.driver_can_access_vehicle(id));

-- drivers
DROP POLICY IF EXISTS "Members can view drivers" ON public.drivers;
CREATE POLICY drivers_select_internal ON public.drivers FOR SELECT
  USING (public.is_user_internal_role(tenant_id));
CREATE POLICY drivers_select_self ON public.drivers FOR SELECT
  USING (user_id = auth.uid());

-- operational_events: add link columns
ALTER TABLE public.operational_events
  ADD COLUMN IF NOT EXISTS dispatch_trip_id uuid REFERENCES public.dispatch_trips(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispatch_stop_id uuid REFERENCES public.dispatch_stops(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS fiscal_document_id uuid REFERENCES public.fiscal_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_oe_trip ON public.operational_events(dispatch_trip_id);
CREATE INDEX IF NOT EXISTS idx_oe_stop ON public.operational_events(dispatch_stop_id);
CREATE INDEX IF NOT EXISTS idx_oe_fd ON public.operational_events(fiscal_document_id);

DROP POLICY IF EXISTS "Drivers view own trip operational_events" ON public.operational_events;
CREATE POLICY operational_events_select_driver ON public.operational_events FOR SELECT
  USING (
    driver_id = public.current_driver_id(tenant_id)
    OR (dispatch_trip_id IS NOT NULL AND public.driver_owns_trip(dispatch_trip_id))
    OR (dispatch_stop_id IS NOT NULL AND public.driver_owns_stop(dispatch_stop_id))
  );

-- driver_create_operational_occurrence rewrite
CREATE OR REPLACE FUNCTION public.driver_create_operational_occurrence(
  _trip_id uuid,
  _event_type text,
  _description text,
  _severity text DEFAULT 'medium',
  _stop_id uuid DEFAULT NULL,
  _client_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_driver uuid; v_tenant uuid; v_trip uuid := _trip_id; v_stop uuid := _stop_id;
  v_load uuid; v_vehicle uuid; v_client uuid := _client_id; v_fd uuid;
  v_visible boolean; v_id uuid;
  v_internal_types text[] := ARRAY['mechanical','fuel_low','driver_internal','rest','admin'];
BEGIN
  SELECT id, tenant_id INTO v_driver, v_tenant FROM public.drivers
    WHERE user_id = auth.uid() AND active = true LIMIT 1;
  IF v_driver IS NULL THEN RAISE EXCEPTION 'Motorista não autenticado'; END IF;

  IF v_trip IS NULL THEN
    SELECT id INTO v_trip FROM public.dispatch_trips
      WHERE driver_id = v_driver
        AND status IN ('planned','loading','in_progress','en_route','arrived')
      ORDER BY COALESCE(actual_start_at, planned_start_at) DESC NULLS LAST LIMIT 1;
  END IF;

  IF v_trip IS NOT NULL AND NOT public.driver_owns_trip(v_trip) THEN
    RAISE EXCEPTION 'Viagem não pertence ao motorista';
  END IF;

  IF v_trip IS NOT NULL THEN
    SELECT load_id, vehicle_id INTO v_load, v_vehicle FROM public.dispatch_trips WHERE id = v_trip;
  END IF;

  IF v_stop IS NULL AND v_trip IS NOT NULL THEN
    SELECT id INTO v_stop FROM public.dispatch_stops
      WHERE dispatch_trip_id = v_trip AND status IN ('arrived','servicing','in_progress')
      ORDER BY stop_order LIMIT 1;
    IF v_stop IS NULL THEN
      SELECT id INTO v_stop FROM public.dispatch_stops
        WHERE dispatch_trip_id = v_trip
          AND status NOT IN (SELECT unnest(public.stop_terminal_statuses()))
        ORDER BY stop_order LIMIT 1;
    END IF;
  END IF;

  IF v_stop IS NOT NULL THEN
    SELECT dsd.fiscal_document_id INTO v_fd
      FROM public.dispatch_stop_documents dsd WHERE dsd.dispatch_stop_id = v_stop LIMIT 1;
    IF v_client IS NULL AND v_fd IS NOT NULL THEN
      SELECT client_id INTO v_client FROM public.fiscal_documents WHERE id = v_fd;
    END IF;
  END IF;

  v_visible := (v_client IS NOT NULL OR v_fd IS NOT NULL)
               AND NOT (_event_type = ANY(v_internal_types));

  INSERT INTO public.dispatch_events(tenant_id, dispatch_trip_id, dispatch_stop_id, event_type, payload, notes, created_by)
  VALUES (v_tenant, v_trip, v_stop, 'occurrence',
          jsonb_build_object('source','driver_app','severity',_severity,'kind',_event_type),
          _description, auth.uid());

  INSERT INTO public.operational_events(
    tenant_id, client_id, load_id, vehicle_id, driver_id,
    dispatch_trip_id, dispatch_stop_id, fiscal_document_id,
    event_type, severity, description,
    visible_to_client, public_status, created_by
  ) VALUES (
    v_tenant, v_client, v_load, v_vehicle, v_driver,
    v_trip, v_stop, v_fd,
    _event_type, _severity, _description,
    v_visible, 'reported_by_driver', auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- get_client_portal_shipment_detail: tri-fold occurrence filter
CREATE OR REPLACE FUNCTION public.get_client_portal_shipment_detail(_fiscal_document_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE
  _fd public.fiscal_documents; _tenant uuid; _can_financial boolean := false;
  _trip_id uuid; _stop_id uuid;
BEGIN
  SELECT * INTO _fd FROM public.fiscal_documents WHERE id = _fiscal_document_id;
  IF _fd.id IS NULL THEN RAISE EXCEPTION 'Documento não encontrado'; END IF;
  _tenant := _fd.tenant_id;
  IF NOT public.portal_user_can_access_fiscal_document(_tenant, _fiscal_document_id) THEN
    RAISE EXCEPTION 'Acesso negado a este documento';
  END IF;
  _can_financial := public.portal_user_can_view_financial(_tenant, _fiscal_document_id);

  SELECT ds.dispatch_trip_id, ds.id INTO _trip_id, _stop_id
  FROM public.dispatch_stop_documents dsd
  JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
  WHERE dsd.fiscal_document_id = _fd.id LIMIT 1;

  RETURN jsonb_build_object(
    'document', jsonb_build_object(
      'id', _fd.id, 'invoice_number', _fd.invoice_number, 'access_key', _fd.access_key,
      'document_type', _fd.document_type, 'issue_date', _fd.issue_date, 'status', _fd.status,
      'client_load_number', _fd.client_load_number, 'reference_number', _fd.reference_number,
      'remitter', _fd.remitter, 'remitter_cnpj', _fd.remitter_cnpj,
      'recipient', _fd.recipient, 'recipient_cnpj', _fd.recipient_cnpj,
      'recipient_city', _fd.recipient_city, 'recipient_state', _fd.recipient_state,
      'recipient_neighborhood', _fd.recipient_neighborhood,
      'product_summary', _fd.product_summary, 'pallet_count', _fd.pallet_count, 'weight_kg', _fd.weight_kg,
      'value', CASE WHEN _can_financial THEN _fd.value END,
      'freight_value', CASE WHEN _can_financial THEN _fd.freight_value END
    ),
    'load', (SELECT jsonb_build_object('id', l.id, 'load_number', l.load_number, 'status', l.status,
              'origin', l.origin, 'destination', l.destination,
              'total_pallet_count', l.total_pallet_count, 'total_weight_kg', l.total_weight_kg)
             FROM public.loads l WHERE l.id = _fd.load_id),
    'trip', (SELECT jsonb_build_object('id', dt.id, 'status', dt.status,
              'planned_start_at', dt.planned_start_at, 'actual_start_at', dt.actual_start_at,
              'planned_end_at', dt.planned_end_at, 'actual_end_at', dt.actual_end_at)
             FROM public.dispatch_trips dt WHERE dt.id = _trip_id),
    'stop', (SELECT jsonb_build_object('id', ds.id, 'stop_order', ds.stop_order,
              'destination', ds.destination, 'status', ds.status,
              'planned_arrival_at', ds.planned_arrival_at,
              'actual_arrival_at', ds.actual_arrival_at,
              'actual_departure_at', ds.actual_departure_at)
             FROM public.dispatch_stops ds WHERE ds.id = _stop_id),
    'events', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'event_type', e.event_type,
                'notes', e.notes, 'created_at', e.created_at) ORDER BY e.created_at)
                FROM public.dispatch_events e WHERE e.dispatch_stop_id = _stop_id), '[]'::jsonb),
    'occurrences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', oe.id, 'event_type', oe.event_type,
              'severity', oe.severity, 'description', oe.description,
              'public_status', oe.public_status, 'resolved_at', oe.resolved_at,
              'created_at', oe.created_at) ORDER BY oe.created_at DESC)
      FROM public.operational_events oe
      WHERE oe.tenant_id = _tenant
        AND oe.visible_to_client = true
        AND (
          oe.fiscal_document_id = _fd.id
          OR (oe.dispatch_stop_id IS NOT NULL AND oe.dispatch_stop_id = _stop_id)
          OR (oe.client_id IS NOT NULL AND oe.client_id = _fd.client_id
              AND oe.dispatch_stop_id IS NULL AND oe.fiscal_document_id IS NULL)
        )
    ), '[]'::jsonb),
    'proofs', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', p.id, 'proof_type', p.proof_type,
                'status', p.status, 'receiver_name', p.receiver_name, 'receiver_role', p.receiver_role,
                'received_at', p.received_at, 'validated_at', p.validated_at,
                'has_file', (p.storage_path IS NOT NULL)) ORDER BY p.created_at DESC)
                FROM public.proof_of_delivery p WHERE p.fiscal_document_id = _fd.id), '[]'::jsonb)
  );
END $$;