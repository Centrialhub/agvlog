
-- finalize_driver_delivery RPC: secure, transactional delivery completion
CREATE OR REPLACE FUNCTION public.finalize_driver_delivery(
  _stop_id uuid,
  _receiver_name text,
  _receiver_document text DEFAULT NULL,
  _receiver_role text DEFAULT NULL,
  _signature_path text DEFAULT NULL,
  _photo_paths text[] DEFAULT ARRAY[]::text[],
  _notes text DEFAULT NULL,
  _fiscal_document_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver_id uuid;
  v_trip_id uuid;
  v_tenant_id uuid;
  v_load_id uuid;
  v_stop record;
  v_event_id uuid;
  v_pod_id uuid;
  v_pending_count int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT s.*, t.driver_id, t.tenant_id, t.id AS trip_id, t.load_id
    INTO v_stop
  FROM public.dispatch_stops s
  JOIN public.dispatch_trips t ON t.id = s.dispatch_trip_id
  WHERE s.id = _stop_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stop_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_trip_id := v_stop.trip_id;
  v_tenant_id := v_stop.tenant_id;
  v_load_id := v_stop.load_id;

  -- Validate driver identity: auth.uid -> drivers.user_id -> trip.driver_id
  SELECT id INTO v_driver_id
  FROM public.drivers
  WHERE user_id = v_uid
    AND tenant_id = v_tenant_id
    AND active = true
  LIMIT 1;

  IF v_driver_id IS NULL OR v_driver_id <> v_stop.driver_id THEN
    RAISE EXCEPTION 'access_denied' USING ERRCODE = '42501';
  END IF;

  IF v_stop.status = 'completed' THEN
    RAISE EXCEPTION 'stop_already_completed' USING ERRCODE = '22023';
  END IF;

  IF _receiver_name IS NULL OR length(btrim(_receiver_name)) < 2 THEN
    RAISE EXCEPTION 'receiver_required' USING ERRCODE = '22023';
  END IF;

  -- 1) Insert dispatch_event
  INSERT INTO public.dispatch_events(
    tenant_id, dispatch_trip_id, dispatch_stop_id,
    event_type, notes, payload, created_by
  ) VALUES (
    v_tenant_id, v_trip_id, _stop_id,
    'delivery_delivered', _notes,
    jsonb_build_object(
      'event_subtype', 'entregue',
      'event_label', 'ENTREGUE',
      'receiver_name', btrim(_receiver_name),
      'receiver_document', NULLIF(btrim(coalesce(_receiver_document,'')),''),
      'receiver_role', NULLIF(btrim(coalesce(_receiver_role,'')),''),
      'photo_paths', coalesce(to_jsonb(_photo_paths), '[]'::jsonb),
      'photo_count', coalesce(array_length(_photo_paths,1),0),
      'signature_path', _signature_path,
      'fiscal_document_id', _fiscal_document_id
    ),
    v_uid
  ) RETURNING id INTO v_event_id;

  -- 2) Update stop -> completed
  UPDATE public.dispatch_stops
  SET status = 'completed',
      actual_departure_at = now(),
      actual_arrival_at = COALESCE(actual_arrival_at, now()),
      notes = COALESCE(_notes, notes),
      updated_at = now()
  WHERE id = _stop_id;

  -- 3) Upsert proof_of_delivery (per fiscal_document)
  IF _fiscal_document_id IS NOT NULL THEN
    INSERT INTO public.proof_of_delivery(
      tenant_id, fiscal_document_id, load_id, dispatch_trip_id, dispatch_stop_id,
      proof_type, status, storage_bucket, storage_path,
      receiver_name, receiver_document, receiver_role, received_at, metadata
    ) VALUES (
      v_tenant_id, _fiscal_document_id, v_load_id, v_trip_id, _stop_id,
      'delivery_signed', 'received', 'receipts',
      COALESCE(_signature_path, CASE WHEN array_length(_photo_paths,1) > 0 THEN _photo_paths[1] ELSE NULL END),
      btrim(_receiver_name),
      NULLIF(btrim(coalesce(_receiver_document,'')),''),
      NULLIF(btrim(coalesce(_receiver_role,'')),''),
      now(),
      jsonb_build_object(
        'photo_paths', coalesce(to_jsonb(_photo_paths), '[]'::jsonb),
        'signature_path', _signature_path,
        'event_id', v_event_id
      )
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
      metadata = public.proof_of_delivery.metadata || EXCLUDED.metadata,
      updated_at = now()
    RETURNING id INTO v_pod_id;
  END IF;

  -- 4) Auto-progress trip from planned -> in_progress at first finalization
  UPDATE public.dispatch_trips
  SET status = 'in_progress',
      actual_start_at = COALESCE(actual_start_at, now()),
      updated_at = now()
  WHERE id = v_trip_id AND status IN ('planned','loading','dispatched');

  -- 5) If no more pending stops, close trip and load
  SELECT count(*) INTO v_pending_count
  FROM public.dispatch_stops
  WHERE dispatch_trip_id = v_trip_id
    AND status NOT IN ('completed','cancelled','skipped');

  IF v_pending_count = 0 THEN
    UPDATE public.dispatch_trips
    SET status = 'completed',
        actual_end_at = now(),
        updated_at = now()
    WHERE id = v_trip_id;

    IF v_load_id IS NOT NULL THEN
      UPDATE public.loads
      SET status = 'delivered',
          updated_at = now()
      WHERE id = v_load_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'pod_id', v_pod_id,
    'trip_completed', v_pending_count = 0,
    'pending_stops', v_pending_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_driver_delivery(uuid, text, text, text, text, text[], text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_driver_delivery(uuid, text, text, text, text, text[], text, uuid) TO authenticated;

-- Ensure unique constraint exists on proof_of_delivery.fiscal_document_id for ON CONFLICT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_pod_fiscal_document'
  ) THEN
    BEGIN
      ALTER TABLE public.proof_of_delivery
        ADD CONSTRAINT uq_pod_fiscal_document UNIQUE (fiscal_document_id);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
