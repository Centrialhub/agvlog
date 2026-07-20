CREATE OR REPLACE FUNCTION public.assign_fiscal_documents_to_load(
  _tenant_id uuid,
  _load_id uuid,
  _document_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_requested int := 0;
  v_blocked int := 0;
  v_doc_ids uuid[];
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF _load_id IS NULL OR _document_ids IS NULL OR array_length(_document_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  SELECT array_agg(DISTINCT d.id)
    INTO v_doc_ids
  FROM unnest(_document_ids) AS d(id)
  WHERE d.id IS NOT NULL;

  IF v_doc_ids IS NULL OR array_length(v_doc_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'invalid_input';
  END IF;

  IF public._load_is_locked(_load_id) THEN
    RAISE EXCEPTION 'load_locked';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.loads l
    WHERE l.id = _load_id
      AND l.tenant_id = _tenant_id
  ) THEN
    RAISE EXCEPTION 'load_not_found';
  END IF;

  SELECT count(*)::int
    INTO v_requested
  FROM unnest(v_doc_ids) AS d(id);

  SELECT count(*)::int
    INTO v_blocked
  FROM public.fiscal_documents fd
  WHERE fd.id = ANY(v_doc_ids)
    AND fd.tenant_id = _tenant_id
    AND fd.load_id IS NOT NULL
    AND fd.load_id <> _load_id;

  IF v_blocked > 0 THEN
    RAISE EXCEPTION 'document_already_linked';
  END IF;

  UPDATE public.fiscal_documents
    SET load_id = _load_id,
        updated_at = now()
    WHERE id = ANY(v_doc_ids)
      AND tenant_id = _tenant_id
      AND (load_id IS NULL OR load_id = _load_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count <> v_requested THEN
    RAISE EXCEPTION 'document_link_count_mismatch: expected %, updated %', v_requested, v_count;
  END IF;

  INSERT INTO public.load_items (
    tenant_id,
    load_id,
    fiscal_document_id,
    item_description,
    pallet_count,
    weight_kg,
    volume_m3
  )
  SELECT _tenant_id,
         _load_id,
         fd.id,
         COALESCE(NULLIF(fd.product_summary, ''), 'Documento ' || COALESCE(fd.invoice_number, fd.id::text)),
         COALESCE(fd.pallet_count, 0),
         COALESCE(fd.weight_kg, 0),
         0
  FROM public.fiscal_documents fd
  WHERE fd.id = ANY(v_doc_ids)
    AND fd.tenant_id = _tenant_id
    AND fd.load_id = _load_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.load_items li
      WHERE li.fiscal_document_id = fd.id
        AND li.load_id = _load_id
    );

  PERFORM public._log_entity_audit(
    _tenant_id,
    'load',
    _load_id,
    'assign_documents',
    NULL,
    jsonb_build_object('document_ids', to_jsonb(v_doc_ids), 'updated', v_count),
    'composition_rpc'
  );

  RETURN jsonb_build_object('updated', v_count, 'load_id', _load_id);
END $$;