-- Enforce tenant ownership through the complete client-invoice graph.
-- Production migration version: 20260828123509.
CREATE UNIQUE INDEX IF NOT EXISTS clients_tenant_id_id_uidx
  ON public.clients (tenant_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS client_invoices_tenant_id_id_uidx
  ON public.client_invoices (tenant_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS client_invoice_charges_tenant_id_id_invoice_id_uidx
  ON public.client_invoice_charges (tenant_id, id, invoice_id);

ALTER TABLE public.client_invoices
  DROP CONSTRAINT IF EXISTS client_invoices_client_id_fkey,
  ADD CONSTRAINT client_invoices_tenant_client_fkey
    FOREIGN KEY (tenant_id, client_id)
    REFERENCES public.clients (tenant_id, id)
    ON DELETE RESTRICT
    NOT VALID;

ALTER TABLE public.client_invoice_charges
  DROP CONSTRAINT IF EXISTS client_invoice_charges_invoice_id_fkey,
  ADD CONSTRAINT client_invoice_charges_tenant_invoice_fkey
    FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES public.client_invoices (tenant_id, id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.client_invoice_details
  DROP CONSTRAINT IF EXISTS client_invoice_details_invoice_id_fkey,
  DROP CONSTRAINT IF EXISTS client_invoice_details_charge_id_fkey,
  ADD CONSTRAINT client_invoice_details_tenant_invoice_fkey
    FOREIGN KEY (tenant_id, invoice_id)
    REFERENCES public.client_invoices (tenant_id, id)
    ON DELETE CASCADE
    NOT VALID,
  ADD CONSTRAINT client_invoice_details_tenant_charge_invoice_fkey
    FOREIGN KEY (tenant_id, charge_id, invoice_id)
    REFERENCES public.client_invoice_charges (tenant_id, id, invoice_id)
    ON DELETE CASCADE
    NOT VALID;

ALTER TABLE public.client_invoices
  VALIDATE CONSTRAINT client_invoices_tenant_client_fkey;

ALTER TABLE public.client_invoice_charges
  VALIDATE CONSTRAINT client_invoice_charges_tenant_invoice_fkey;

ALTER TABLE public.client_invoice_details
  VALIDATE CONSTRAINT client_invoice_details_tenant_invoice_fkey,
  VALIDATE CONSTRAINT client_invoice_details_tenant_charge_invoice_fkey;

CREATE OR REPLACE FUNCTION public.create_client_invoice(payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_tenant uuid;
  v_client uuid;
  v_issue date;
  v_due date;
  v_install integer;
  v_discount numeric(14,2);
  v_interest numeric(14,2);
  v_notes text;
  v_number text;
  v_seq integer;
  v_invoice_id uuid;
  v_charge jsonb;
  v_charge_id uuid;
  v_charge_source_type text;
  v_charge_source_id uuid;
  v_charge_gross numeric(14,2);
  v_detail jsonb;
  v_detail_source_type text;
  v_detail_source_id uuid;
  v_gross numeric(14,2) := 0;
  v_total numeric(14,2);
  v_charges_count integer;
  v_receivable_id uuid;
  v_client_name text;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RAISE EXCEPTION 'payload must be a JSON object';
  END IF;

  v_tenant := NULLIF(payload->>'tenant_id', '')::uuid;
  v_client := NULLIF(payload->>'client_id', '')::uuid;
  v_issue := COALESCE(NULLIF(payload->>'issue_date', '')::date, CURRENT_DATE);
  v_due := NULLIF(payload->>'due_date', '')::date;
  v_install := COALESCE(NULLIF(payload->>'installment_number', '')::integer, 1);
  v_discount := COALESCE(NULLIF(payload->>'discount_amount', '')::numeric, 0);
  v_interest := COALESCE(NULLIF(payload->>'interest_amount', '')::numeric, 0);
  v_notes := NULLIF(btrim(payload->>'notes'), '');

  IF v_tenant IS NULL OR v_client IS NULL THEN
    RAISE EXCEPTION 'tenant_id and client_id required';
  END IF;
  IF NOT public.is_tenant_member(v_tenant) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_install < 1 OR v_install > 999 THEN
    RAISE EXCEPTION 'installment_number must be between 1 and 999';
  END IF;
  IF v_discount < 0 OR v_interest < 0 THEN
    RAISE EXCEPTION 'discount_amount and interest_amount cannot be negative';
  END IF;
  IF payload ? 'payer_snapshot'
     AND jsonb_typeof(payload->'payer_snapshot') NOT IN ('object', 'null') THEN
    RAISE EXCEPTION 'payer_snapshot must be a JSON object';
  END IF;
  IF payload ? 'company_snapshot'
     AND jsonb_typeof(payload->'company_snapshot') NOT IN ('object', 'null') THEN
    RAISE EXCEPTION 'company_snapshot must be a JSON object';
  END IF;

  SELECT c.company_name
    INTO v_client_name
    FROM public.clients AS c
   WHERE c.tenant_id = v_tenant
     AND c.id = v_client;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'client does not belong to tenant';
  END IF;

  IF jsonb_typeof(payload->'charges') <> 'array' THEN
    RAISE EXCEPTION 'charges must be a JSON array';
  END IF;
  v_charges_count := jsonb_array_length(payload->'charges');
  IF v_charges_count < 1 OR v_charges_count > 500 THEN
    RAISE EXCEPTION 'invoice requires between 1 and 500 charges';
  END IF;

  FOR v_charge IN SELECT value FROM jsonb_array_elements(payload->'charges') LOOP
    IF jsonb_typeof(v_charge) <> 'object' THEN
      RAISE EXCEPTION 'each charge must be a JSON object';
    END IF;

    v_charge_source_type := v_charge->>'source_type';
    v_charge_source_id := NULLIF(v_charge->>'source_id', '')::uuid;
    v_charge_gross := COALESCE(NULLIF(v_charge->>'gross_amount', '')::numeric, 0);

    IF v_charge_gross < 0 THEN
      RAISE EXCEPTION 'charge gross_amount cannot be negative';
    END IF;
    IF COALESCE(NULLIF(v_charge->>'discount_amount', '')::numeric, 0) < 0
       OR COALESCE(NULLIF(v_charge->>'interest_amount', '')::numeric, 0) < 0
       OR COALESCE(NULLIF(v_charge->>'ir_amount', '')::numeric, 0) < 0
       OR COALESCE(NULLIF(v_charge->>'net_amount', '')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'charge monetary amounts cannot be negative';
    END IF;

    CASE v_charge_source_type
      WHEN 'cte_document' THEN
        IF v_charge_source_id IS NULL OR NOT EXISTS (
          SELECT 1
            FROM public.cte_documents AS cte
           WHERE cte.tenant_id = v_tenant
             AND cte.id = v_charge_source_id
             AND cte.client_id = v_client
             AND cte.cancelled_at IS NULL
             AND cte.deleted_at IS NULL
             AND cte.status <> 'cancelled'
        ) THEN
          RAISE EXCEPTION 'CT-e is not eligible for this tenant and client';
        END IF;
      WHEN 'nfse_document' THEN
        IF v_charge_source_id IS NULL OR NOT EXISTS (
          SELECT 1
            FROM public.nfse_documents AS nfse
           WHERE nfse.tenant_id = v_tenant
             AND nfse.id = v_charge_source_id
             AND nfse.cliente_id = v_client
             AND nfse.cancelled = false
             AND nfse.deleted_at IS NULL
             AND nfse.status <> 'cancelled'
        ) THEN
          RAISE EXCEPTION 'NFS-e is not eligible for this tenant and client';
        END IF;
      WHEN 'manual_service' THEN
        IF v_charge_source_id IS NOT NULL THEN
          RAISE EXCEPTION 'manual service cannot reference a source document';
        END IF;
      ELSE
        RAISE EXCEPTION 'unsupported charge source_type';
    END CASE;

    IF v_charge ? 'details'
       AND jsonb_typeof(v_charge->'details') NOT IN ('array', 'null') THEN
      RAISE EXCEPTION 'charge details must be a JSON array';
    END IF;

    FOR v_detail IN
      SELECT value
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(v_charge->'details') = 'array'
               THEN v_charge->'details' ELSE '[]'::jsonb END
        )
    LOOP
      IF jsonb_typeof(v_detail) <> 'object' THEN
        RAISE EXCEPTION 'each charge detail must be a JSON object';
      END IF;

      v_detail_source_type := v_detail->>'source_type';
      v_detail_source_id := NULLIF(v_detail->>'source_id', '')::uuid;

      IF v_detail_source_type = 'fiscal_document' THEN
        IF v_charge_source_type <> 'cte_document'
           OR v_detail_source_id IS NULL
           OR NOT EXISTS (
             SELECT 1
               FROM public.fiscal_documents AS fd
               JOIN public.cte_documents AS cte
                 ON cte.tenant_id = fd.tenant_id
                AND cte.id = v_charge_source_id
              WHERE fd.tenant_id = v_tenant
                AND fd.id = v_detail_source_id
                AND fd.deleted_at IS NULL
                AND v_detail_source_id = ANY(COALESCE(cte.fiscal_document_ids, ARRAY[]::uuid[]))
           ) THEN
          RAISE EXCEPTION 'fiscal document detail is not linked to the CT-e tenant';
        END IF;
      ELSIF v_detail_source_type = 'nfse_item' THEN
        IF v_charge_source_type <> 'nfse_document' OR v_detail_source_id IS NOT NULL THEN
          RAISE EXCEPTION 'NFS-e item detail is invalid';
        END IF;
      ELSE
        RAISE EXCEPTION 'unsupported detail source_type';
      END IF;
    END LOOP;

    v_gross := v_gross + v_charge_gross;
  END LOOP;

  v_total := v_gross - v_discount + v_interest;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'total_amount cannot be negative';
  END IF;

  v_number := public.next_client_invoice_number(v_tenant, v_issue, v_install);
  v_seq := split_part(v_number, '/', 1)::integer;

  INSERT INTO public.client_invoices(
    tenant_id, client_id, invoice_number, sequence_number, installment_number,
    issue_date, due_date, gross_amount, discount_amount, interest_amount, total_amount,
    status, notes, payer_snapshot, company_snapshot, created_by, updated_by
  ) VALUES (
    v_tenant, v_client, v_number, v_seq, v_install,
    v_issue, v_due, v_gross, v_discount, v_interest, v_total,
    'generated', v_notes,
    CASE WHEN jsonb_typeof(payload->'payer_snapshot') = 'object'
         THEN payload->'payer_snapshot' ELSE '{}'::jsonb END,
    CASE WHEN jsonb_typeof(payload->'company_snapshot') = 'object'
         THEN payload->'company_snapshot' ELSE '{}'::jsonb END,
    auth.uid(), auth.uid()
  ) RETURNING id INTO v_invoice_id;

  FOR v_charge IN SELECT value FROM jsonb_array_elements(payload->'charges') LOOP
    INSERT INTO public.client_invoice_charges(
      tenant_id, invoice_id, source_type, source_id, source_number, source_series,
      reference_number, issue_date, description, gross_amount, discount_amount,
      interest_amount, ir_amount, net_amount, sort_order, metadata
    ) VALUES (
      v_tenant, v_invoice_id, v_charge->>'source_type',
      NULLIF(v_charge->>'source_id', '')::uuid,
      v_charge->>'source_number', v_charge->>'source_series',
      v_charge->>'reference_number',
      NULLIF(v_charge->>'issue_date', '')::date,
      v_charge->>'description',
      COALESCE(NULLIF(v_charge->>'gross_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_charge->>'discount_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_charge->>'interest_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_charge->>'ir_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_charge->>'net_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_charge->>'sort_order', '')::integer, 0),
      CASE WHEN jsonb_typeof(v_charge->'metadata') = 'object'
           THEN v_charge->'metadata' ELSE '{}'::jsonb END
    ) RETURNING id INTO v_charge_id;

    FOR v_detail IN
      SELECT value
        FROM jsonb_array_elements(
          CASE WHEN jsonb_typeof(v_charge->'details') = 'array'
               THEN v_charge->'details' ELSE '[]'::jsonb END
        )
    LOOP
      INSERT INTO public.client_invoice_details(
        tenant_id, invoice_id, charge_id, source_type, source_id,
        emission_date, document_label, document_number, ort_number,
        destination, remitter, recipient, weight_kg, cargo_value,
        displayed_freight_value, notes, metadata, sort_order
      ) VALUES (
        v_tenant, v_invoice_id, v_charge_id,
        v_detail->>'source_type',
        NULLIF(v_detail->>'source_id', '')::uuid,
        NULLIF(v_detail->>'emission_date', '')::date,
        v_detail->>'document_label', v_detail->>'document_number',
        v_detail->>'ort_number', v_detail->>'destination',
        v_detail->>'remitter', v_detail->>'recipient',
        NULLIF(v_detail->>'weight_kg', '')::numeric,
        NULLIF(v_detail->>'cargo_value', '')::numeric,
        NULLIF(v_detail->>'displayed_freight_value', '')::numeric,
        v_detail->>'notes',
        CASE WHEN jsonb_typeof(v_detail->'metadata') = 'object'
             THEN v_detail->'metadata' ELSE '{}'::jsonb END,
        COALESCE(NULLIF(v_detail->>'sort_order', '')::integer, 0)
      );
    END LOOP;
  END LOOP;

  INSERT INTO public.receivables(
    tenant_id, client_id, description, amount, due_date,
    invoice_number, status, notes, client_invoice_id, created_by
  ) VALUES (
    v_tenant, v_client,
    'Fatura ' || v_number || ' - ' || COALESCE(v_client_name, 'Cliente'),
    v_total, v_due, v_number, 'invoiced',
    v_notes, v_invoice_id, auth.uid()
  ) RETURNING id INTO v_receivable_id;

  UPDATE public.client_invoices
     SET receivable_id = v_receivable_id
   WHERE tenant_id = v_tenant
     AND id = v_invoice_id;

  RETURN v_invoice_id;
END;
$function$;

COMMENT ON FUNCTION public.create_client_invoice(jsonb) IS
  'Creates a client invoice atomically after validating tenant ownership and source eligibility.';
