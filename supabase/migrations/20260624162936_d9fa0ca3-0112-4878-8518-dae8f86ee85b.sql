
-- ============================================================
-- AGVLog hardening — Migration 1 (driver identity + RPCs + RLS)
-- ============================================================

-- 0) Add user_id link on drivers (if absent)
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_drivers_tenant_user
  ON public.drivers(tenant_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drivers_user_id ON public.drivers(user_id);

-- ---------- Helper: assert auth.uid() owns the trip ----------
CREATE OR REPLACE FUNCTION public._assert_driver_owns_trip(_trip_id uuid)
RETURNS TABLE (driver_id uuid, tenant_id uuid, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver uuid; v_tenant uuid; v_status text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;

  SELECT t.driver_id, t.tenant_id, t.status
    INTO v_driver, v_tenant, v_status
  FROM public.dispatch_trips t WHERE t.id = _trip_id;

  IF v_driver IS NULL THEN
    RAISE EXCEPTION 'trip_not_found' USING ERRCODE='P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.drivers d
    WHERE d.id = v_driver AND d.user_id = v_uid
      AND d.tenant_id = v_tenant AND d.active = true
  ) THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE='42501';
  END IF;

  IF v_status NOT IN ('planned','loading','dispatched','in_progress','completed') THEN
    RAISE EXCEPTION 'trip_not_active' USING ERRCODE='22023';
  END IF;

  driver_id := v_driver; tenant_id := v_tenant; status := v_status;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public._assert_driver_owns_trip(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public._assert_driver_owns_trip(uuid) TO authenticated;

-- ---------- driver_mark_arrival ----------
CREATE OR REPLACE FUNCTION public.driver_mark_arrival(_stop_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_trip uuid; v_tenant uuid; v_event uuid;
BEGIN
  SELECT dispatch_trip_id, tenant_id INTO v_trip, v_tenant
  FROM public.dispatch_stops WHERE id = _stop_id;
  IF v_trip IS NULL THEN RAISE EXCEPTION 'stop_not_found'; END IF;
  PERFORM public._assert_driver_owns_trip(v_trip);

  UPDATE public.dispatch_stops
    SET status = CASE WHEN status IN ('completed','delivered','cancelled') THEN status ELSE 'arrived' END,
        actual_arrival_at = COALESCE(actual_arrival_at, now()),
        updated_at = now()
    WHERE id = _stop_id;

  INSERT INTO public.dispatch_events(tenant_id, dispatch_trip_id, dispatch_stop_id, event_type, payload, created_by)
  VALUES (v_tenant, v_trip, _stop_id, 'arrival', jsonb_build_object('source','driver_app'), auth.uid())
  RETURNING id INTO v_event;

  UPDATE public.dispatch_trips
    SET status='in_progress', actual_start_at = COALESCE(actual_start_at, now()), updated_at = now()
    WHERE id = v_trip AND status IN ('planned','loading','dispatched');
  RETURN v_event;
END; $$;
GRANT EXECUTE ON FUNCTION public.driver_mark_arrival(uuid) TO authenticated;

-- ---------- driver_create_event ----------
CREATE OR REPLACE FUNCTION public.driver_create_event(
  _trip_id uuid, _event_type text, _payload jsonb DEFAULT '{}'::jsonb,
  _stop_id uuid DEFAULT NULL, _notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public._assert_driver_owns_trip(_trip_id);
  IF _event_type IS NULL OR length(_event_type) = 0 THEN RAISE EXCEPTION 'event_type_required'; END IF;
  IF _stop_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.dispatch_stops WHERE id=_stop_id AND dispatch_trip_id=_trip_id
  ) THEN RAISE EXCEPTION 'stop_not_in_trip'; END IF;
  INSERT INTO public.dispatch_events(tenant_id, dispatch_trip_id, dispatch_stop_id, event_type, payload, notes, created_by)
  VALUES (v_tenant, _trip_id, _stop_id, _event_type, COALESCE(_payload,'{}'::jsonb), _notes, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.driver_create_event(uuid,text,jsonb,uuid,text) TO authenticated;

-- ---------- driver_save_checklist ----------
CREATE OR REPLACE FUNCTION public.driver_save_checklist(
  _trip_id uuid, _kind text, _payload jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_type text; v_id uuid;
BEGIN
  IF _kind NOT IN ('pre','post') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  v_type := CASE _kind WHEN 'pre' THEN 'checklist_pre' ELSE 'checklist_post' END;
  SELECT tenant_id INTO v_tenant FROM public._assert_driver_owns_trip(_trip_id);
  INSERT INTO public.dispatch_events(tenant_id, dispatch_trip_id, event_type, payload, created_by)
  VALUES (v_tenant, _trip_id, v_type, COALESCE(_payload,'{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.driver_save_checklist(uuid,text,jsonb) TO authenticated;

-- ---------- driver_create_expense ----------
CREATE OR REPLACE FUNCTION public.driver_create_expense(
  _trip_id uuid, _category text, _amount numeric,
  _notes text DEFAULT NULL, _receipt_path text DEFAULT NULL,
  _expense_at timestamptz DEFAULT now()
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_driver uuid; v_id uuid;
BEGIN
  SELECT driver_id, tenant_id INTO v_driver, v_tenant FROM public._assert_driver_owns_trip(_trip_id);
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'amount_invalid'; END IF;
  IF _category IS NULL OR length(_category) = 0 THEN RAISE EXCEPTION 'category_required'; END IF;
  INSERT INTO public.driver_expenses(
    tenant_id, dispatch_trip_id, driver_id, category, amount,
    expense_at, receipt_url, notes, approval_status
  ) VALUES (
    v_tenant, _trip_id, v_driver, _category, _amount,
    COALESCE(_expense_at, now()), _receipt_path, _notes, 'pending'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END; $$;
GRANT EXECUTE ON FUNCTION public.driver_create_expense(uuid,text,numeric,text,text,timestamptz) TO authenticated;

-- ---------- driver_finalize_delivery (new, authoritative) ----------
DROP FUNCTION IF EXISTS public.finalize_driver_delivery(uuid,text,text,text,text,text[],text,uuid);
DROP FUNCTION IF EXISTS public.finalize_driver_delivery(uuid,text,text,text[],uuid);

CREATE OR REPLACE FUNCTION public.driver_finalize_delivery(
  _stop_id uuid,
  _receiver_name text,
  _signature_path text DEFAULT NULL,
  _photo_paths text[] DEFAULT ARRAY[]::text[],
  _receiver_document text DEFAULT NULL,
  _receiver_role text DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_trip uuid; v_tenant uuid; v_load uuid; v_stop_status text;
  v_event uuid; v_pod_ids uuid[] := ARRAY[]::uuid[]; v_pod uuid;
  v_fd uuid; v_pending int; v_proof_type text;
BEGIN
  SELECT dispatch_trip_id, tenant_id, status
    INTO v_trip, v_tenant, v_stop_status
  FROM public.dispatch_stops WHERE id = _stop_id;
  IF v_trip IS NULL THEN RAISE EXCEPTION 'stop_not_found'; END IF;

  PERFORM public._assert_driver_owns_trip(v_trip);

  IF v_stop_status IN ('completed','delivered','cancelled') THEN
    RAISE EXCEPTION 'stop_already_completed';
  END IF;
  IF _receiver_name IS NULL OR length(btrim(_receiver_name)) < 2 THEN
    RAISE EXCEPTION 'receiver_required';
  END IF;

  SELECT load_id INTO v_load FROM public.dispatch_trips WHERE id = v_trip;

  INSERT INTO public.dispatch_events(
    tenant_id, dispatch_trip_id, dispatch_stop_id, event_type, notes, payload, created_by
  ) VALUES (
    v_tenant, v_trip, _stop_id, 'delivery_delivered', _notes,
    jsonb_build_object(
      'event_subtype','entregue',
      'receiver_name', btrim(_receiver_name),
      'receiver_document', NULLIF(btrim(coalesce(_receiver_document,'')),''),
      'receiver_role', NULLIF(btrim(coalesce(_receiver_role,'')),''),
      'photo_paths', coalesce(to_jsonb(_photo_paths),'[]'::jsonb),
      'signature_path', _signature_path
    ),
    auth.uid()
  ) RETURNING id INTO v_event;

  UPDATE public.dispatch_stops
    SET status='completed',
        actual_arrival_at = COALESCE(actual_arrival_at, now()),
        actual_departure_at = now(),
        notes = COALESCE(_notes, notes),
        updated_at = now()
    WHERE id = _stop_id;

  v_proof_type := CASE WHEN _signature_path IS NOT NULL THEN 'receiver_confirmation' ELSE 'delivery_photo' END;

  FOR v_fd IN
    SELECT dsd.fiscal_document_id
    FROM public.dispatch_stop_documents dsd
    JOIN public.fiscal_documents fd ON fd.id = dsd.fiscal_document_id
    WHERE dsd.dispatch_stop_id = _stop_id
      AND dsd.tenant_id = v_tenant
      AND fd.tenant_id = v_tenant
  LOOP
    INSERT INTO public.proof_of_delivery(
      tenant_id, fiscal_document_id, load_id, dispatch_trip_id, dispatch_stop_id,
      proof_type, status, storage_bucket, storage_path,
      receiver_name, receiver_document, receiver_role, received_at, metadata
    ) VALUES (
      v_tenant, v_fd, v_load, v_trip, _stop_id,
      v_proof_type, 'uploaded', 'receipts',
      COALESCE(_signature_path, CASE WHEN array_length(_photo_paths,1) > 0 THEN _photo_paths[1] END),
      btrim(_receiver_name),
      NULLIF(btrim(coalesce(_receiver_document,'')),''),
      NULLIF(btrim(coalesce(_receiver_role,'')),''),
      now(),
      jsonb_build_object('photo_paths', coalesce(to_jsonb(_photo_paths),'[]'::jsonb),
                         'signature_path', _signature_path,
                         'event_id', v_event)
    )
    ON CONFLICT (fiscal_document_id) DO UPDATE SET
      status = EXCLUDED.status,
      storage_bucket = EXCLUDED.storage_bucket,
      storage_path = COALESCE(EXCLUDED.storage_path, public.proof_of_delivery.storage_path),
      receiver_name = EXCLUDED.receiver_name,
      receiver_document = COALESCE(EXCLUDED.receiver_document, public.proof_of_delivery.receiver_document),
      receiver_role = COALESCE(EXCLUDED.receiver_role, public.proof_of_delivery.receiver_role),
      received_at = EXCLUDED.received_at,
      dispatch_stop_id = EXCLUDED.dispatch_stop_id,
      dispatch_trip_id = EXCLUDED.dispatch_trip_id,
      proof_type = EXCLUDED.proof_type,
      metadata = public.proof_of_delivery.metadata || EXCLUDED.metadata,
      updated_at = now()
    RETURNING id INTO v_pod;
    v_pod_ids := v_pod_ids || v_pod;

    UPDATE public.fiscal_documents SET status='delivered', updated_at=now() WHERE id=v_fd;
  END LOOP;

  SELECT count(*) INTO v_pending FROM public.dispatch_stops
   WHERE dispatch_trip_id = v_trip
     AND status NOT IN ('completed','delivered','cancelled','skipped');
  IF v_pending = 0 THEN
    UPDATE public.dispatch_trips
       SET status='completed', actual_end_at=now(), updated_at=now()
     WHERE id = v_trip AND status <> 'completed';
    UPDATE public.loads SET status='delivered', updated_at=now()
     WHERE id = v_load AND status <> 'delivered';
  END IF;

  RETURN jsonb_build_object('event_id', v_event, 'pod_ids', to_jsonb(v_pod_ids));
END; $$;
GRANT EXECUTE ON FUNCTION public.driver_finalize_delivery(uuid,text,text,text[],text,text,text) TO authenticated;

-- Back-compat alias (frontend still calls finalize_driver_delivery)
CREATE OR REPLACE FUNCTION public.finalize_driver_delivery(
  _stop_id uuid, _receiver_name text,
  _signature_path text DEFAULT NULL,
  _photo_paths text[] DEFAULT ARRAY[]::text[],
  _fiscal_document_id uuid DEFAULT NULL  -- IGNORED (compat only)
) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT public.driver_finalize_delivery(_stop_id, _receiver_name, _signature_path, _photo_paths);
$$;
GRANT EXECUTE ON FUNCTION public.finalize_driver_delivery(uuid,text,text,text[],uuid) TO authenticated;

-- ============================================================
-- RLS: driver SELECT scopes
-- ============================================================
CREATE OR REPLACE FUNCTION public._driver_trip_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id FROM public.dispatch_trips t
  JOIN public.drivers d ON d.id = t.driver_id
  WHERE d.user_id = auth.uid() AND d.active = true;
$$;
GRANT EXECUTE ON FUNCTION public._driver_trip_ids() TO authenticated;

DROP POLICY IF EXISTS "Drivers can view own trip stops" ON public.dispatch_stops;
CREATE POLICY "Drivers can view own trip stops" ON public.dispatch_stops
  FOR SELECT TO authenticated
  USING (dispatch_trip_id IN (SELECT public._driver_trip_ids()));

DROP POLICY IF EXISTS "Drivers can view own trip events" ON public.dispatch_events;
CREATE POLICY "Drivers can view own trip events" ON public.dispatch_events
  FOR SELECT TO authenticated
  USING (dispatch_trip_id IN (SELECT public._driver_trip_ids()));

DROP POLICY IF EXISTS "Drivers can view own expenses" ON public.driver_expenses;
CREATE POLICY "Drivers can view own expenses" ON public.driver_expenses
  FOR SELECT TO authenticated
  USING (
    dispatch_trip_id IN (SELECT public._driver_trip_ids())
    OR driver_id IN (SELECT id FROM public.drivers WHERE user_id = auth.uid())
  );

-- ============================================================
-- dispatch_planned_route: require admin OR operator (block client/driver)
-- ============================================================
DO $do$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_src FROM pg_proc WHERE proname='dispatch_planned_route';
  IF v_src LIKE '%NOT public.is_tenant_member(_tenant_id)%' THEN
    EXECUTE replace(v_src,
      'NOT public.is_tenant_member(_tenant_id)',
      '(NOT public.is_tenant_admin(_tenant_id) AND NOT public.has_tenant_role(_tenant_id, ''operator''::app_role))'
    );
  END IF;
END $do$;
