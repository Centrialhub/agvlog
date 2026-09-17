DROP POLICY IF EXISTS return_sheets_update ON public.occurrence_return_sheets;

CREATE OR REPLACE FUNCTION public.mark_occurrence_return_sheet_printed_v1(
  _tenant_id uuid,
  _return_sheet_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sheet public.occurrence_return_sheets%ROWTYPE;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_sheet
    FROM public.occurrence_return_sheets
   WHERE id = _return_sheet_id
     AND tenant_id = _tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'return_sheet_not_found'; END IF;
  IF v_sheet.status <> 'generated' THEN
    RAISE EXCEPTION 'return_sheet_cannot_be_printed_from_%', v_sheet.status;
  END IF;

  UPDATE public.occurrence_return_sheets
     SET status = 'printed', printed_at = clock_timestamp()
   WHERE id = v_sheet.id;

  INSERT INTO public.occurrence_return_sheet_history (
    tenant_id, return_sheet_id, occurrence_id, action, created_by
  ) VALUES (
    v_sheet.tenant_id, v_sheet.id, v_sheet.occurrence_id, 'printed', auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.attach_occurrence_return_sheet_signed_proof_v1(
  _tenant_id uuid,
  _return_sheet_id uuid,
  _path text,
  _receiver_name text DEFAULT NULL,
  _receiver_document text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sheet public.occurrence_return_sheets%ROWTYPE;
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF NULLIF(btrim(_path), '') IS NULL OR _path LIKE '%..%' OR _path LIKE '%\%' THEN
    RAISE EXCEPTION 'invalid_signed_proof_path';
  END IF;

  SELECT * INTO v_sheet
    FROM public.occurrence_return_sheets
   WHERE id = _return_sheet_id
     AND tenant_id = _tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'return_sheet_not_found'; END IF;
  IF v_sheet.status NOT IN ('generated', 'printed') THEN
    RAISE EXCEPTION 'return_sheet_cannot_be_signed_from_%', v_sheet.status;
  END IF;

  UPDATE public.occurrence_return_sheets
     SET status = 'signed',
         signed_at = clock_timestamp(),
         signed_proof_url = _path,
         receiver_name = NULLIF(btrim(_receiver_name), ''),
         receiver_document = NULLIF(btrim(_receiver_document), '')
   WHERE id = v_sheet.id;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_occurrence_return_sheet_printed_v1(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.attach_occurrence_return_sheet_signed_proof_v1(uuid, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_occurrence_return_sheet_printed_v1(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attach_occurrence_return_sheet_signed_proof_v1(uuid, uuid, text, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.mark_occurrence_return_sheet_printed_v1(uuid, uuid) IS
  'Atomically transitions an active generated return sheet to printed.';
COMMENT ON FUNCTION public.attach_occurrence_return_sheet_signed_proof_v1(uuid, uuid, text, text, text) IS
  'Atomically attaches a signed proof only to generated or printed return sheets.';
