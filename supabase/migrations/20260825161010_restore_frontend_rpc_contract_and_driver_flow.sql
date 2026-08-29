-- Restore the browser RPC contract after the production hardening bridge.
-- Grants and RLS are independent in PostgreSQL: the routines below already
-- enforce tenant/role ownership internally, but authenticated users must also
-- be able to execute them.

DO $frontend_rpc_contract$
DECLARE
  function_name text;
  function_row record;
  function_found boolean;
  frontend_functions constant text[] := ARRAY[
    'add_employee_incident_action',
    'add_payroll_manual_item',
    'approve_payroll_period',
    'audit_data_consistency_v2',
    'cancel_closing_report',
    'cancel_doccob_export',
    'cancel_pallet_return_protocol',
    'clear_reimport_batch_data',
    'close_closing_report',
    'close_payroll_period',
    'cte_defaults_for_group',
    'create_pallet_return_protocol',
    'delete_driver_settlement',
    'delete_load_safely',
    'delete_loads_safely',
    'delete_payroll_entry_item',
    'dispatch_planned_route',
    'driver_finalize_delivery',
    'driver_mark_arrival',
    'driver_register_departure',
    'driver_update_stop_status',
    'generate_payroll_period',
    'get_client_portal_alerts_v2',
    'get_client_portal_reports_summary_v2',
    'get_client_portal_summary_v2',
    'get_client_portal_tracking_v2',
    'get_client_portal_upcoming_deliveries_v2',
    'hold_load',
    'list_client_documents_v2',
    'list_client_occurrences_v2',
    'list_client_pickups_v2',
    'list_client_pods_v2',
    'move_load_items_between_loads',
    'next_closing_report_number',
    'next_nfse_number',
    'next_nfse_number_by_emitter',
    'preview_reimport_cleanup_counts',
    'recalculate_payroll_entry',
    'record_operational_event_with_status',
    'register_closing_report_payment',
    'register_employee_advance',
    'reopen_closing_report',
    'search_client_portal_shipments_v2',
    'unhold_load',
    'update_driver_settlement_km_review',
    'update_pallet_return_status'
  ];
  internal_only_functions constant text[] := ARRAY[
    'check_resource_ownership',
    'commit_load_import_v1',
    'create_load_v1',
    'delete_load_item_v1',
    'execute_data_repair_v1',
    'get_next_load_number_v1',
    'handle_new_user',
    'list_clients_v1',
    'list_drivers_v1',
    'list_fiscal_documents_v1',
    'list_load_control_v1',
    'list_loads_v1',
    'list_operational_routes_v1'
  ];
BEGIN
  FOREACH function_name IN ARRAY frontend_functions LOOP
    function_found := false;

    FOR function_row IN
      SELECT procedure.oid::regprocedure::text AS signature
      FROM pg_proc AS procedure
      JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = function_name
    LOOP
      function_found := true;
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', function_row.signature);
    END LOOP;

    IF NOT function_found THEN
      RAISE EXCEPTION 'Frontend RPC is missing from production schema: %', function_name;
    END IF;
  END LOOP;

  FOREACH function_name IN ARRAY internal_only_functions LOOP
    FOR function_row IN
      SELECT procedure.oid::regprocedure::text AS signature
      FROM pg_proc AS procedure
      JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = function_name
    LOOP
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', function_row.signature);
    END LOOP;
  END LOOP;
END;
$frontend_rpc_contract$;

-- A driver starts only a trip that is assigned to the driver's linked account.
-- This replaces direct table updates from the browser, which are intentionally
-- blocked by dispatch_trips RLS.
CREATE OR REPLACE FUNCTION public.driver_start_trip(_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_trip public.dispatch_trips%ROWTYPE;
  v_driver_id uuid;
  v_load_ids uuid[] := ARRAY[]::uuid[];
  v_previous_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Não autenticado';
  END IF;

  SELECT *
  INTO v_trip
  FROM public.dispatch_trips
  WHERE id = _trip_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Viagem não encontrada';
  END IF;

  v_driver_id := public.current_driver_id(v_trip.tenant_id);
  IF v_driver_id IS NULL OR v_trip.driver_id IS DISTINCT FROM v_driver_id THEN
    RAISE EXCEPTION 'Viagem não atribuída ao motorista autenticado';
  END IF;

  IF v_trip.status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Viagem encerrada ou cancelada';
  END IF;

  SELECT COALESCE(array_agg(load_id ORDER BY load_id), ARRAY[]::uuid[])
  INTO v_load_ids
  FROM (
    SELECT DISTINCT dispatch_trip_loads.load_id
    FROM public.dispatch_trip_loads
    WHERE dispatch_trip_loads.dispatch_trip_id = v_trip.id
      AND dispatch_trip_loads.tenant_id = v_trip.tenant_id
    UNION
    SELECT v_trip.load_id
    WHERE v_trip.load_id IS NOT NULL
  ) AS assigned_loads;

  IF EXISTS (
    SELECT 1
    FROM public.loads
    WHERE id = ANY(v_load_ids)
      AND tenant_id = v_trip.tenant_id
      AND on_hold
  ) THEN
    RAISE EXCEPTION 'Uma ou mais cargas da viagem estão bloqueadas';
  END IF;

  v_previous_status := v_trip.status;

  UPDATE public.dispatch_trips
  SET status = 'in_transit',
      actual_start_at = COALESCE(actual_start_at, now()),
      updated_at = now()
  WHERE id = v_trip.id
    AND status IS DISTINCT FROM 'in_transit';

  UPDATE public.loads
  SET trip_id = v_trip.id,
      driver_id = v_driver_id,
      vehicle_id = COALESCE(v_trip.vehicle_id, vehicle_id),
      status = CASE
        WHEN status IN ('delivered', 'cancelled', 'returned', 'refused', 'partial_delivery', 'failed') THEN status
        ELSE 'in_transit'
      END,
      updated_at = now()
  WHERE id = ANY(v_load_ids)
    AND tenant_id = v_trip.tenant_id;

  IF v_previous_status IS DISTINCT FROM 'in_transit' THEN
    INSERT INTO public.dispatch_events(
      tenant_id, dispatch_trip_id, event_type, payload, created_by
    ) VALUES (
      v_trip.tenant_id,
      v_trip.id,
      'trip_started',
      jsonb_build_object('previous_status', v_previous_status, 'driver_id', v_driver_id),
      auth.uid()
    );

    PERFORM public._log_entity_audit(
      v_trip.tenant_id,
      'dispatch_trip',
      v_trip.id,
      'start_by_driver',
      jsonb_build_object('status', v_previous_status),
      jsonb_build_object('status', 'in_transit', 'driver_id', v_driver_id),
      'driver_app'
    );
  END IF;

  RETURN jsonb_build_object(
    'trip_id', v_trip.id,
    'status', 'in_transit',
    'load_ids', to_jsonb(v_load_ids)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.driver_start_trip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_start_trip(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_start_trip(uuid) TO service_role;

-- load_items is the canonical fiscal-document/load relationship. Keep the
-- fiscal_documents.load_id compatibility mirror synchronized for all writers.
CREATE OR REPLACE FUNCTION public._sync_fiscal_document_load_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_document_id uuid;
  v_load_count integer;
  v_load_id uuid;
BEGIN
  FOR v_document_id IN
    SELECT DISTINCT document_id
    FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.fiscal_document_id ELSE NULL END,
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.fiscal_document_id ELSE NULL END
    ]) AS affected(document_id)
    WHERE document_id IS NOT NULL
  LOOP
    SELECT count(DISTINCT load_id), (array_agg(DISTINCT load_id ORDER BY load_id))[1]
    INTO v_load_count, v_load_id
    FROM public.load_items
    WHERE fiscal_document_id = v_document_id;

    IF v_load_count > 1 THEN
      RAISE EXCEPTION 'Documento fiscal % não pode pertencer a mais de uma carga', v_document_id;
    END IF;

    UPDATE public.fiscal_documents
    SET load_id = v_load_id,
        updated_at = now()
    WHERE id = v_document_id
      AND load_id IS DISTINCT FROM v_load_id;
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

REVOKE ALL ON FUNCTION public._sync_fiscal_document_load_mirror() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._sync_fiscal_document_load_mirror() TO service_role;

DROP TRIGGER IF EXISTS sync_fiscal_document_load_mirror ON public.load_items;
CREATE TRIGGER sync_fiscal_document_load_mirror
AFTER INSERT OR UPDATE OR DELETE ON public.load_items
FOR EACH ROW EXECUTE FUNCTION public._sync_fiscal_document_load_mirror();

-- Fail closed if any document is attached to more than one canonical load. Such
-- a conflict needs an operational decision and must never be repaired by chance.
DO $preflight_load_relationships$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.load_items
    WHERE fiscal_document_id IS NOT NULL
    GROUP BY fiscal_document_id
    HAVING count(DISTINCT load_id) > 1
  ) THEN
    RAISE EXCEPTION 'Preflight failed: fiscal documents attached to multiple loads';
  END IF;
END;
$preflight_load_relationships$;

-- Preserve every before/after value in the protected entity audit trail before
-- repairing the compatibility mirror. This is the rollback source of truth.
INSERT INTO public.entity_audit_log(
  tenant_id, entity_type, entity_id, action, old_data, new_data,
  actor_role, source, request_id, created_at
)
SELECT
  document.tenant_id,
  'fiscal_document',
  document.id,
  'repair_load_mirror',
  jsonb_build_object('load_id', document.load_id),
  jsonb_build_object('load_id', canonical.load_id),
  'system',
  'production_contract_repair',
  '20260825143211',
  now()
FROM public.fiscal_documents AS document
LEFT JOIN LATERAL (
  SELECT (array_agg(DISTINCT item.load_id ORDER BY item.load_id))[1] AS load_id
  FROM public.load_items AS item
  WHERE item.fiscal_document_id = document.id
) AS canonical ON true
WHERE document.load_id IS DISTINCT FROM canonical.load_id;

-- Repair mirrors already inconsistent in production. The update is deterministic:
-- one canonical item load wins; no canonical item clears the compatibility mirror.
WITH canonical_document_load AS (
  SELECT
    fiscal_document_id,
    count(DISTINCT load_id) AS load_count,
    (array_agg(DISTINCT load_id ORDER BY load_id))[1] AS load_id
  FROM public.load_items
  WHERE fiscal_document_id IS NOT NULL
  GROUP BY fiscal_document_id
)
UPDATE public.fiscal_documents AS document
SET load_id = canonical.load_id,
    updated_at = now()
FROM canonical_document_load AS canonical
WHERE document.id = canonical.fiscal_document_id
  AND canonical.load_count = 1
  AND document.load_id IS DISTINCT FROM canonical.load_id;

UPDATE public.fiscal_documents AS document
SET load_id = NULL,
    updated_at = now()
WHERE document.load_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.load_items AS item
    WHERE item.fiscal_document_id = document.id
  );

-- Repair a stale trip assignment only when every canonical trip load agrees on
-- one active driver and the load assignment is newer than the trip assignment.
WITH trip_assignment AS (
  SELECT
    trip.id AS trip_id,
    trip.tenant_id,
    trip.driver_id AS previous_driver_id,
    count(DISTINCT load.driver_id) FILTER (WHERE load.driver_id IS NOT NULL) AS driver_count,
    (array_agg(DISTINCT load.driver_id ORDER BY load.driver_id)
      FILTER (WHERE load.driver_id IS NOT NULL))[1] AS canonical_driver_id,
    max(load.updated_at) AS latest_load_update
  FROM public.dispatch_trips AS trip
  JOIN public.dispatch_trip_loads AS trip_load
    ON trip_load.dispatch_trip_id = trip.id
   AND trip_load.tenant_id = trip.tenant_id
  JOIN public.loads AS load
    ON load.id = trip_load.load_id
   AND load.tenant_id = trip.tenant_id
  WHERE trip.status NOT IN ('completed', 'cancelled')
  GROUP BY trip.id, trip.tenant_id, trip.driver_id
), repaired AS (
  UPDATE public.dispatch_trips AS trip
  SET driver_id = assignment.canonical_driver_id,
      updated_at = now()
  FROM trip_assignment AS assignment
  WHERE trip.id = assignment.trip_id
    AND assignment.driver_count = 1
    AND assignment.canonical_driver_id IS DISTINCT FROM assignment.previous_driver_id
    AND assignment.latest_load_update > trip.updated_at
    AND EXISTS (
      SELECT 1
      FROM public.drivers AS driver
      WHERE driver.id = assignment.canonical_driver_id
        AND driver.tenant_id = trip.tenant_id
        AND driver.active
    )
  RETURNING trip.id, trip.tenant_id, assignment.previous_driver_id, trip.driver_id
)
INSERT INTO public.entity_audit_log(
  tenant_id, entity_type, entity_id, action, old_data, new_data,
  actor_role, source, created_at
)
SELECT
  tenant_id,
  'dispatch_trip',
  id,
  'repair_driver_assignment',
  jsonb_build_object('driver_id', previous_driver_id),
  jsonb_build_object('driver_id', driver_id),
  'system',
  'baseline_repair',
  now()
FROM repaired;

COMMENT ON FUNCTION public.driver_start_trip(uuid) IS
  'Starts a trip only for its authenticated linked driver and synchronizes canonical load assignment/status.';
COMMENT ON FUNCTION public._sync_fiscal_document_load_mirror() IS
  'Internal trigger: keeps fiscal_documents.load_id synchronized from canonical load_items relationships.';
