
-- ============ TABLES ============

CREATE TABLE public.client_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  invoice_number text NOT NULL,
  sequence_number integer,
  installment_number integer NOT NULL DEFAULT 1,
  issue_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  gross_amount numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  interest_amount numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generated','sent','paid','cancelled')),
  notes text,
  payer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  company_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_url text,
  sent_at timestamptz,
  sent_channel text,
  sent_to text,
  receivable_id uuid,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_invoices TO authenticated;
GRANT ALL ON public.client_invoices TO service_role;
ALTER TABLE public.client_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read client_invoices" ON public.client_invoices
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "tenant members insert client_invoices" ON public.client_invoices
  FOR INSERT TO authenticated WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "tenant members update client_invoices" ON public.client_invoices
  FOR UPDATE TO authenticated USING (public.is_tenant_member(tenant_id)) WITH CHECK (public.is_tenant_member(tenant_id));
CREATE POLICY "tenant admins delete client_invoices" ON public.client_invoices
  FOR DELETE TO authenticated USING (public.is_tenant_admin(tenant_id));

CREATE INDEX idx_client_invoices_tenant_status ON public.client_invoices(tenant_id, status);
CREATE INDEX idx_client_invoices_tenant_client ON public.client_invoices(tenant_id, client_id);
CREATE INDEX idx_client_invoices_tenant_due ON public.client_invoices(tenant_id, due_date);
CREATE UNIQUE INDEX ux_client_invoices_tenant_number ON public.client_invoices(tenant_id, invoice_number);

-- ============ CHARGES ============

CREATE TABLE public.client_invoice_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.client_invoices(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('cte_document','nfse_document','manual_service')),
  source_id uuid,
  source_number text,
  source_series text,
  reference_number text,
  issue_date date,
  description text,
  gross_amount numeric(14,2) NOT NULL DEFAULT 0,
  discount_amount numeric(14,2) NOT NULL DEFAULT 0,
  interest_amount numeric(14,2) NOT NULL DEFAULT 0,
  ir_amount numeric(14,2) NOT NULL DEFAULT 0,
  net_amount numeric(14,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_invoice_charges TO authenticated;
GRANT ALL ON public.client_invoice_charges TO service_role;
ALTER TABLE public.client_invoice_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read charges" ON public.client_invoice_charges
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "tenant members write charges" ON public.client_invoice_charges
  FOR ALL TO authenticated USING (public.is_tenant_member(tenant_id)) WITH CHECK (public.is_tenant_member(tenant_id));

CREATE INDEX idx_charges_tenant_invoice ON public.client_invoice_charges(tenant_id, invoice_id);
CREATE INDEX idx_charges_tenant_source ON public.client_invoice_charges(tenant_id, source_type, source_id);
-- Impede vincular o mesmo documento em duas faturas ativas
CREATE UNIQUE INDEX ux_charges_active_source ON public.client_invoice_charges(tenant_id, source_type, source_id)
  WHERE source_id IS NOT NULL AND cancelled_at IS NULL;

-- ============ DETAILS ============

CREATE TABLE public.client_invoice_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES public.client_invoices(id) ON DELETE CASCADE,
  charge_id uuid NOT NULL REFERENCES public.client_invoice_charges(id) ON DELETE CASCADE,
  source_type text,
  source_id uuid,
  emission_date date,
  document_label text,
  document_number text,
  ort_number text,
  destination text,
  remitter text,
  recipient text,
  weight_kg numeric(14,3),
  cargo_value numeric(14,2),
  displayed_freight_value numeric(14,2),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_invoice_details TO authenticated;
GRANT ALL ON public.client_invoice_details TO service_role;
ALTER TABLE public.client_invoice_details ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read details" ON public.client_invoice_details
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "tenant members write details" ON public.client_invoice_details
  FOR ALL TO authenticated USING (public.is_tenant_member(tenant_id)) WITH CHECK (public.is_tenant_member(tenant_id));

CREATE INDEX idx_details_tenant_invoice ON public.client_invoice_details(tenant_id, invoice_id);
CREATE INDEX idx_details_tenant_charge ON public.client_invoice_details(tenant_id, charge_id);

-- ============ SEQUENCES ============

CREATE TABLE public.client_invoice_sequences (
  tenant_id uuid NOT NULL,
  sequence_year integer NOT NULL,
  next_number integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sequence_year)
);

GRANT SELECT, INSERT, UPDATE ON public.client_invoice_sequences TO authenticated;
GRANT ALL ON public.client_invoice_sequences TO service_role;
ALTER TABLE public.client_invoice_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read seq" ON public.client_invoice_sequences
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "tenant members write seq" ON public.client_invoice_sequences
  FOR ALL TO authenticated USING (public.is_tenant_member(tenant_id)) WITH CHECK (public.is_tenant_member(tenant_id));

-- ============ ALTER RECEIVABLES ============

ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS client_invoice_id uuid;
CREATE INDEX IF NOT EXISTS idx_receivables_client_invoice ON public.receivables(client_invoice_id);

-- ============ TRIGGER updated_at ============

CREATE OR REPLACE FUNCTION public.tg_client_invoices_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_client_invoices_touch
  BEFORE UPDATE ON public.client_invoices
  FOR EACH ROW EXECUTE FUNCTION public.tg_client_invoices_touch();

-- ============ RPC: next_client_invoice_number ============

CREATE OR REPLACE FUNCTION public.next_client_invoice_number(
  _tenant_id uuid,
  _issue_date date DEFAULT CURRENT_DATE,
  _installment integer DEFAULT 1
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM _issue_date)::int;
  v_next integer;
BEGIN
  IF NOT public.is_tenant_member(_tenant_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.client_invoice_sequences(tenant_id, sequence_year, next_number)
  VALUES (_tenant_id, v_year, 2)
  ON CONFLICT (tenant_id, sequence_year)
  DO UPDATE SET next_number = client_invoice_sequences.next_number + 1,
                updated_at = now()
  RETURNING next_number - 1 INTO v_next;

  RETURN v_next::text || '/' || LPAD(COALESCE(_installment,1)::text, 2, '0');
END;
$$;

-- ============ RPC: cancel_client_invoice ============

CREATE OR REPLACE FUNCTION public.cancel_client_invoice(
  _invoice_id uuid,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_receivable uuid;
  v_recv_status text;
BEGIN
  SELECT tenant_id, receivable_id INTO v_tenant, v_receivable
    FROM public.client_invoices WHERE id = _invoice_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'invoice not found';
  END IF;
  IF NOT public.is_tenant_member(v_tenant) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE public.client_invoices
     SET status = 'cancelled',
         cancelled_at = now(),
         cancellation_reason = _reason,
         updated_at = now()
   WHERE id = _invoice_id;

  UPDATE public.client_invoice_charges
     SET cancelled_at = now()
   WHERE invoice_id = _invoice_id AND cancelled_at IS NULL;

  IF v_receivable IS NOT NULL THEN
    SELECT status INTO v_recv_status FROM public.receivables WHERE id = v_receivable;
    IF v_recv_status IS NOT NULL AND v_recv_status <> 'received' THEN
      UPDATE public.receivables SET status = 'cancelled', updated_at = now() WHERE id = v_receivable;
    END IF;
  END IF;
END;
$$;

-- ============ RPC: create_client_invoice ============
-- payload:
-- {
--   tenant_id, client_id, issue_date, due_date, installment_number,
--   discount_amount, interest_amount, notes,
--   payer_snapshot, company_snapshot,
--   charges: [
--     { source_type, source_id, source_number, source_series, reference_number,
--       issue_date, description, gross_amount, discount_amount, interest_amount,
--       ir_amount, net_amount, sort_order, metadata,
--       details: [ { source_type, source_id, emission_date, document_label,
--                    document_number, ort_number, destination, remitter, recipient,
--                    weight_kg, cargo_value, displayed_freight_value, notes,
--                    metadata, sort_order } ]
--     }
--   ]
-- }

CREATE OR REPLACE FUNCTION public.create_client_invoice(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := (payload->>'tenant_id')::uuid;
  v_client uuid := (payload->>'client_id')::uuid;
  v_issue date := COALESCE((payload->>'issue_date')::date, CURRENT_DATE);
  v_due date := NULLIF(payload->>'due_date','')::date;
  v_install int := COALESCE((payload->>'installment_number')::int, 1);
  v_discount numeric(14,2) := COALESCE((payload->>'discount_amount')::numeric, 0);
  v_interest numeric(14,2) := COALESCE((payload->>'interest_amount')::numeric, 0);
  v_notes text := payload->>'notes';
  v_number text;
  v_seq int;
  v_invoice_id uuid;
  v_charge jsonb;
  v_charge_id uuid;
  v_detail jsonb;
  v_gross numeric(14,2) := 0;
  v_total numeric(14,2);
  v_charges_count int;
  v_receivable_id uuid;
  v_client_name text;
  v_year int := EXTRACT(YEAR FROM v_issue)::int;
BEGIN
  IF v_tenant IS NULL OR v_client IS NULL THEN
    RAISE EXCEPTION 'tenant_id and client_id required';
  END IF;
  IF NOT public.is_tenant_member(v_tenant) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  v_charges_count := jsonb_array_length(COALESCE(payload->'charges','[]'::jsonb));
  IF v_charges_count = 0 THEN
    RAISE EXCEPTION 'invoice requires at least one charge';
  END IF;

  -- Sum charges gross
  FOR v_charge IN SELECT * FROM jsonb_array_elements(payload->'charges') LOOP
    v_gross := v_gross + COALESCE((v_charge->>'gross_amount')::numeric, 0);
  END LOOP;

  v_total := v_gross - v_discount + v_interest;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'total_amount cannot be negative';
  END IF;

  -- Generate number
  v_number := public.next_client_invoice_number(v_tenant, v_issue, v_install);
  v_seq := split_part(v_number, '/', 1)::int;

  -- Insert invoice
  INSERT INTO public.client_invoices(
    tenant_id, client_id, invoice_number, sequence_number, installment_number,
    issue_date, due_date, gross_amount, discount_amount, interest_amount, total_amount,
    status, notes, payer_snapshot, company_snapshot, created_by, updated_by
  ) VALUES (
    v_tenant, v_client, v_number, v_seq, v_install,
    v_issue, v_due, v_gross, v_discount, v_interest, v_total,
    'generated', v_notes,
    COALESCE(payload->'payer_snapshot','{}'::jsonb),
    COALESCE(payload->'company_snapshot','{}'::jsonb),
    auth.uid(), auth.uid()
  ) RETURNING id INTO v_invoice_id;

  -- Insert charges + details
  FOR v_charge IN SELECT * FROM jsonb_array_elements(payload->'charges') LOOP
    INSERT INTO public.client_invoice_charges(
      tenant_id, invoice_id, source_type, source_id, source_number, source_series,
      reference_number, issue_date, description, gross_amount, discount_amount,
      interest_amount, ir_amount, net_amount, sort_order, metadata
    ) VALUES (
      v_tenant, v_invoice_id, v_charge->>'source_type',
      NULLIF(v_charge->>'source_id','')::uuid,
      v_charge->>'source_number', v_charge->>'source_series',
      v_charge->>'reference_number',
      NULLIF(v_charge->>'issue_date','')::date,
      v_charge->>'description',
      COALESCE((v_charge->>'gross_amount')::numeric, 0),
      COALESCE((v_charge->>'discount_amount')::numeric, 0),
      COALESCE((v_charge->>'interest_amount')::numeric, 0),
      COALESCE((v_charge->>'ir_amount')::numeric, 0),
      COALESCE((v_charge->>'net_amount')::numeric, 0),
      COALESCE((v_charge->>'sort_order')::int, 0),
      COALESCE(v_charge->'metadata','{}'::jsonb)
    ) RETURNING id INTO v_charge_id;

    FOR v_detail IN SELECT * FROM jsonb_array_elements(COALESCE(v_charge->'details','[]'::jsonb)) LOOP
      INSERT INTO public.client_invoice_details(
        tenant_id, invoice_id, charge_id, source_type, source_id,
        emission_date, document_label, document_number, ort_number,
        destination, remitter, recipient, weight_kg, cargo_value,
        displayed_freight_value, notes, metadata, sort_order
      ) VALUES (
        v_tenant, v_invoice_id, v_charge_id,
        v_detail->>'source_type',
        NULLIF(v_detail->>'source_id','')::uuid,
        NULLIF(v_detail->>'emission_date','')::date,
        v_detail->>'document_label', v_detail->>'document_number',
        v_detail->>'ort_number', v_detail->>'destination',
        v_detail->>'remitter', v_detail->>'recipient',
        NULLIF(v_detail->>'weight_kg','')::numeric,
        NULLIF(v_detail->>'cargo_value','')::numeric,
        NULLIF(v_detail->>'displayed_freight_value','')::numeric,
        v_detail->>'notes',
        COALESCE(v_detail->'metadata','{}'::jsonb),
        COALESCE((v_detail->>'sort_order')::int, 0)
      );
    END LOOP;
  END LOOP;

  -- Create receivable
  SELECT company_name INTO v_client_name FROM public.clients WHERE id = v_client;

  INSERT INTO public.receivables(
    tenant_id, client_id, description, amount, due_date,
    invoice_number, status, notes, client_invoice_id, created_by
  ) VALUES (
    v_tenant, v_client,
    'Fatura ' || v_number || ' - ' || COALESCE(v_client_name, 'Cliente'),
    v_total, v_due, v_number, 'invoiced',
    v_notes, v_invoice_id, auth.uid()
  ) RETURNING id INTO v_receivable_id;

  UPDATE public.client_invoices SET receivable_id = v_receivable_id WHERE id = v_invoice_id;

  RETURN v_invoice_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_client_invoice_number(uuid, date, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_client_invoice(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_client_invoice(jsonb) TO authenticated;
