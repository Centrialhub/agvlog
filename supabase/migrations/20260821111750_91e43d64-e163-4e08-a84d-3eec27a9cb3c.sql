-- 1) version column
ALTER TABLE public.loads ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- 2) neutralize any early/leftover grants on prior signatures
DO $neutral$
DECLARE sig text;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.update_load_v1(uuid,uuid,jsonb,integer)',
    'public.delete_load_v1(uuid,uuid)'
  ] LOOP
    IF to_regprocedure(sig) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', sig);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', sig);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', sig);
    END IF;
  END LOOP;
END
$neutral$;

DROP FUNCTION IF EXISTS public.update_load_v1(uuid,uuid,jsonb,integer);
DROP FUNCTION IF EXISTS public.delete_load_v1(uuid,uuid);

-- 3) update_load_v1
CREATE FUNCTION public.update_load_v1(
  p_tenant_id uuid,
  p_load_id uuid,
  p_changes jsonb,
  p_expected_version integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_allowed text[] := ARRAY[
    'vehicle_id','driver_id','origin','destination','notes','operation_type',
    'scheduled_load_at','actual_load_at','load_date','arrival_date','arrival_at',
    'estimated_arrival_at','gate_departure_at','trailer_plate','os_number',
    'external_load_number','control_load_number','supplier_manifest',
    'distribution_manifest','shipment_manifest','origin_manifest',
    'merchandise_value','freight_amount','freight_percent','payment_method',
    'expected_payment_date','payment_date','monitored','dedicated_vehicle',
    'monitor_responsible','driver_type','sm_manager','sm_release',
    'cash_to_receive','pix_to_receive','ciot','status','operational_status'
  ];
  v_key text;
  v_before public.loads;
  v_after public.loads;
  v_sets text[] := '{}';
  v_sql text;
BEGIN
  IF p_tenant_id IS NULL OR p_load_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENTS';
  END IF;
  IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'object' OR p_changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'NO_CHANGES';
  END IF;

  SELECT * INTO v_before FROM public.loads
   WHERE id = p_load_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOAD_NOT_FOUND';
  END IF;

  IF p_expected_version IS NOT NULL AND v_before.version <> p_expected_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: expected %, found %', p_expected_version, v_before.version;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_changes) LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'FIELD_NOT_ALLOWED: %', v_key;
    END IF;
    v_sets := v_sets || format(
      '%I = ($1->>%L)::text::%s',
      v_key, v_key,
      (SELECT format_type(a.atttypid, a.atttypmod)
         FROM pg_attribute a
        WHERE a.attrelid = 'public.loads'::regclass
          AND a.attname = v_key AND a.attnum > 0 AND NOT a.attisdropped)
    );
  END LOOP;

  v_sql := format(
    'UPDATE public.loads SET %s, version = version + 1, updated_at = now() WHERE id = %L AND tenant_id = %L RETURNING *',
    array_to_string(v_sets, ', '), p_load_id, p_tenant_id
  );
  EXECUTE v_sql INTO v_after USING p_changes;

  INSERT INTO public.entity_state_audit_log
    (tenant_id, entity_type, entity_id, from_status, to_status, actor_id, reason, metadata)
  VALUES (
    p_tenant_id, 'load', p_load_id, v_before.status, v_after.status, auth.uid(),
    'update_load_v1',
    jsonb_build_object(
      'changes', p_changes,
      'expected_version', p_expected_version,
      'from_version', v_before.version,
      'to_version', v_after.version
    )
  );

  RETURN jsonb_build_object('id', v_after.id, 'version', v_after.version, 'status', v_after.status);
END
$fn$;

-- 4) delete_load_v1
CREATE FUNCTION public.delete_load_v1(
  p_tenant_id uuid,
  p_load_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_load public.loads;
  v_active_trip boolean;
BEGIN
  IF p_tenant_id IS NULL OR p_load_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ARGUMENTS';
  END IF;
  IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  SELECT * INTO v_load FROM public.loads
   WHERE id = p_load_id AND tenant_id = p_tenant_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'LOAD_NOT_FOUND';
  END IF;

  IF lower(coalesce(v_load.status,'')) IN ('delivered','entregue','in_transit','finished','completed')
     OR lower(coalesce(v_load.operational_status,'')) IN ('delivered','entregue') THEN
    RAISE EXCEPTION 'LOAD_NOT_DELETABLE_STATUS: %', v_load.status;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.dispatch_trip_loads dtl
      JOIN public.dispatch_trips dt ON dt.id = dtl.trip_id
     WHERE dtl.load_id = p_load_id
       AND dt.tenant_id = p_tenant_id
       AND lower(coalesce(dt.status,'')) NOT IN ('cancelled','canceled','draft')
  ) INTO v_active_trip;

  IF v_active_trip OR v_load.trip_id IS NOT NULL THEN
    RAISE EXCEPTION 'LOAD_IN_ACTIVE_TRIP';
  END IF;

  INSERT INTO public.entity_state_audit_log
    (tenant_id, entity_type, entity_id, from_status, to_status, actor_id, reason, metadata)
  VALUES (
    p_tenant_id, 'load', p_load_id, v_load.status, 'deleted', auth.uid(),
    'delete_load_v1',
    jsonb_build_object('load_number', v_load.load_number, 'version', v_load.version)
  );

  DELETE FROM public.loads WHERE id = p_load_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object('id', p_load_id, 'deleted', true);
END
$fn$;

-- 5) definitive grants
REVOKE ALL ON FUNCTION public.update_load_v1(uuid,uuid,jsonb,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_load_v1(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_load_v1(uuid,uuid,jsonb,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_load_v1(uuid,uuid) TO authenticated, service_role;