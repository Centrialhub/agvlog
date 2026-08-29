-- Canonical, audited load mutations.
-- Apply before deploying the frontend that calls the *_v2/v3 RPCs below.

CREATE OR REPLACE FUNCTION public.transition_load_status_v1(
  p_tenant_id uuid,
  p_load_id uuid,
  p_to_status text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_from_status text;
  v_allowed text[];
BEGIN
  IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT status
    INTO v_from_status
  FROM public.loads
  WHERE id = p_load_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'load_not_found';
  END IF;

  IF v_from_status = p_to_status THEN
    RETURN jsonb_build_object('load_id', p_load_id, 'from_status', v_from_status, 'to_status', p_to_status, 'changed', false);
  END IF;

  v_allowed := CASE v_from_status
    WHEN 'planned' THEN ARRAY['assembling']
    WHEN 'assembling' THEN ARRAY['ready', 'planned']
    WHEN 'ready' THEN ARRAY['loading', 'assembling', 'in_transit']
    WHEN 'loading' THEN ARRAY['loaded', 'ready', 'in_transit']
    WHEN 'loaded' THEN ARRAY['in_transit']
    WHEN 'in_transit' THEN ARRAY['delivered', 'divergent', 'partial_delivery', 'returned', 'refused']
    WHEN 'divergent' THEN ARRAY['in_transit', 'delivered', 'partial_delivery', 'returned', 'refused']
    WHEN 'partial_delivery' THEN ARRAY['delivered', 'returned']
    WHEN 'returned' THEN ARRAY['delivered']
    WHEN 'refused' THEN ARRAY['returned', 'delivered']
    WHEN 'failed' THEN ARRAY['returned', 'delivered']
    ELSE ARRAY[]::text[]
  END;

  IF NOT (p_to_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'invalid_load_status_transition: % -> %', v_from_status, p_to_status;
  END IF;

  UPDATE public.loads
  SET status = p_to_status,
      updated_at = now()
  WHERE id = p_load_id AND tenant_id = p_tenant_id;

  INSERT INTO public.load_status_history (
    tenant_id, load_id, field_name, old_value, new_value, reason, created_by
  ) VALUES (
    p_tenant_id, p_load_id, 'status', v_from_status, p_to_status,
    NULLIF(btrim(p_reason), ''), auth.uid()
  );

  PERFORM public._log_entity_audit(
    p_tenant_id,
    'load',
    p_load_id,
    'status_transition',
    jsonb_build_object('status', v_from_status),
    jsonb_build_object('status', p_to_status, 'reason', NULLIF(btrim(p_reason), '')),
    'transition_load_status_v1'
  );

  RETURN jsonb_build_object('load_id', p_load_id, 'from_status', v_from_status, 'to_status', p_to_status, 'changed', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_load_item_v3(
  p_tenant_id uuid,
  p_load_id uuid DEFAULT NULL,
  p_item_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_item_description text DEFAULT NULL,
  p_quantity numeric DEFAULT NULL,
  p_pallet_count numeric DEFAULT NULL,
  p_weight_kg numeric DEFAULT NULL,
  p_volume_m3 numeric DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_fiscal_document_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.load_items;
  v_item_id uuid;
  v_load_id uuid;
  v_fiscal_document_id uuid;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_item_id IS NOT NULL THEN
    SELECT * INTO v_item
    FROM public.load_items
    WHERE id = p_item_id AND tenant_id = p_tenant_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'load_item_not_found'; END IF;
    IF p_load_id IS NOT NULL AND p_load_id <> v_item.load_id THEN
      RAISE EXCEPTION 'load_change_requires_move_rpc';
    END IF;
    v_load_id := v_item.load_id;
  ELSE
    v_load_id := p_load_id;
  END IF;

  IF v_load_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.loads WHERE id = v_load_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'load_not_found';
  END IF;
  IF public._load_is_locked(v_load_id) THEN RAISE EXCEPTION 'load_locked'; END IF;

  IF p_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.orders WHERE id = p_order_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;
  IF p_fiscal_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.fiscal_documents WHERE id = p_fiscal_document_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'fiscal_document_not_found';
  END IF;
  IF p_status IS NOT NULL AND p_status <> ALL(ARRAY[
    'pending', 'waiting_conference', 'in_stock', 'picking', 'ready_for_load',
    'in_loading', 'loaded', 'in_transit', 'delivered', 'divergence', 'return', 'redelivery'
  ]) THEN
    RAISE EXCEPTION 'invalid_load_item_status';
  END IF;

  IF p_item_id IS NULL THEN
    INSERT INTO public.load_items (
      tenant_id, load_id, order_id, fiscal_document_id, item_description,
      quantity, pallet_count, weight_kg, volume_m3, status, notes
    ) VALUES (
      p_tenant_id, v_load_id, p_order_id, p_fiscal_document_id,
      COALESCE(p_item_description, ''), COALESCE(p_quantity, 0),
      COALESCE(p_pallet_count, 0), COALESCE(p_weight_kg, 0), COALESCE(p_volume_m3, 0),
      COALESCE(p_status, 'pending'), p_notes
    ) RETURNING id, fiscal_document_id INTO v_item_id, v_fiscal_document_id;
  ELSE
    UPDATE public.load_items
    SET order_id = COALESCE(p_order_id, order_id),
        item_description = COALESCE(p_item_description, item_description),
        quantity = COALESCE(p_quantity, quantity),
        pallet_count = COALESCE(p_pallet_count, pallet_count),
        weight_kg = COALESCE(p_weight_kg, weight_kg),
        volume_m3 = COALESCE(p_volume_m3, volume_m3),
        status = COALESCE(p_status, status),
        notes = COALESCE(p_notes, notes),
        fiscal_document_id = COALESCE(p_fiscal_document_id, fiscal_document_id),
        updated_at = now()
    WHERE id = p_item_id AND tenant_id = p_tenant_id
    RETURNING id, fiscal_document_id INTO v_item_id, v_fiscal_document_id;
  END IF;

  IF v_fiscal_document_id IS NOT NULL THEN
    UPDATE public.fiscal_documents
    SET load_id = v_load_id, updated_at = now()
    WHERE id = v_fiscal_document_id AND tenant_id = p_tenant_id;
  END IF;

  PERFORM public.recalculate_load_totals(p_tenant_id, v_load_id);
  PERFORM public._log_entity_audit(
    p_tenant_id,
    'load_item',
    v_item_id,
    CASE WHEN p_item_id IS NULL THEN 'create' ELSE 'update' END,
    NULL,
    jsonb_build_object('load_id', v_load_id, 'status', COALESCE(p_status, v_item.status, 'pending')),
    'upsert_load_item_v3'
  );

  RETURN v_item_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.assign_fiscal_documents_to_load_v2(
  _tenant_id uuid,
  _load_id uuid,
  _document_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_result jsonb;
BEGIN
  v_result := public.assign_fiscal_documents_to_load(_tenant_id, _load_id, _document_ids);
  PERFORM public.recalculate_load_totals(_tenant_id, _load_id);
  RETURN v_result || jsonb_build_object('totals_recalculated', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_load_item_v3(
  p_tenant_id uuid,
  p_item_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_load_id uuid;
  v_fiscal_document_id uuid;
  v_old jsonb;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(p_tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT li.load_id, li.fiscal_document_id, to_jsonb(li)
    INTO v_load_id, v_fiscal_document_id, v_old
  FROM public.load_items li
  WHERE li.id = p_item_id AND li.tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN RETURN false; END IF;
  IF public._load_is_locked(v_load_id) THEN RAISE EXCEPTION 'load_locked'; END IF;

  DELETE FROM public.load_items
  WHERE id = p_item_id AND tenant_id = p_tenant_id;

  IF v_fiscal_document_id IS NOT NULL THEN
    UPDATE public.fiscal_documents
    SET load_id = NULL, updated_at = now()
    WHERE id = v_fiscal_document_id
      AND tenant_id = p_tenant_id
      AND load_id = v_load_id;
  END IF;

  PERFORM public.recalculate_load_totals(p_tenant_id, v_load_id);
  PERFORM public._log_entity_audit(
    p_tenant_id,
    'load_item',
    p_item_id,
    'delete',
    v_old,
    NULL,
    'delete_load_item_v3'
  );
  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.remove_fiscal_documents_from_load_v2(
  _tenant_id uuid,
  _load_id uuid,
  _document_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_result jsonb;
BEGIN
  v_result := public.remove_fiscal_documents_from_load(_tenant_id, _load_id, _document_ids);
  PERFORM public.recalculate_load_totals(_tenant_id, _load_id);
  RETURN v_result || jsonb_build_object('totals_recalculated', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.transition_load_status_v1(uuid, uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.upsert_load_item_v3(uuid, uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_load_item_v3(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assign_fiscal_documents_to_load_v2(uuid, uuid, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.remove_fiscal_documents_from_load_v2(uuid, uuid, uuid[]) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.transition_load_status_v1(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_load_item_v3(uuid, uuid, uuid, uuid, text, numeric, numeric, numeric, numeric, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_load_item_v3(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_fiscal_documents_to_load_v2(uuid, uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_fiscal_documents_from_load_v2(uuid, uuid, uuid[]) TO authenticated;

-- Status changes must go through transition_load_status_v1. Keep all other
-- editable load columns available to the existing operator UI.
REVOKE UPDATE ON public.loads FROM authenticated;
DO $block$
DECLARE v_columns text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum)
    INTO v_columns
  FROM pg_attribute a
  WHERE a.attrelid = 'public.loads'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND a.attname NOT IN ('id', 'tenant_id', 'status', 'created_at', 'created_by');
  EXECUTE format('GRANT UPDATE (%s) ON public.loads TO authenticated', v_columns);
END;
$block$;

-- Composition is mutation-safe only through the audited SECURITY DEFINER RPCs.
REVOKE INSERT, UPDATE, DELETE ON public.load_items FROM authenticated;

-- Legacy item RPCs do not enforce the canonical lock/audit contract. Keep them
-- available to service_role jobs, but remove them from the browser role.
DO $block$
DECLARE v_signature text;
BEGIN
  FOR v_signature IN
    SELECT p.oid::regprocedure::text
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'upsert_load_item_v1', 'upsert_load_item_v2',
        'delete_load_item_v1', 'delete_load_item_v2'
      )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', v_signature);
  END LOOP;
END;
$block$;
