
-- ===== 1. dispatch_trip_loads =====
CREATE TABLE public.dispatch_trip_loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  dispatch_trip_id uuid NOT NULL REFERENCES public.dispatch_trips(id) ON DELETE CASCADE,
  load_id uuid NOT NULL REFERENCES public.loads(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dispatch_trip_id, load_id)
);
CREATE INDEX idx_dispatch_trip_loads_tenant ON public.dispatch_trip_loads(tenant_id);
CREATE INDEX idx_dispatch_trip_loads_trip ON public.dispatch_trip_loads(dispatch_trip_id);
CREATE INDEX idx_dispatch_trip_loads_load ON public.dispatch_trip_loads(load_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_trip_loads TO authenticated;
GRANT ALL ON public.dispatch_trip_loads TO service_role;

ALTER TABLE public.dispatch_trip_loads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read dispatch_trip_loads"
  ON public.dispatch_trip_loads FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members write dispatch_trip_loads"
  ON public.dispatch_trip_loads FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members update dispatch_trip_loads"
  ON public.dispatch_trip_loads FOR UPDATE TO authenticated
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members delete dispatch_trip_loads"
  ON public.dispatch_trip_loads FOR DELETE TO authenticated
  USING (public.is_tenant_member(tenant_id));

-- ===== 2. dispatch_stop_documents =====
CREATE TABLE public.dispatch_stop_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  dispatch_stop_id uuid NOT NULL REFERENCES public.dispatch_stops(id) ON DELETE CASCADE,
  fiscal_document_id uuid NOT NULL REFERENCES public.fiscal_documents(id) ON DELETE CASCADE,
  load_id uuid REFERENCES public.loads(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dispatch_stop_id, fiscal_document_id)
);
CREATE INDEX idx_dispatch_stop_documents_tenant ON public.dispatch_stop_documents(tenant_id);
CREATE INDEX idx_dispatch_stop_documents_stop ON public.dispatch_stop_documents(dispatch_stop_id);
CREATE INDEX idx_dispatch_stop_documents_doc ON public.dispatch_stop_documents(fiscal_document_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.dispatch_stop_documents TO authenticated;
GRANT ALL ON public.dispatch_stop_documents TO service_role;

ALTER TABLE public.dispatch_stop_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read dispatch_stop_documents"
  ON public.dispatch_stop_documents FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members write dispatch_stop_documents"
  ON public.dispatch_stop_documents FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members update dispatch_stop_documents"
  ON public.dispatch_stop_documents FOR UPDATE TO authenticated
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members delete dispatch_stop_documents"
  ON public.dispatch_stop_documents FOR DELETE TO authenticated
  USING (public.is_tenant_member(tenant_id));

-- ===== 3. route_planning_stop_drafts =====
CREATE TABLE public.route_planning_stop_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  planning_draft_id uuid REFERENCES public.route_planning_drafts(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id),
  recipient_name text,
  destination text,
  city text,
  state text,
  neighborhood text,
  load_ids uuid[] NOT NULL DEFAULT '{}',
  fiscal_document_ids uuid[] NOT NULL DEFAULT '{}',
  invoice_numbers text[] NOT NULL DEFAULT '{}',
  total_weight_kg numeric DEFAULT 0,
  total_volume_m3 numeric DEFAULT 0,
  total_pallet_count numeric DEFAULT 0,
  total_value numeric DEFAULT 0,
  original_order integer,
  optimized_order integer,
  manual_order integer,
  planned_arrival_at timestamptz,
  estimated_departure_at timestamptz,
  service_time_minutes integer DEFAULT 20,
  delivery_window_start time,
  delivery_window_end time,
  priority integer DEFAULT 0,
  status text DEFAULT 'planned',
  risk_level text DEFAULT 'normal',
  risk_reason text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_rp_stop_drafts_tenant ON public.route_planning_stop_drafts(tenant_id);
CREATE INDEX idx_rp_stop_drafts_planning ON public.route_planning_stop_drafts(planning_draft_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_planning_stop_drafts TO authenticated;
GRANT ALL ON public.route_planning_stop_drafts TO service_role;

ALTER TABLE public.route_planning_stop_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read rp_stop_drafts"
  ON public.route_planning_stop_drafts FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members insert rp_stop_drafts"
  ON public.route_planning_stop_drafts FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members update rp_stop_drafts"
  ON public.route_planning_stop_drafts FOR UPDATE TO authenticated
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members delete rp_stop_drafts"
  ON public.route_planning_stop_drafts FOR DELETE TO authenticated
  USING (public.is_tenant_member(tenant_id));

-- ===== 4. customer_delivery_windows =====
CREATE TABLE public.customer_delivery_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  weekday integer NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX idx_cdw_tenant ON public.customer_delivery_windows(tenant_id);
CREATE INDEX idx_cdw_client ON public.customer_delivery_windows(client_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_delivery_windows TO authenticated;
GRANT ALL ON public.customer_delivery_windows TO service_role;

ALTER TABLE public.customer_delivery_windows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read cdw"
  ON public.customer_delivery_windows FOR SELECT TO authenticated
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members insert cdw"
  ON public.customer_delivery_windows FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members update cdw"
  ON public.customer_delivery_windows FOR UPDATE TO authenticated
  USING (public.is_tenant_member(tenant_id));
CREATE POLICY "Tenant members delete cdw"
  ON public.customer_delivery_windows FOR DELETE TO authenticated
  USING (public.is_tenant_member(tenant_id));

-- ===== 5. Additive columns on dispatch_stops =====
ALTER TABLE public.dispatch_stops
  ADD COLUMN IF NOT EXISTS estimated_departure_at timestamptz,
  ADD COLUMN IF NOT EXISTS service_time_minutes integer DEFAULT 20,
  ADD COLUMN IF NOT EXISTS delivery_window_start time,
  ADD COLUMN IF NOT EXISTS delivery_window_end time,
  ADD COLUMN IF NOT EXISTS latitude numeric,
  ADD COLUMN IF NOT EXISTS longitude numeric,
  ADD COLUMN IF NOT EXISTS risk_level text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS risk_reason text;

-- ===== 6. Additive columns on route_planning_drafts =====
ALTER TABLE public.route_planning_drafts
  ADD COLUMN IF NOT EXISTS load_ids uuid[],
  ADD COLUMN IF NOT EXISTS planned_date date,
  ADD COLUMN IF NOT EXISTS driver_id uuid,
  ADD COLUMN IF NOT EXISTS planned_start_at timestamptz,
  ADD COLUMN IF NOT EXISTS route_config jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS optimization_summary jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS validation_summary jsonb DEFAULT '{}'::jsonb;

-- ===== 7. Atomic dispatch RPC =====
CREATE OR REPLACE FUNCTION public.dispatch_planned_route(_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid := (_payload->>'tenant_id')::uuid;
  _vehicle_id uuid := NULLIF(_payload->>'vehicle_id','')::uuid;
  _driver_id uuid := NULLIF(_payload->>'driver_id','')::uuid;
  _planned_start_at timestamptz := NULLIF(_payload->>'planned_start_at','')::timestamptz;
  _route_name text := _payload->>'route_name';
  _planning_draft_id uuid := NULLIF(_payload->>'planning_draft_id','')::uuid;
  _load_ids uuid[];
  _stops jsonb := COALESCE(_payload->'stops','[]'::jsonb);
  _trip_id uuid;
  _primary_load uuid;
  _stop jsonb;
  _stop_id uuid;
  _stop_order int;
  _bad_count int;
  _fd_id uuid;
BEGIN
  IF _tenant_id IS NULL OR NOT public.is_tenant_member(_tenant_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF _vehicle_id IS NULL THEN RAISE EXCEPTION 'vehicle_id obrigatório'; END IF;
  IF _driver_id IS NULL THEN RAISE EXCEPTION 'driver_id obrigatório'; END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(_payload->'load_ids'))::uuid[] INTO _load_ids;
  IF _load_ids IS NULL OR array_length(_load_ids,1) IS NULL THEN
    RAISE EXCEPTION 'load_ids vazio';
  END IF;
  IF jsonb_array_length(_stops) = 0 THEN
    RAISE EXCEPTION 'stops vazio';
  END IF;

  -- validar posse das cargas e ausência de trip_id
  SELECT count(*) INTO _bad_count FROM public.loads
    WHERE id = ANY(_load_ids)
      AND (tenant_id <> _tenant_id OR trip_id IS NOT NULL);
  IF _bad_count > 0 THEN
    RAISE EXCEPTION 'Carga inválida ou já vinculada a viagem';
  END IF;

  _primary_load := _load_ids[1];

  INSERT INTO public.dispatch_trips(
    tenant_id, vehicle_id, driver_id, load_id, status,
    planned_start_at, notes, created_by
  ) VALUES (
    _tenant_id, _vehicle_id, _driver_id, _primary_load, 'planned',
    _planned_start_at, COALESCE(_route_name,'Rota planejada'), auth.uid()
  )
  RETURNING id INTO _trip_id;

  INSERT INTO public.dispatch_trip_loads(tenant_id, dispatch_trip_id, load_id)
  SELECT _tenant_id, _trip_id, unnest(_load_ids);

  UPDATE public.loads
    SET trip_id = _trip_id,
        vehicle_id = _vehicle_id,
        driver_id = _driver_id,
        status = 'loading',
        updated_at = now()
    WHERE id = ANY(_load_ids);

  _stop_order := 0;
  FOR _stop IN SELECT * FROM jsonb_array_elements(_stops)
  LOOP
    _stop_order := _stop_order + 1;

    INSERT INTO public.dispatch_stops(
      tenant_id, dispatch_trip_id, stop_order, destination, client_id,
      planned_arrival_at, estimated_departure_at, service_time_minutes,
      delivery_window_start, delivery_window_end,
      risk_level, risk_reason, notes, status
    ) VALUES (
      _tenant_id, _trip_id, _stop_order,
      _stop->>'destination',
      NULLIF(_stop->>'client_id','')::uuid,
      NULLIF(_stop->>'planned_arrival_at','')::timestamptz,
      NULLIF(_stop->>'estimated_departure_at','')::timestamptz,
      COALESCE((_stop->>'service_time_minutes')::int, 20),
      NULLIF(_stop->>'delivery_window_start','')::time,
      NULLIF(_stop->>'delivery_window_end','')::time,
      COALESCE(_stop->>'risk_level','normal'),
      _stop->>'risk_reason',
      _stop->>'notes',
      'pending'
    )
    RETURNING id INTO _stop_id;

    IF jsonb_typeof(_stop->'fiscal_document_ids') = 'array' THEN
      FOR _fd_id IN SELECT (jsonb_array_elements_text(_stop->'fiscal_document_ids'))::uuid
      LOOP
        INSERT INTO public.dispatch_stop_documents(
          tenant_id, dispatch_stop_id, fiscal_document_id, load_id
        )
        SELECT _tenant_id, _stop_id, _fd_id,
               (SELECT load_id FROM public.load_items WHERE fiscal_document_id = _fd_id AND load_id = ANY(_load_ids) LIMIT 1)
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;
  END LOOP;

  IF _planning_draft_id IS NOT NULL THEN
    UPDATE public.route_planning_drafts
      SET status = 'dispatched',
          converted_load_id = _primary_load,
          updated_at = now()
      WHERE id = _planning_draft_id AND tenant_id = _tenant_id;
  END IF;

  RETURN _trip_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.dispatch_planned_route(jsonb) TO authenticated;
