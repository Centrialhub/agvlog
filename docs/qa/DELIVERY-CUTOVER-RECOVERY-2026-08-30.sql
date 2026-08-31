-- Emergency rollback of the legacy cutover only. Restores known legacy weaknesses.
-- Does not delete history or uninstall the additive APIs. Revert the frontend first.
-- If new delivery history exists, legacy execution stays quarantined after body restoration.
set local lock_timeout='3s';
set local statement_timeout='20s';

CREATE OR REPLACE FUNCTION public.derive_trip_and_load_status_v1(p_tenant_id uuid, p_trip_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_all_terminal boolean;
    v_any_started boolean;
    v_load_ids uuid[];
    v_load_id uuid;
BEGIN
    -- Derive Trip Status from Stops
    SELECT 
        bool_and(status IN ('completed', 'delivered', 'cancelled', 'skipped', 'refused', 'returned', 'partial_delivery', 'failed')),
        bool_or(status NOT IN ('planned', 'pending'))
    INTO v_all_terminal, v_any_started
    FROM public.dispatch_stops
    WHERE dispatch_trip_id = p_trip_id AND tenant_id = p_tenant_id;

    IF v_all_terminal THEN
        UPDATE public.dispatch_trips SET status = 'completed', actual_end_at = now() WHERE id = p_trip_id AND status != 'completed';
    ELSIF v_any_started THEN
        UPDATE public.dispatch_trips SET status = 'in_transit', actual_start_at = COALESCE(actual_start_at, now()) WHERE id = p_trip_id AND status = 'planned';
    END IF;

    -- Derive Load Status from Trip and its documents
    SELECT array_agg(load_id) INTO v_load_ids FROM public.dispatch_trip_loads WHERE dispatch_trip_id = p_trip_id;

    IF v_load_ids IS NOT NULL THEN
        FOREACH v_load_id IN ARRAY v_load_ids LOOP
            IF v_all_terminal THEN
                UPDATE public.loads SET status = 'delivered' WHERE id = v_load_id AND status != 'delivered';
            ELSIF v_any_started THEN
                UPDATE public.loads SET status = 'in_transit' WHERE id = v_load_id AND status = 'ready';
            END IF;
        END LOOP;
    END IF;
END;
$function$
;
revoke all on function public.derive_trip_and_load_status_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.derive_trip_and_load_status_v1(uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.driver_finalize_delivery(_stop_id uuid, _receiver_name text, _signature_path text DEFAULT NULL::text, _photo_paths text[] DEFAULT ARRAY[]::text[], _receiver_document text DEFAULT NULL::text, _receiver_role text DEFAULT NULL::text, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trip uuid; v_tenant uuid; v_stop_status text;
  v_event uuid; v_pod_ids uuid[] := ARRAY[]::uuid[]; v_pod uuid;
  v_fd uuid; v_doc_load uuid; v_pending int; v_proof_type text;
BEGIN
  SELECT dispatch_trip_id, tenant_id, status
    INTO v_trip, v_tenant, v_stop_status
  FROM public.dispatch_stops WHERE id = _stop_id;
  IF v_trip IS NULL THEN RAISE EXCEPTION 'stop_not_found'; END IF;
  PERFORM public._assert_driver_owns_trip(v_trip);

  IF v_stop_status = ANY(public.stop_terminal_statuses()) THEN
    RAISE EXCEPTION 'stop_already_completed';
  END IF;
  IF _receiver_name IS NULL OR length(btrim(_receiver_name)) < 2 THEN
    RAISE EXCEPTION 'receiver_required';
  END IF;

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
    SET status='delivered',
        actual_arrival_at = COALESCE(actual_arrival_at, now()),
        actual_departure_at = now(),
        notes = COALESCE(_notes, notes),
        updated_at = now()
    WHERE id = _stop_id;

  v_proof_type := CASE WHEN _signature_path IS NOT NULL THEN 'receiver_confirmation' ELSE 'delivery_photo' END;

  FOR v_fd, v_doc_load IN
    SELECT dsd.fiscal_document_id, COALESCE(dsd.load_id, fd.load_id)
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
      v_tenant, v_fd, v_doc_load, v_trip, _stop_id,
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
      load_id = COALESCE(EXCLUDED.load_id, public.proof_of_delivery.load_id),
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

  -- close trip when all stops in terminal state
  SELECT count(*) INTO v_pending FROM public.dispatch_stops
   WHERE dispatch_trip_id = v_trip
     AND NOT (status = ANY(public.stop_terminal_statuses()));
  IF v_pending = 0 THEN
    UPDATE public.dispatch_trips
       SET status='completed', actual_end_at=now(), updated_at=now()
     WHERE id = v_trip AND status <> 'completed';
    UPDATE public.loads SET status='delivered', updated_at=now()
     WHERE id IN (SELECT load_id FROM public.dispatch_trip_loads WHERE dispatch_trip_id = v_trip)
       AND status <> 'delivered';
    UPDATE public.loads l SET status='delivered', updated_at=now()
     FROM public.dispatch_trips dt
     WHERE dt.id = v_trip AND l.id = dt.load_id AND l.status <> 'delivered';
  END IF;

  RETURN jsonb_build_object('event_id', v_event, 'pod_ids', to_jsonb(v_pod_ids));
END; $function$
;
revoke all on function public.driver_finalize_delivery(uuid,text,text,text[],text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.driver_finalize_delivery(uuid,text,text,text[],text,text,text) to authenticated;
grant execute on function public.driver_finalize_delivery(uuid,text,text,text[],text,text,text) to service_role;

CREATE OR REPLACE FUNCTION public.driver_update_stop_status(_stop_id uuid, _new_status text, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trip uuid; v_tenant uuid; v_event_type text; v_event uuid; v_current text;
  v_terminal text[] := public.stop_terminal_statuses();
  v_pending int; v_load_id uuid;
  v_load_terminals text[]; v_new_load_status text;
  v_doc_ids uuid[]; v_doc_status text; v_load_ids uuid[] := ARRAY[]::uuid[];
  v_trip_completed boolean := false;
BEGIN
  IF _new_status NOT IN (
    'partial_delivery','refused','damaged','returned','skipped',
    'cancelled','failed','delivered','completed','arrived','departed'
  ) THEN RAISE EXCEPTION 'invalid_status'; END IF;

  SELECT dispatch_trip_id, tenant_id, status INTO v_trip, v_tenant, v_current
  FROM public.dispatch_stops WHERE id = _stop_id;
  IF v_trip IS NULL THEN RAISE EXCEPTION 'stop_not_found'; END IF;
  PERFORM public._assert_driver_owns_trip(v_trip);

  IF v_current = ANY(v_terminal) AND _new_status <> v_current THEN
    RAISE EXCEPTION 'stop_already_terminal';
  END IF;

  v_event_type := 'stop_' || _new_status;

  UPDATE public.dispatch_stops
    SET status = _new_status,
        notes = COALESCE(_reason, notes),
        actual_arrival_at = COALESCE(actual_arrival_at,
          CASE WHEN _new_status IN ('arrived','delivered','completed','refused','returned','partial_delivery','failed') THEN now() END),
        actual_departure_at = CASE
          WHEN _new_status = 'arrived' THEN actual_departure_at
          ELSE COALESCE(actual_departure_at, now())
        END,
        updated_at = now()
    WHERE id = _stop_id;

  INSERT INTO public.dispatch_events(tenant_id, dispatch_trip_id, dispatch_stop_id, event_type, payload, notes, created_by)
  VALUES (v_tenant, v_trip, _stop_id, v_event_type,
          jsonb_build_object('source','driver_app','new_status',_new_status,'reason',_reason),
          _reason, auth.uid())
  RETURNING id INTO v_event;

  v_doc_status := CASE _new_status
    WHEN 'refused' THEN 'refused'
    WHEN 'returned' THEN 'returned'
    WHEN 'partial_delivery' THEN 'partial_delivery'
    WHEN 'failed' THEN 'failed'
    WHEN 'skipped' THEN 'not_delivered'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'delivered' THEN 'delivered'
    WHEN 'completed' THEN 'delivered'
    ELSE NULL
  END;

  SELECT COALESCE(array_agg(DISTINCT dsd.fiscal_document_id), ARRAY[]::uuid[])
    INTO v_doc_ids
  FROM public.dispatch_stop_documents dsd
  WHERE dsd.dispatch_stop_id = _stop_id;

  IF v_doc_status IS NOT NULL AND array_length(v_doc_ids, 1) IS NOT NULL THEN
    UPDATE public.fiscal_documents
      SET status = v_doc_status, updated_at = now()
      WHERE id = ANY(v_doc_ids) AND tenant_id = v_tenant
        AND status NOT IN ('delivered','returned','refused','partial_delivery','failed','cancelled');
    PERFORM public._log_entity_audit(v_tenant, 'fiscal_document', x,
      'status_change_by_driver', NULL,
      jsonb_build_object('new_status', v_doc_status, 'stop_id', _stop_id), 'driver_app')
      FROM unnest(v_doc_ids) AS x;
  END IF;

  PERFORM public._log_entity_audit(v_tenant, 'dispatch_stop', _stop_id, 'status_change',
    jsonb_build_object('status', v_current), jsonb_build_object('status', _new_status, 'reason', _reason), 'driver_app');

  IF _new_status = ANY(v_terminal) THEN
    SELECT count(*) INTO v_pending FROM public.dispatch_stops
     WHERE dispatch_trip_id = v_trip AND NOT (status = ANY(v_terminal));

    IF v_pending = 0 THEN
      UPDATE public.dispatch_trips
         SET status='completed', actual_end_at=now(), updated_at=now()
       WHERE id = v_trip AND status <> 'completed';
      v_trip_completed := true;

      FOR v_load_id IN
        SELECT DISTINCT load_id FROM (
          SELECT dtl.load_id FROM public.dispatch_trip_loads dtl WHERE dtl.dispatch_trip_id = v_trip
          UNION
          SELECT l.id FROM public.loads l WHERE l.trip_id = v_trip
        ) x
      LOOP
        v_load_ids := v_load_ids || v_load_id;
        SELECT array_agg(DISTINCT ds.status) INTO v_load_terminals
          FROM public.dispatch_stops ds
          JOIN public.dispatch_stop_documents dsd ON dsd.dispatch_stop_id = ds.id
          JOIN public.fiscal_documents fd ON fd.id = dsd.fiscal_document_id
         WHERE fd.load_id = v_load_id AND ds.dispatch_trip_id = v_trip;

        v_new_load_status := CASE
          WHEN v_load_terminals IS NULL THEN 'delivered'
          WHEN 'partial_delivery' = ANY(v_load_terminals) THEN 'partial_delivery'
          WHEN 'returned' = ANY(v_load_terminals) THEN 'returned'
          WHEN 'refused'  = ANY(v_load_terminals) THEN 'refused'
          WHEN 'failed'   = ANY(v_load_terminals) THEN 'failed'
          WHEN 'cancelled' = ANY(v_load_terminals) AND array_length(v_load_terminals,1)=1 THEN 'cancelled'
          ELSE 'delivered'
        END;

        UPDATE public.loads
           SET status = v_new_load_status, updated_at = now()
         WHERE id = v_load_id
           AND status NOT IN ('delivered','cancelled','returned','refused','partial_delivery','failed');

        PERFORM public._log_entity_audit(v_tenant, 'load', v_load_id, 'status_change',
          NULL, jsonb_build_object('new_status', v_new_load_status, 'trip_id', v_trip), 'driver_app');
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_event,
    'updated_stop_id', _stop_id,
    'updated_document_ids', COALESCE(to_jsonb(v_doc_ids), '[]'::jsonb),
    'updated_load_ids', COALESCE(to_jsonb(v_load_ids), '[]'::jsonb),
    'trip_completed', v_trip_completed
  );
END $function$
;
revoke all on function public.driver_update_stop_status(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.driver_update_stop_status(uuid,text,text) to authenticated;
grant execute on function public.driver_update_stop_status(uuid,text,text) to service_role;

CREATE OR REPLACE FUNCTION public.transition_stop_status_v1(p_tenant_id uuid, p_stop_id uuid, p_to_status text, p_actor_id uuid, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_from_status text;
    v_trip_id uuid;
    v_allowed boolean := false;
BEGIN
    -- Authorization check
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin', 'operator', 'driver')) THEN
        RAISE EXCEPTION 'Não autorizado';
    END IF;

    -- Idempotency check
    IF p_idempotency_key IS NOT NULL THEN
        SELECT to_status INTO v_from_status FROM public.entity_state_audit_log 
        WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
        IF FOUND THEN RETURN v_from_status; END IF;
    END IF;

    -- Get current state
    SELECT status, dispatch_trip_id INTO v_from_status, v_trip_id 
    FROM public.dispatch_stops 
    WHERE id = p_stop_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN RAISE EXCEPTION 'Parada não encontrada'; END IF;

    -- State Machine Logic
    CASE v_from_status
        WHEN 'planned' THEN v_allowed := p_to_status IN ('arriving', 'cancelled', 'skipped');
        WHEN 'arriving' THEN v_allowed := p_to_status IN ('arrived', 'skipped');
        WHEN 'arrived' THEN v_allowed := p_to_status IN ('servicing', 'skipped');
        WHEN 'servicing' THEN v_allowed := p_to_status IN ('departed', 'completed', 'delivered', 'refused', 'returned', 'partial_delivery', 'failed');
        WHEN 'departed' THEN v_allowed := p_to_status IN ('completed', 'delivered', 'refused', 'returned', 'partial_delivery', 'failed');
        ELSE v_allowed := false;
    END CASE;

    -- Drivers can only move forward, Admins can override
    IF NOT v_allowed AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role IN ('admin')) THEN
        RAISE EXCEPTION 'Transição de status inválida: % -> %', v_from_status, p_to_status;
    END IF;

    -- Update Stop
    UPDATE public.dispatch_stops 
    SET status = p_to_status, 
        updated_at = now(),
        actual_arrival_at = CASE WHEN p_to_status = 'arrived' THEN now() ELSE actual_arrival_at END,
        actual_departure_at = CASE WHEN p_to_status = 'departed' OR p_to_status IN ('completed', 'delivered', 'refused', 'returned', 'partial_delivery', 'failed') THEN now() ELSE actual_departure_at END
    WHERE id = p_stop_id AND tenant_id = p_tenant_id;

    -- Audit Log
    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, from_status, to_status, actor_id, reason, idempotency_key, metadata
    ) VALUES (
        p_tenant_id, 'stop', p_stop_id, v_from_status, p_to_status, p_actor_id, p_reason, p_idempotency_key, p_metadata
    );

    -- Trigger aggregate derivation
    PERFORM public.derive_trip_and_load_status_v1(p_tenant_id, v_trip_id);

    RETURN p_to_status;
END;
$function$
;
revoke all on function public.transition_stop_status_v1(uuid,uuid,text,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.transition_stop_status_v1(uuid,uuid,text,uuid,text,text,jsonb) to service_role;

CREATE OR REPLACE FUNCTION public.finalize_driver_delivery(_stop_id uuid, _receiver_name text, _signature_path text DEFAULT NULL::text, _photo_paths text[] DEFAULT ARRAY[]::text[], _fiscal_document_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.driver_finalize_delivery(_stop_id, _receiver_name, _signature_path, _photo_paths);
$function$
;
revoke all on function public.finalize_driver_delivery(uuid,text,text,text[],uuid) from public,anon,authenticated,service_role;
grant execute on function public.finalize_driver_delivery(uuid,text,text,text[],uuid) to service_role;

do $quarantine$
begin
  if exists(select 1 from public.dispatch_events where payload ? 'delivery_request'
    and event_type in('delivery_note','delivery_delivered','stop_partial_delivery','stop_returned',
      'stop_refused','stop_failed','stop_skipped','stop_cancelled')) then
    revoke all on function public.driver_finalize_delivery(uuid,text,text,text[],text,text,text) from public,anon,authenticated,service_role;
    revoke all on function public.driver_update_stop_status(uuid,text,text) from public,anon,authenticated,service_role;
    revoke all on function public.finalize_driver_delivery(uuid,text,text,text[],uuid) from public,anon,authenticated,service_role;
    revoke all on function public.transition_stop_status_v1(uuid,uuid,text,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
    revoke all on function public.derive_trip_and_load_status_v1(uuid,uuid) from public,anon,authenticated,service_role;
    raise notice 'Legacy bodies restored but execution quarantined: new delivery history exists. Preserve evidence and roll forward.';
  else
    -- Restoring old writers must not leave the new APIs concurrently exposed.
    revoke all on function public.driver_record_delivery_outcome(uuid,text,jsonb,uuid,text) from public,anon,authenticated,service_role;
    revoke all on function public.driver_record_delivery_note(uuid,text,jsonb,uuid) from public,anon,authenticated,service_role;
  end if;
end;
$quarantine$;
