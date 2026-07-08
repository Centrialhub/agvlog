
-- Pallet returns module

CREATE TABLE public.pallet_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  color text NULL,
  description text NULL,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_by uuid NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pallet_types TO authenticated;
GRANT ALL ON public.pallet_types TO service_role;
ALTER TABLE public.pallet_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pt_select" ON public.pallet_types FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "pt_insert" ON public.pallet_types FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "pt_update" ON public.pallet_types FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "pt_delete" ON public.pallet_types FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));
CREATE UNIQUE INDEX ux_pallet_types_tenant_code ON public.pallet_types(tenant_id, upper(code));
CREATE INDEX idx_pallet_types_tenant ON public.pallet_types(tenant_id);
CREATE TRIGGER trg_pallet_types_updated_at BEFORE UPDATE ON public.pallet_types FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.pallet_return_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  protocol_number text NOT NULL,
  supplier_id uuid NULL REFERENCES public.clients(id) ON DELETE SET NULL,
  supplier_name_snapshot text NOT NULL,
  supplier_document_snapshot text NULL,
  company_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  issue_date date NOT NULL DEFAULT current_date,
  expected_return_date date NULL,
  returned_at date NULL,
  confirmed_at timestamptz NULL,
  status text NOT NULL DEFAULT 'draft',
  total_quantity integer NOT NULL DEFAULT 0,
  driver_id uuid NULL REFERENCES public.drivers(id) ON DELETE SET NULL,
  vehicle_id uuid NULL REFERENCES public.vehicles(id) ON DELETE SET NULL,
  load_id uuid NULL REFERENCES public.loads(id) ON DELETE SET NULL,
  driver_name_snapshot text NULL,
  vehicle_plate_snapshot text NULL,
  notes text NULL,
  receiver_name text NULL,
  receiver_document text NULL,
  receiver_phone text NULL,
  signature_date date NULL,
  signed_proof_url text NULL,
  pdf_url text NULL,
  cancellation_reason text NULL,
  cancelled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_by uuid NULL,
  confirmed_by uuid NULL,
  CONSTRAINT pallet_return_status_chk CHECK (status IN ('draft','scheduled','returned','partially_returned','awaiting_signature','confirmed','cancelled'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pallet_return_protocols TO authenticated;
GRANT ALL ON public.pallet_return_protocols TO service_role;
ALTER TABLE public.pallet_return_protocols ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prp_select" ON public.pallet_return_protocols FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "prp_insert" ON public.pallet_return_protocols FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "prp_update" ON public.pallet_return_protocols FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "prp_delete" ON public.pallet_return_protocols FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));
CREATE UNIQUE INDEX ux_prp_tenant_number ON public.pallet_return_protocols(tenant_id, protocol_number);
CREATE INDEX idx_prp_tenant_supplier ON public.pallet_return_protocols(tenant_id, supplier_id);
CREATE INDEX idx_prp_tenant_issue ON public.pallet_return_protocols(tenant_id, issue_date);
CREATE INDEX idx_prp_tenant_returned ON public.pallet_return_protocols(tenant_id, returned_at);
CREATE INDEX idx_prp_tenant_status ON public.pallet_return_protocols(tenant_id, status);
CREATE INDEX idx_prp_tenant_load ON public.pallet_return_protocols(tenant_id, load_id);
CREATE TRIGGER trg_prp_updated_at BEFORE UPDATE ON public.pallet_return_protocols FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.pallet_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  protocol_id uuid NOT NULL REFERENCES public.pallet_return_protocols(id) ON DELETE CASCADE,
  pallet_type_id uuid NULL REFERENCES public.pallet_types(id) ON DELETE SET NULL,
  pallet_type_code text NOT NULL,
  pallet_type_name text NOT NULL,
  pallet_color text NULL,
  quantity integer NOT NULL,
  notes text NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pallet_return_item_qty_chk CHECK (quantity > 0)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pallet_return_items TO authenticated;
GRANT ALL ON public.pallet_return_items TO service_role;
ALTER TABLE public.pallet_return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pri_select" ON public.pallet_return_items FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "pri_insert" ON public.pallet_return_items FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "pri_update" ON public.pallet_return_items FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "pri_delete" ON public.pallet_return_items FOR DELETE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id));
CREATE INDEX idx_pri_tenant_protocol ON public.pallet_return_items(tenant_id, protocol_id);
CREATE INDEX idx_pri_tenant_code ON public.pallet_return_items(tenant_id, pallet_type_code);

CREATE TABLE public.pallet_return_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  protocol_id uuid NOT NULL REFERENCES public.pallet_return_protocols(id) ON DELETE CASCADE,
  action text NOT NULL,
  field_name text NULL,
  old_value text NULL,
  new_value text NULL,
  reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);
GRANT SELECT, INSERT ON public.pallet_return_history TO authenticated;
GRANT ALL ON public.pallet_return_history TO service_role;
ALTER TABLE public.pallet_return_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prh_select" ON public.pallet_return_history FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "prh_insert" ON public.pallet_return_history FOR INSERT TO authenticated WITH CHECK (public.is_tenant_member(tenant_id));
CREATE INDEX idx_prh_tenant_protocol ON public.pallet_return_history(tenant_id, protocol_id, created_at DESC);

CREATE TABLE public.pallet_return_sequences (
  tenant_id uuid NOT NULL,
  sequence_year integer NOT NULL,
  next_number integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sequence_year)
);
GRANT SELECT, INSERT, UPDATE ON public.pallet_return_sequences TO authenticated;
GRANT ALL ON public.pallet_return_sequences TO service_role;
ALTER TABLE public.pallet_return_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prs_select" ON public.pallet_return_sequences FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "prs_insert" ON public.pallet_return_sequences FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "prs_update" ON public.pallet_return_sequences FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));

CREATE TABLE public.pallet_return_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  file_name text NULL,
  row_count integer NOT NULL DEFAULT 0,
  imported_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'processing',
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pallet_return_import_batches TO authenticated;
GRANT ALL ON public.pallet_return_import_batches TO service_role;
ALTER TABLE public.pallet_return_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prib_select" ON public.pallet_return_import_batches FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "prib_insert" ON public.pallet_return_import_batches FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "prib_update" ON public.pallet_return_import_batches FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE INDEX idx_prib_tenant_created ON public.pallet_return_import_batches(tenant_id, created_at DESC);

-- RPC: next protocol number
CREATE OR REPLACE FUNCTION public.next_pallet_return_protocol_number(_tenant_id uuid, _date date DEFAULT current_date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _year integer := EXTRACT(YEAR FROM _date)::int;
  _next integer;
BEGIN
  IF NOT public.is_tenant_member(_tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  INSERT INTO public.pallet_return_sequences (tenant_id, sequence_year, next_number)
  VALUES (_tenant_id, _year, 1)
  ON CONFLICT (tenant_id, sequence_year) DO UPDATE
    SET next_number = public.pallet_return_sequences.next_number + 1,
        updated_at = now()
  RETURNING next_number INTO _next;
  RETURN 'PAL-' || _year::text || '-' || lpad(_next::text, 4, '0');
END;
$$;

-- RPC: create protocol
CREATE OR REPLACE FUNCTION public.create_pallet_return_protocol(_tenant_id uuid, _payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _protocol_id uuid := gen_random_uuid();
  _number text;
  _items jsonb := COALESCE(_payload->'items', '[]'::jsonb);
  _total integer := 0;
  _item jsonb;
  _uid uuid := auth.uid();
  _status text := COALESCE(_payload->>'status', 'draft');
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _payload->>'supplier_name_snapshot' IS NULL OR length(trim(_payload->>'supplier_name_snapshot')) = 0 THEN
    RAISE EXCEPTION 'supplier_required';
  END IF;
  IF jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'items_required';
  END IF;
  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    IF (COALESCE((_item->>'quantity')::int, 0)) <= 0 THEN
      RAISE EXCEPTION 'invalid_quantity';
    END IF;
    _total := _total + (_item->>'quantity')::int;
  END LOOP;

  _number := public.next_pallet_return_protocol_number(_tenant_id, COALESCE((_payload->>'issue_date')::date, current_date));

  INSERT INTO public.pallet_return_protocols(
    id, tenant_id, protocol_number, supplier_id, supplier_name_snapshot, supplier_document_snapshot,
    company_snapshot, issue_date, expected_return_date, returned_at, status, total_quantity,
    driver_id, vehicle_id, load_id, driver_name_snapshot, vehicle_plate_snapshot, notes,
    receiver_name, receiver_document, receiver_phone, signature_date,
    created_by, updated_by
  ) VALUES (
    _protocol_id, _tenant_id, _number,
    NULLIF(_payload->>'supplier_id','')::uuid,
    _payload->>'supplier_name_snapshot',
    _payload->>'supplier_document_snapshot',
    COALESCE(_payload->'company_snapshot','{}'::jsonb),
    COALESCE((_payload->>'issue_date')::date, current_date),
    NULLIF(_payload->>'expected_return_date','')::date,
    NULLIF(_payload->>'returned_at','')::date,
    _status, _total,
    NULLIF(_payload->>'driver_id','')::uuid,
    NULLIF(_payload->>'vehicle_id','')::uuid,
    NULLIF(_payload->>'load_id','')::uuid,
    _payload->>'driver_name_snapshot',
    _payload->>'vehicle_plate_snapshot',
    _payload->>'notes',
    _payload->>'receiver_name',
    _payload->>'receiver_document',
    _payload->>'receiver_phone',
    NULLIF(_payload->>'signature_date','')::date,
    _uid, _uid
  );

  INSERT INTO public.pallet_return_items(tenant_id, protocol_id, pallet_type_id, pallet_type_code, pallet_type_name, pallet_color, quantity, notes, sort_order)
  SELECT _tenant_id, _protocol_id,
    NULLIF(item->>'pallet_type_id','')::uuid,
    item->>'pallet_type_code',
    item->>'pallet_type_name',
    item->>'pallet_color',
    (item->>'quantity')::int,
    item->>'notes',
    COALESCE((item->>'sort_order')::int, ord::int)
  FROM jsonb_array_elements(_items) WITH ORDINALITY AS t(item, ord);

  INSERT INTO public.pallet_return_history(tenant_id, protocol_id, action, new_value, created_by, metadata)
  VALUES (_tenant_id, _protocol_id, 'created', _number, _uid, jsonb_build_object('status', _status, 'total', _total));

  RETURN jsonb_build_object('protocol_id', _protocol_id, 'protocol_number', _number, 'total_quantity', _total);
END;
$$;

-- RPC: update status
CREATE OR REPLACE FUNCTION public.update_pallet_return_status(_protocol_id uuid, _status text, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.pallet_return_protocols%rowtype;
  _uid uuid := auth.uid();
  _valid boolean := false;
BEGIN
  SELECT * INTO _row FROM public.pallet_return_protocols WHERE id = _protocol_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(_row.tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _row.status = 'confirmed' AND NOT public.is_tenant_admin(_row.tenant_id) THEN
    RAISE EXCEPTION 'confirmed_locked';
  END IF;
  -- validate transitions
  IF (_row.status, _status) IN (
    ('draft','scheduled'),('draft','returned'),('draft','partially_returned'),('draft','cancelled'),
    ('scheduled','returned'),('scheduled','partially_returned'),('scheduled','cancelled'),
    ('returned','awaiting_signature'),('returned','confirmed'),('returned','cancelled'),('returned','partially_returned'),
    ('partially_returned','returned'),('partially_returned','confirmed'),('partially_returned','cancelled'),
    ('awaiting_signature','confirmed'),('awaiting_signature','cancelled'),
    ('confirmed','cancelled'),('confirmed','returned')
  ) THEN
    _valid := true;
  END IF;
  IF NOT _valid AND _row.status <> _status THEN
    RAISE EXCEPTION 'invalid_transition %->%', _row.status, _status;
  END IF;

  IF _status = 'confirmed' AND (_row.returned_at IS NULL AND NULLIF(_payload->>'returned_at','') IS NULL) THEN
    RAISE EXCEPTION 'returned_at_required';
  END IF;

  UPDATE public.pallet_return_protocols
    SET status = _status,
        returned_at = CASE
          WHEN _status IN ('returned','partially_returned','awaiting_signature','confirmed')
               AND returned_at IS NULL
          THEN COALESCE(NULLIF(_payload->>'returned_at','')::date, current_date)
          ELSE COALESCE(NULLIF(_payload->>'returned_at','')::date, returned_at)
        END,
        confirmed_at = CASE WHEN _status = 'confirmed' THEN now() ELSE confirmed_at END,
        confirmed_by = CASE WHEN _status = 'confirmed' THEN _uid ELSE confirmed_by END,
        receiver_name = COALESCE(_payload->>'receiver_name', receiver_name),
        receiver_document = COALESCE(_payload->>'receiver_document', receiver_document),
        signature_date = COALESCE(NULLIF(_payload->>'signature_date','')::date, signature_date),
        signed_proof_url = COALESCE(_payload->>'signed_proof_url', signed_proof_url),
        updated_at = now(),
        updated_by = _uid
    WHERE id = _protocol_id;

  INSERT INTO public.pallet_return_history(tenant_id, protocol_id, action, field_name, old_value, new_value, created_by)
  VALUES (_row.tenant_id, _protocol_id, 'status_change', 'status', _row.status, _status, _uid);
END;
$$;

-- RPC: cancel protocol
CREATE OR REPLACE FUNCTION public.cancel_pallet_return_protocol(_protocol_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.pallet_return_protocols%rowtype;
  _uid uuid := auth.uid();
BEGIN
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'reason_required';
  END IF;
  SELECT * INTO _row FROM public.pallet_return_protocols WHERE id = _protocol_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(_row.tenant_id) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _row.status = 'confirmed' AND NOT public.is_tenant_admin(_row.tenant_id) THEN
    RAISE EXCEPTION 'confirmed_cancel_requires_admin';
  END IF;
  UPDATE public.pallet_return_protocols
    SET status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = _reason,
        updated_at = now(),
        updated_by = _uid
    WHERE id = _protocol_id;
  INSERT INTO public.pallet_return_history(tenant_id, protocol_id, action, field_name, old_value, new_value, reason, created_by)
  VALUES (_row.tenant_id, _protocol_id, 'cancelled', 'status', _row.status, 'cancelled', _reason, _uid);
END;
$$;

-- Seed default pallet types for every existing tenant
INSERT INTO public.pallet_types(tenant_id, code, name, color, is_active)
SELECT t.id, v.code, v.name, v.color, true
FROM public.tenants t
CROSS JOIN (VALUES
  ('PBR','PBR (Padrão Brasil)','Madeira'),
  ('CHEP','CHEP','Azul')
) AS v(code, name, color)
ON CONFLICT DO NOTHING;
