-- Merchandise Shortages module

CREATE TABLE public.merchandise_shortage_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  occurrence_id uuid NULL REFERENCES public.delivery_occurrences(id) ON DELETE SET NULL,
  fiscal_document_id uuid NULL REFERENCES public.fiscal_documents(id) ON DELETE SET NULL,
  load_id uuid NULL REFERENCES public.loads(id) ON DELETE SET NULL,
  cte_document_id uuid NULL REFERENCES public.cte_documents(id) ON DELETE SET NULL,
  driver_id uuid NULL REFERENCES public.drivers(id) ON DELETE SET NULL,
  vehicle_id uuid NULL REFERENCES public.vehicles(id) ON DELETE SET NULL,
  company_client_id uuid NULL REFERENCES public.clients(id) ON DELETE SET NULL,
  supplier_id uuid NULL REFERENCES public.clients(id) ON DELETE SET NULL,
  customer_id uuid NULL REFERENCES public.clients(id) ON DELETE SET NULL,
  shortage_number text NULL,
  occurrence_date date NOT NULL,
  company_name_snapshot text NULL,
  supplier_name_snapshot text NULL,
  driver_name_snapshot text NULL,
  vehicle_plate_snapshot text NULL,
  invoice_number text NULL,
  cte_number text NULL,
  load_number text NULL,
  city text NULL,
  state text NULL,
  customer_name_snapshot text NULL,
  status text NOT NULL DEFAULT 'pending_review',
  shortage_type text NULL,
  responsible_party_type text NULL,
  responsible_driver_id uuid NULL REFERENCES public.drivers(id) ON DELETE SET NULL,
  responsible_client_id uuid NULL REFERENCES public.clients(id) ON DELETE SET NULL,
  responsible_supplier_id uuid NULL REFERENCES public.clients(id) ON DELETE SET NULL,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  amount_to_charge numeric(14,2) NOT NULL DEFAULT 0,
  amount_reimbursed numeric(14,2) NOT NULL DEFAULT 0,
  amount_written_off numeric(14,2) NOT NULL DEFAULT 0,
  observation text NULL,
  investigation_notes text NULL,
  responsibility_notes text NULL,
  resolved_at timestamptz NULL,
  closed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  cancellation_reason text NULL,
  source_type text NOT NULL DEFAULT 'manual',
  import_batch_id uuid NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL,
  updated_by uuid NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.merchandise_shortage_cases TO authenticated;
GRANT ALL ON public.merchandise_shortage_cases TO service_role;
ALTER TABLE public.merchandise_shortage_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shortage_cases_select" ON public.merchandise_shortage_cases FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "shortage_cases_insert" ON public.merchandise_shortage_cases FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "shortage_cases_update" ON public.merchandise_shortage_cases FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "shortage_cases_delete" ON public.merchandise_shortage_cases FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));

CREATE INDEX idx_shortage_cases_tenant_date ON public.merchandise_shortage_cases(tenant_id, occurrence_date);
CREATE INDEX idx_shortage_cases_tenant_status ON public.merchandise_shortage_cases(tenant_id, status);
CREATE INDEX idx_shortage_cases_tenant_driver ON public.merchandise_shortage_cases(tenant_id, driver_id);
CREATE INDEX idx_shortage_cases_tenant_supplier ON public.merchandise_shortage_cases(tenant_id, supplier_id);
CREATE INDEX idx_shortage_cases_tenant_customer ON public.merchandise_shortage_cases(tenant_id, customer_id);
CREATE INDEX idx_shortage_cases_tenant_invoice ON public.merchandise_shortage_cases(tenant_id, invoice_number);
CREATE INDEX idx_shortage_cases_tenant_cte ON public.merchandise_shortage_cases(tenant_id, cte_number);
CREATE INDEX idx_shortage_cases_tenant_load ON public.merchandise_shortage_cases(tenant_id, load_id);
CREATE INDEX idx_shortage_cases_tenant_responsible ON public.merchandise_shortage_cases(tenant_id, responsible_party_type);

CREATE TABLE public.merchandise_shortage_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  shortage_case_id uuid NOT NULL REFERENCES public.merchandise_shortage_cases(id) ON DELETE CASCADE,
  occurrence_item_id uuid NULL,
  product_code text NULL,
  product_description text NOT NULL,
  quantity_text text NULL,
  quantity numeric(14,3) NULL,
  unit text NULL,
  unit_cost numeric(14,4) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  item_observation text NULL,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.merchandise_shortage_items TO authenticated;
GRANT ALL ON public.merchandise_shortage_items TO service_role;
ALTER TABLE public.merchandise_shortage_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shortage_items_select" ON public.merchandise_shortage_items FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "shortage_items_insert" ON public.merchandise_shortage_items FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "shortage_items_update" ON public.merchandise_shortage_items FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "shortage_items_delete" ON public.merchandise_shortage_items FOR DELETE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id));
CREATE INDEX idx_shortage_items_tenant_case ON public.merchandise_shortage_items(tenant_id, shortage_case_id);

CREATE TABLE public.merchandise_shortage_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  report_number text NOT NULL,
  title text NOT NULL,
  report_month integer NOT NULL,
  report_year integer NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'generated',
  filters_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_cases integer NOT NULL DEFAULT 0,
  total_items integer NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_to_charge numeric(14,2) NOT NULL DEFAULT 0,
  total_reimbursed numeric(14,2) NOT NULL DEFAULT 0,
  total_written_off numeric(14,2) NOT NULL DEFAULT 0,
  generated_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_url text NULL,
  excel_url text NULL,
  csv_url text NULL,
  sent_at timestamptz NULL,
  sent_to text NULL,
  sent_channel text NULL,
  sent_notes text NULL,
  closed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  cancellation_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.merchandise_shortage_reports TO authenticated;
GRANT ALL ON public.merchandise_shortage_reports TO service_role;
ALTER TABLE public.merchandise_shortage_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shortage_reports_select" ON public.merchandise_shortage_reports FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "shortage_reports_insert" ON public.merchandise_shortage_reports FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "shortage_reports_update" ON public.merchandise_shortage_reports FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "shortage_reports_delete" ON public.merchandise_shortage_reports FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));
CREATE INDEX idx_shortage_reports_tenant_ym ON public.merchandise_shortage_reports(tenant_id, report_year, report_month);

CREATE TABLE public.merchandise_shortage_report_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  report_id uuid NOT NULL REFERENCES public.merchandise_shortage_reports(id) ON DELETE CASCADE,
  shortage_case_id uuid NULL REFERENCES public.merchandise_shortage_cases(id) ON DELETE SET NULL,
  shortage_item_id uuid NULL REFERENCES public.merchandise_shortage_items(id) ON DELETE SET NULL,
  occurrence_date date,
  company_name text,
  driver_name text,
  invoice_number text,
  city text,
  customer_name text,
  product_description text,
  quantity_text text,
  quantity numeric(14,3),
  unit text,
  unit_cost numeric(14,4),
  total_amount numeric(14,2),
  observation text,
  status text,
  responsible_party_type text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.merchandise_shortage_report_items TO authenticated;
GRANT ALL ON public.merchandise_shortage_report_items TO service_role;
ALTER TABLE public.merchandise_shortage_report_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shortage_report_items_select" ON public.merchandise_shortage_report_items FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "shortage_report_items_insert" ON public.merchandise_shortage_report_items FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "shortage_report_items_update" ON public.merchandise_shortage_report_items FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "shortage_report_items_delete" ON public.merchandise_shortage_report_items FOR DELETE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id));
CREATE INDEX idx_shortage_report_items_tenant_report ON public.merchandise_shortage_report_items(tenant_id, report_id);

CREATE TABLE public.merchandise_shortage_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  shortage_case_id uuid NOT NULL REFERENCES public.merchandise_shortage_cases(id) ON DELETE CASCADE,
  action text NOT NULL,
  field_name text NULL,
  old_value text NULL,
  new_value text NULL,
  reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL
);
GRANT SELECT, INSERT ON public.merchandise_shortage_history TO authenticated;
GRANT ALL ON public.merchandise_shortage_history TO service_role;
ALTER TABLE public.merchandise_shortage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shortage_history_select" ON public.merchandise_shortage_history FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "shortage_history_insert" ON public.merchandise_shortage_history FOR INSERT TO authenticated WITH CHECK (public.is_tenant_member(tenant_id));

CREATE TABLE public.merchandise_shortage_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  file_name text,
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
GRANT SELECT, INSERT, UPDATE ON public.merchandise_shortage_import_batches TO authenticated;
GRANT ALL ON public.merchandise_shortage_import_batches TO service_role;
ALTER TABLE public.merchandise_shortage_import_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shortage_import_select" ON public.merchandise_shortage_import_batches FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "shortage_import_insert" ON public.merchandise_shortage_import_batches FOR INSERT TO authenticated WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE POLICY "shortage_import_update" ON public.merchandise_shortage_import_batches FOR UPDATE TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE INDEX idx_shortage_import_tenant_created ON public.merchandise_shortage_import_batches(tenant_id, created_at DESC);

CREATE TABLE public.merchandise_shortage_sequences (
  tenant_id uuid NOT NULL,
  sequence_year integer NOT NULL,
  next_number integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sequence_year)
);
GRANT SELECT, INSERT, UPDATE ON public.merchandise_shortage_sequences TO authenticated;
GRANT ALL ON public.merchandise_shortage_sequences TO service_role;
ALTER TABLE public.merchandise_shortage_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shortage_seq_all" ON public.merchandise_shortage_sequences FOR ALL TO authenticated USING (public.is_tenant_member(tenant_id)) WITH CHECK (public.is_tenant_member(tenant_id));

-- Trigger updated_at
CREATE TRIGGER trg_shortage_cases_updated_at
  BEFORE UPDATE ON public.merchandise_shortage_cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RPC: sequence number
CREATE OR REPLACE FUNCTION public.next_merchandise_shortage_number(_tenant_id uuid, _date date DEFAULT CURRENT_DATE)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _year int := EXTRACT(YEAR FROM _date)::int;
  _next int;
BEGIN
  IF NOT public.is_tenant_member(_tenant_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  INSERT INTO public.merchandise_shortage_sequences (tenant_id, sequence_year, next_number)
    VALUES (_tenant_id, _year, 2)
    ON CONFLICT (tenant_id, sequence_year)
    DO UPDATE SET next_number = merchandise_shortage_sequences.next_number + 1, updated_at = now()
    RETURNING next_number - 1 INTO _next;
  RETURN 'FAL-' || _year::text || '-' || lpad(_next::text, 4, '0');
END;
$$;

-- RPC: create case
CREATE OR REPLACE FUNCTION public.create_merchandise_shortage_case(_tenant_id uuid, _payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _case_id uuid;
  _num text;
  _items jsonb := COALESCE(_payload->'items', '[]'::jsonb);
  _total numeric(14,2) := 0;
  _item jsonb;
  _occ_date date := COALESCE((_payload->>'occurrence_date')::date, CURRENT_DATE);
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  _num := public.next_merchandise_shortage_number(_tenant_id, _occ_date);

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _total := _total + COALESCE((_item->>'total_amount')::numeric, 0);
  END LOOP;

  INSERT INTO public.merchandise_shortage_cases (
    tenant_id, occurrence_id, fiscal_document_id, load_id, cte_document_id,
    driver_id, vehicle_id, company_client_id, supplier_id, customer_id,
    shortage_number, occurrence_date,
    company_name_snapshot, supplier_name_snapshot, driver_name_snapshot,
    vehicle_plate_snapshot, invoice_number, cte_number, load_number,
    city, state, customer_name_snapshot,
    status, shortage_type, observation, source_type, import_batch_id, metadata,
    total_amount, created_by, updated_by
  ) VALUES (
    _tenant_id,
    NULLIF(_payload->>'occurrence_id','')::uuid,
    NULLIF(_payload->>'fiscal_document_id','')::uuid,
    NULLIF(_payload->>'load_id','')::uuid,
    NULLIF(_payload->>'cte_document_id','')::uuid,
    NULLIF(_payload->>'driver_id','')::uuid,
    NULLIF(_payload->>'vehicle_id','')::uuid,
    NULLIF(_payload->>'company_client_id','')::uuid,
    NULLIF(_payload->>'supplier_id','')::uuid,
    NULLIF(_payload->>'customer_id','')::uuid,
    _num,
    _occ_date,
    _payload->>'company_name_snapshot',
    _payload->>'supplier_name_snapshot',
    _payload->>'driver_name_snapshot',
    _payload->>'vehicle_plate_snapshot',
    _payload->>'invoice_number',
    _payload->>'cte_number',
    _payload->>'load_number',
    _payload->>'city',
    _payload->>'state',
    _payload->>'customer_name_snapshot',
    COALESCE(_payload->>'status','pending_review'),
    _payload->>'shortage_type',
    _payload->>'observation',
    COALESCE(_payload->>'source_type','manual'),
    NULLIF(_payload->>'import_batch_id','')::uuid,
    COALESCE(_payload->'metadata','{}'::jsonb),
    _total,
    auth.uid(), auth.uid()
  ) RETURNING id INTO _case_id;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    INSERT INTO public.merchandise_shortage_items (
      tenant_id, shortage_case_id, product_code, product_description,
      quantity_text, quantity, unit, unit_cost, total_amount, item_observation, sort_order, metadata
    ) VALUES (
      _tenant_id, _case_id,
      _item->>'product_code',
      COALESCE(_item->>'product_description',''),
      _item->>'quantity_text',
      NULLIF(_item->>'quantity','')::numeric,
      _item->>'unit',
      COALESCE((_item->>'unit_cost')::numeric, 0),
      COALESCE((_item->>'total_amount')::numeric, 0),
      _item->>'item_observation',
      COALESCE((_item->>'sort_order')::int, 0),
      COALESCE(_item->'metadata','{}'::jsonb)
    );
  END LOOP;

  INSERT INTO public.merchandise_shortage_history (tenant_id, shortage_case_id, action, new_value, created_by)
    VALUES (_tenant_id, _case_id, 'created', _num, auth.uid());

  RETURN _case_id;
END;
$$;

-- RPC: update status
CREATE OR REPLACE FUNCTION public.update_merchandise_shortage_status(_case_id uuid, _status text, _payload jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _tenant_id uuid;
  _old_status text;
BEGIN
  SELECT tenant_id, status INTO _tenant_id, _old_status FROM public.merchandise_shortage_cases WHERE id = _case_id;
  IF _tenant_id IS NULL THEN RAISE EXCEPTION 'not found'; END IF;
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN RAISE EXCEPTION 'not authorized'; END IF;

  IF _status IN ('closed') AND _payload->>'responsible_party_type' IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.merchandise_shortage_cases WHERE id=_case_id AND responsible_party_type IS NOT NULL) THEN
    RAISE EXCEPTION 'responsible_party_type required to close';
  END IF;

  IF _status = 'cancelled' AND COALESCE(_payload->>'cancellation_reason','') = '' THEN
    RAISE EXCEPTION 'cancellation_reason required';
  END IF;

  UPDATE public.merchandise_shortage_cases SET
    status = _status,
    responsible_party_type = COALESCE(_payload->>'responsible_party_type', responsible_party_type),
    responsible_driver_id = COALESCE(NULLIF(_payload->>'responsible_driver_id','')::uuid, responsible_driver_id),
    responsible_client_id = COALESCE(NULLIF(_payload->>'responsible_client_id','')::uuid, responsible_client_id),
    responsible_supplier_id = COALESCE(NULLIF(_payload->>'responsible_supplier_id','')::uuid, responsible_supplier_id),
    amount_to_charge = COALESCE((_payload->>'amount_to_charge')::numeric, amount_to_charge),
    amount_reimbursed = COALESCE((_payload->>'amount_reimbursed')::numeric, amount_reimbursed),
    amount_written_off = COALESCE((_payload->>'amount_written_off')::numeric, amount_written_off),
    investigation_notes = COALESCE(_payload->>'investigation_notes', investigation_notes),
    responsibility_notes = COALESCE(_payload->>'responsibility_notes', responsibility_notes),
    cancellation_reason = CASE WHEN _status='cancelled' THEN _payload->>'cancellation_reason' ELSE cancellation_reason END,
    cancelled_at = CASE WHEN _status='cancelled' THEN now() ELSE cancelled_at END,
    closed_at = CASE WHEN _status='closed' THEN now() ELSE closed_at END,
    resolved_at = CASE WHEN _status IN ('confirmed_shortage','supplier_fault','driver_fault','company_fault','customer_fault','not_shortage') AND resolved_at IS NULL THEN now() ELSE resolved_at END,
    updated_by = auth.uid()
  WHERE id = _case_id;

  INSERT INTO public.merchandise_shortage_history (tenant_id, shortage_case_id, action, field_name, old_value, new_value, reason, created_by)
    VALUES (_tenant_id, _case_id, 'status_changed', 'status', _old_status, _status, _payload->>'cancellation_reason', auth.uid());
END;
$$;

-- Recalc trigger for total_amount
CREATE OR REPLACE FUNCTION public.recalc_shortage_case_total()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  _case uuid := COALESCE(NEW.shortage_case_id, OLD.shortage_case_id);
BEGIN
  UPDATE public.merchandise_shortage_cases
    SET total_amount = COALESCE((SELECT SUM(total_amount) FROM public.merchandise_shortage_items WHERE shortage_case_id = _case), 0),
        updated_at = now()
    WHERE id = _case;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_recalc_shortage_case_total
  AFTER INSERT OR UPDATE OR DELETE ON public.merchandise_shortage_items
  FOR EACH ROW EXECUTE FUNCTION public.recalc_shortage_case_total();
