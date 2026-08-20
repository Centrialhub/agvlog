
-- occurrence_return_sheets
CREATE TABLE public.occurrence_return_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  occurrence_id uuid NOT NULL REFERENCES public.delivery_occurrences(id) ON DELETE RESTRICT,
  sheet_number text NOT NULL,
  sac_number text NULL,
  status text NOT NULL DEFAULT 'generated',
  version integer NOT NULL DEFAULT 1,
  superseded_by uuid NULL REFERENCES public.occurrence_return_sheets(id) ON DELETE SET NULL,
  company_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurrence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  invoice_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  product_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  pdf_url text NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid NULL,
  printed_at timestamptz NULL,
  signed_at timestamptz NULL,
  signed_proof_url text NULL,
  receiver_name text NULL,
  receiver_document text NULL,
  cancellation_reason text NULL,
  cancelled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT occurrence_return_sheets_status_check
    CHECK (status IN ('generated','printed','signed','cancelled','superseded'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.occurrence_return_sheets TO authenticated;
GRANT ALL ON public.occurrence_return_sheets TO service_role;

ALTER TABLE public.occurrence_return_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "return_sheets_select" ON public.occurrence_return_sheets
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "return_sheets_insert" ON public.occurrence_return_sheets
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "return_sheets_update" ON public.occurrence_return_sheets
  FOR UPDATE TO authenticated
  USING (public.is_tenant_operator_or_admin(tenant_id))
  WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "return_sheets_delete" ON public.occurrence_return_sheets
  FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));

CREATE INDEX idx_return_sheets_tenant_occ ON public.occurrence_return_sheets(tenant_id, occurrence_id);
CREATE INDEX idx_return_sheets_tenant_status ON public.occurrence_return_sheets(tenant_id, status);
CREATE INDEX idx_return_sheets_tenant_gen ON public.occurrence_return_sheets(tenant_id, generated_at DESC);
CREATE UNIQUE INDEX uq_return_sheets_tenant_number ON public.occurrence_return_sheets(tenant_id, sheet_number);

-- occurrence_return_sheet_history
CREATE TABLE public.occurrence_return_sheet_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  return_sheet_id uuid NOT NULL REFERENCES public.occurrence_return_sheets(id) ON DELETE CASCADE,
  occurrence_id uuid NOT NULL REFERENCES public.delivery_occurrences(id) ON DELETE CASCADE,
  action text NOT NULL,
  field_name text NULL,
  old_value text NULL,
  new_value text NULL,
  reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);

GRANT SELECT, INSERT ON public.occurrence_return_sheet_history TO authenticated;
GRANT ALL ON public.occurrence_return_sheet_history TO service_role;

ALTER TABLE public.occurrence_return_sheet_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "return_sheets_history_select" ON public.occurrence_return_sheet_history
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "return_sheets_history_insert" ON public.occurrence_return_sheet_history
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));

CREATE INDEX idx_return_sheets_history_tenant_sheet
  ON public.occurrence_return_sheet_history(tenant_id, return_sheet_id, created_at DESC);

-- occurrence_return_sheet_sequences
CREATE TABLE public.occurrence_return_sheet_sequences (
  tenant_id uuid NOT NULL,
  sequence_year integer NOT NULL,
  next_number integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sequence_year)
);

GRANT SELECT ON public.occurrence_return_sheet_sequences TO authenticated;
GRANT ALL ON public.occurrence_return_sheet_sequences TO service_role;

ALTER TABLE public.occurrence_return_sheet_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "return_sheet_seq_select" ON public.occurrence_return_sheet_sequences
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));

CREATE OR REPLACE FUNCTION public.set_return_sheet_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_return_sheet_updated_at
BEFORE UPDATE ON public.occurrence_return_sheets
FOR EACH ROW EXECUTE FUNCTION public.set_return_sheet_updated_at();

CREATE OR REPLACE FUNCTION public.next_occurrence_return_sheet_number(
  _tenant_id uuid, _date date DEFAULT current_date
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE _year integer := EXTRACT(YEAR FROM _date)::int; _next integer;
BEGIN
  IF NOT public.is_tenant_member(_tenant_id) THEN
    RAISE EXCEPTION 'not authorized for tenant';
  END IF;
  INSERT INTO public.occurrence_return_sheet_sequences (tenant_id, sequence_year, next_number)
  VALUES (_tenant_id, _year, 2)
  ON CONFLICT (tenant_id, sequence_year)
  DO UPDATE SET next_number = public.occurrence_return_sheet_sequences.next_number + 1,
                updated_at = now()
  RETURNING next_number - 1 INTO _next;
  RETURN 'SAC-' || _year::text || '-' || lpad(_next::text, 4, '0');
END; $$;

GRANT EXECUTE ON FUNCTION public.next_occurrence_return_sheet_number(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.generate_occurrence_return_sheet(
  _occurrence_id uuid,
  _regenerate boolean DEFAULT false,
  _regeneration_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE
  _occ public.delivery_occurrences%ROWTYPE;
  _sheet_id uuid; _sheet_number text; _tenant uuid;
  _existing uuid; _existing_version integer;
  _occ_snap jsonb; _inv_snap jsonb; _prod_snap jsonb; _company jsonb; _load_row jsonb;
  _driver_name text; _uid uuid := auth.uid();
  _allowed_resolutions text[] := ARRAY[
    'returned_total','returned_partial','partial_return','damaged_before_dispatch',
    'refused_by_customer','rejected_invoice','shortage_found','surplus_found',
    'collection_requested','collection_done','order_divergence','inverted_product'
  ];
BEGIN
  SELECT * INTO _occ FROM public.delivery_occurrences WHERE id = _occurrence_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ocorrência não encontrada'; END IF;
  _tenant := _occ.tenant_id;
  IF NOT public.is_tenant_operator_or_admin(_tenant) THEN RAISE EXCEPTION 'not authorized'; END IF;
  IF _occ.status = 'cancelled' THEN RAISE EXCEPTION 'Ocorrência cancelada não pode gerar folha'; END IF;
  IF _occ.status NOT IN ('resolved','closed') THEN
    RAISE EXCEPTION 'Finalize a tratativa da ocorrência antes de gerar a folha de devolução.';
  END IF;
  IF _occ.resolution_type IS NULL THEN RAISE EXCEPTION 'Solução não definida para a ocorrência'; END IF;
  IF NOT (_occ.resolution_type = ANY(_allowed_resolutions)) THEN
    RAISE EXCEPTION 'Tipo de solução % não permite folha de devolução', _occ.resolution_type;
  END IF;

  SELECT id, version INTO _existing, _existing_version
    FROM public.occurrence_return_sheets
    WHERE occurrence_id = _occurrence_id AND status NOT IN ('cancelled','superseded')
    ORDER BY version DESC LIMIT 1;

  IF _existing IS NOT NULL AND NOT _regenerate THEN
    RAISE EXCEPTION 'Já existe folha ativa para esta ocorrência';
  END IF;

  IF _existing IS NOT NULL AND _regenerate THEN
    IF _regeneration_reason IS NULL OR length(trim(_regeneration_reason)) = 0 THEN
      RAISE EXCEPTION 'Informe motivo da regeração';
    END IF;
    UPDATE public.occurrence_return_sheets
      SET status='superseded', cancellation_reason=COALESCE(cancellation_reason,_regeneration_reason),
          updated_at=now() WHERE id=_existing;
    INSERT INTO public.occurrence_return_sheet_history
      (tenant_id, return_sheet_id, occurrence_id, action, reason, created_by)
    VALUES (_tenant, _existing, _occurrence_id, 'superseded', _regeneration_reason, _uid);
  END IF;

  _occ_snap := jsonb_build_object(
    'id', _occ.id, 'occurrence_number', _occ.occurrence_number,
    'occurrence_date', _occ.occurrence_date, 'occurrence_type', _occ.occurrence_type,
    'occurrence_reason', _occ.occurrence_reason, 'occurrence_description', _occ.occurrence_description,
    'resolution_type', _occ.resolution_type, 'resolution_notes', _occ.resolution_notes,
    'password_or_authorization', _occ.password_or_authorization, 'status', _occ.status,
    'resolved_at', _occ.resolved_at, 'closed_at', _occ.closed_at,
    'customer_name', _occ.customer_name, 'supplier_name', _occ.supplier_name,
    'city', _occ.city, 'state', _occ.state,
    'invoice_number', _occ.invoice_number, 'cte_number', _occ.cte_number
  );

  IF _occ.driver_id IS NOT NULL THEN
    SELECT name INTO _driver_name FROM public.drivers WHERE id = _occ.driver_id;
  END IF;

  IF _occ.load_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'id', l.id, 'load_number', l.load_number, 'trailer_plate', l.trailer_plate,
      'os_number', l.os_number, 'origin', l.origin, 'destination', l.destination,
      'driver_id', l.driver_id, 'vehicle_id', l.vehicle_id,
      'vehicle_plate', v.plate, 'driver_name', COALESCE(_driver_name, d.name)
    ) INTO _load_row
    FROM public.loads l
    LEFT JOIN public.vehicles v ON v.id = l.vehicle_id
    LEFT JOIN public.drivers d ON d.id = l.driver_id
    WHERE l.id = _occ.load_id;
  END IF;
  IF _load_row IS NULL THEN
    _load_row := jsonb_build_object('driver_name', _driver_name, 'vehicle_plate', NULL);
  END IF;

  IF _occ.fiscal_document_id IS NOT NULL THEN
    SELECT jsonb_build_array(jsonb_build_object(
      'invoice_number', COALESCE(fd.invoice_number, _occ.invoice_number),
      'issue_date', fd.issue_date, 'remitter', fd.remitter,
      'recipient', fd.recipient, 'value', fd.value
    )) INTO _inv_snap
    FROM public.fiscal_documents fd WHERE fd.id = _occ.fiscal_document_id;
  END IF;
  IF _inv_snap IS NULL OR _inv_snap = '[]'::jsonb THEN
    _inv_snap := jsonb_build_array(jsonb_build_object(
      'invoice_number', _occ.invoice_number, 'issue_date', _occ.occurrence_date,
      'remitter', _occ.supplier_name, 'recipient', _occ.customer_name, 'value', NULL
    ));
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'invoice_number', COALESCE(i.invoice_number, _occ.invoice_number),
    'product_code', i.product_code, 'product_description', i.product_description,
    'unit', i.unit, 'quantity', i.quantity, 'quantity_text', i.quantity_text,
    'item_value', i.item_value, 'quantity_problem', i.quantity,
    'return_type', i.return_type, 'notes', i.notes, 'reason', i.reason
  ) ORDER BY i.created_at), '[]'::jsonb) INTO _prod_snap
  FROM public.delivery_occurrence_items i WHERE i.occurrence_id = _occurrence_id;

  IF (_prod_snap IS NULL OR _prod_snap = '[]'::jsonb)
     AND _occ.resolution_type IN ('returned_total','refused_by_customer','rejected_invoice') THEN
    _prod_snap := jsonb_build_array(jsonb_build_object(
      'invoice_number', _occ.invoice_number,
      'product_description', 'TODOS OS ITENS DA NF',
      'return_type', 'TOTAL', 'notes', 'DEVOLUÇÃO TOTAL DA NF'
    ));
  END IF;
  IF (_prod_snap IS NULL OR _prod_snap = '[]'::jsonb) THEN
    RAISE EXCEPTION 'Ocorrência sem itens/produtos para gerar folha';
  END IF;
  IF _occ.customer_name IS NULL AND _occ.supplier_name IS NULL THEN
    RAISE EXCEPTION 'Cliente/Fornecedor não informado';
  END IF;

  SELECT jsonb_build_object('name', t.name) INTO _company FROM public.tenants t WHERE t.id = _tenant;

  _sheet_number := public.next_occurrence_return_sheet_number(_tenant, current_date);

  INSERT INTO public.occurrence_return_sheets (
    tenant_id, occurrence_id, sheet_number, sac_number, status, version,
    company_snapshot, occurrence_snapshot, invoice_snapshot, product_snapshot, generated_by
  ) VALUES (
    _tenant, _occurrence_id, _sheet_number, _sheet_number, 'generated',
    COALESCE(_existing_version, 0) + 1,
    COALESCE(_company, '{}'::jsonb) || jsonb_build_object('load', _load_row),
    _occ_snap, _inv_snap, _prod_snap, _uid
  ) RETURNING id INTO _sheet_id;

  IF _existing IS NOT NULL THEN
    UPDATE public.occurrence_return_sheets SET superseded_by = _sheet_id WHERE id = _existing;
  END IF;

  INSERT INTO public.occurrence_return_sheet_history
    (tenant_id, return_sheet_id, occurrence_id, action, reason, created_by)
  VALUES (_tenant, _sheet_id, _occurrence_id,
          CASE WHEN _regenerate THEN 'regenerated' ELSE 'generated' END,
          _regeneration_reason, _uid);

  RETURN jsonb_build_object('return_sheet_id', _sheet_id, 'sheet_number', _sheet_number);
END; $$;

GRANT EXECUTE ON FUNCTION public.generate_occurrence_return_sheet(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_occurrence_return_sheet(
  _return_sheet_id uuid, _reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
DECLARE _tenant uuid; _occ uuid;
BEGIN
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento';
  END IF;
  SELECT tenant_id, occurrence_id INTO _tenant, _occ
    FROM public.occurrence_return_sheets WHERE id = _return_sheet_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Folha não encontrada'; END IF;
  IF NOT public.is_tenant_operator_or_admin(_tenant) THEN RAISE EXCEPTION 'not authorized'; END IF;
  UPDATE public.occurrence_return_sheets
    SET status='cancelled', cancellation_reason=_reason, cancelled_at=now(), updated_at=now()
    WHERE id = _return_sheet_id;
  INSERT INTO public.occurrence_return_sheet_history
    (tenant_id, return_sheet_id, occurrence_id, action, reason, created_by)
  VALUES (_tenant, _return_sheet_id, _occ, 'cancelled', _reason, auth.uid());
END; $$;

GRANT EXECUTE ON FUNCTION public.cancel_occurrence_return_sheet(uuid, text) TO authenticated;

-- Storage RLS on storage.objects for occurrence-return-proofs
CREATE POLICY "return_proof_select" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'occurrence-return-proofs'
  AND public.is_tenant_member((split_part(name, '/', 1))::uuid)
);
CREATE POLICY "return_proof_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'occurrence-return-proofs'
  AND public.is_tenant_operator_or_admin((split_part(name, '/', 1))::uuid)
);
CREATE POLICY "return_proof_update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'occurrence-return-proofs'
  AND public.is_tenant_operator_or_admin((split_part(name, '/', 1))::uuid)
) WITH CHECK (
  bucket_id = 'occurrence-return-proofs'
  AND public.is_tenant_operator_or_admin((split_part(name, '/', 1))::uuid)
);
CREATE POLICY "return_proof_delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'occurrence-return-proofs'
  AND public.is_tenant_admin((split_part(name, '/', 1))::uuid)
);
