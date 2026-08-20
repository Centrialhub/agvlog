
-- ============ BILLING EDI PROFILES ============
CREATE TABLE public.billing_edi_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  format text NOT NULL DEFAULT 'ctms_doccob',
  enabled boolean NOT NULL DEFAULT true,
  company_code text DEFAULT 'AGV',
  branch_code text DEFAULT 'MOC',
  document_type text DEFAULT 'FAT',
  layout_version text DEFAULT 'SIAT_CTMS_DOCCOB_SAMPLE_2026',
  destination_name text,
  bank_account_id uuid,
  bank_name text,
  bank_agency text,
  bank_account text,
  api_integration_id text,
  file_name_pattern text DEFAULT 'SIAT_CTMS_DOCCOB_{dd}_{mm}_{yyyy}_{hh}_{MM}.txt',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_edi_profiles TO authenticated;
GRANT ALL ON public.billing_edi_profiles TO service_role;
ALTER TABLE public.billing_edi_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edi_profiles_read" ON public.billing_edi_profiles
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "edi_profiles_write" ON public.billing_edi_profiles
  FOR ALL TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE INDEX idx_edi_profiles_tenant ON public.billing_edi_profiles(tenant_id);
CREATE INDEX idx_edi_profiles_tenant_client ON public.billing_edi_profiles(tenant_id, client_id);

-- ============ BILLING EDI EXPORTS ============
CREATE TABLE public.billing_edi_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  profile_id uuid REFERENCES public.billing_edi_profiles(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  format text NOT NULL DEFAULT 'ctms_doccob',
  file_name text NOT NULL,
  file_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'generated' CHECK (status IN ('draft','generated','downloaded','sent','cancelled','error')),
  invoice_count integer NOT NULL DEFAULT 0,
  charge_count integer NOT NULL DEFAULT 0,
  detail_count integer NOT NULL DEFAULT 0,
  record_count integer NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  content_hash text,
  storage_path text,
  generated_content text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid,
  downloaded_at timestamptz,
  sent_at timestamptz,
  sent_channel text,
  sent_to text,
  error_message text,
  reprocess_reason text,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_edi_exports TO authenticated;
GRANT ALL ON public.billing_edi_exports TO service_role;
ALTER TABLE public.billing_edi_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edi_exports_read" ON public.billing_edi_exports
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "edi_exports_write" ON public.billing_edi_exports
  FOR ALL TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE INDEX idx_edi_exports_tenant_status ON public.billing_edi_exports(tenant_id, status);
CREATE INDEX idx_edi_exports_tenant_client ON public.billing_edi_exports(tenant_id, client_id);
CREATE INDEX idx_edi_exports_tenant_date ON public.billing_edi_exports(tenant_id, file_date);

-- ============ BILLING EDI EXPORT ITEMS ============
CREATE TABLE public.billing_edi_export_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  export_id uuid NOT NULL REFERENCES public.billing_edi_exports(id) ON DELETE CASCADE,
  client_invoice_id uuid NOT NULL REFERENCES public.client_invoices(id) ON DELETE RESTRICT,
  receivable_id uuid REFERENCES public.receivables(id) ON DELETE SET NULL,
  invoice_number text,
  issue_date date,
  due_date date,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'included' CHECK (status IN ('included','skipped','error','cancelled')),
  validation_status text NOT NULL DEFAULT 'valid' CHECK (validation_status IN ('valid','warning','error')),
  validation_messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_edi_export_items TO authenticated;
GRANT ALL ON public.billing_edi_export_items TO service_role;
ALTER TABLE public.billing_edi_export_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "edi_items_read" ON public.billing_edi_export_items
  FOR SELECT TO authenticated USING (public.is_tenant_member(tenant_id));
CREATE POLICY "edi_items_write" ON public.billing_edi_export_items
  FOR ALL TO authenticated USING (public.is_tenant_operator_or_admin(tenant_id)) WITH CHECK (public.is_tenant_operator_or_admin(tenant_id));
CREATE INDEX idx_edi_items_tenant_export ON public.billing_edi_export_items(tenant_id, export_id);
CREATE INDEX idx_edi_items_tenant_invoice ON public.billing_edi_export_items(tenant_id, client_invoice_id);
-- Impede a mesma fatura em duas exportações ativas
CREATE UNIQUE INDEX ux_edi_items_active_invoice ON public.billing_edi_export_items(tenant_id, client_invoice_id)
  WHERE status = 'included';

-- ============ CLIENT_INVOICES EDI COLUMNS ============
ALTER TABLE public.client_invoices ADD COLUMN IF NOT EXISTS edi_status text NOT NULL DEFAULT 'not_generated';
ALTER TABLE public.client_invoices ADD COLUMN IF NOT EXISTS last_edi_export_id uuid;
ALTER TABLE public.client_invoices ADD COLUMN IF NOT EXISTS edi_generated_at timestamptz;
ALTER TABLE public.client_invoices ADD COLUMN IF NOT EXISTS edi_sent_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_invoices_edi_status_check') THEN
    ALTER TABLE public.client_invoices ADD CONSTRAINT client_invoices_edi_status_check
      CHECK (edi_status IN ('not_generated','generated','downloaded','sent','error'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_client_invoices_edi_status ON public.client_invoices(tenant_id, edi_status);

-- ============ TRIGGER updated_at ============
CREATE OR REPLACE FUNCTION public.tg_billing_edi_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_edi_profiles_touch BEFORE UPDATE ON public.billing_edi_profiles
  FOR EACH ROW EXECUTE FUNCTION public.tg_billing_edi_touch();
CREATE TRIGGER trg_edi_exports_touch BEFORE UPDATE ON public.billing_edi_exports
  FOR EACH ROW EXECUTE FUNCTION public.tg_billing_edi_touch();

-- ============ RPC: register_doccob_export ============
-- Persiste o resultado da geração DOCCOB (montada no frontend). Atômico.
CREATE OR REPLACE FUNCTION public.register_doccob_export(
  _tenant_id uuid,
  _profile_id uuid,
  _client_id uuid,
  _client_invoice_ids uuid[],
  _file_name text,
  _file_date date,
  _generated_content text,
  _content_hash text,
  _record_count integer,
  _total_amount numeric,
  _charge_count integer,
  _detail_count integer,
  _reprocess_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_export_id uuid;
  v_invoice record;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'Permissão negada para gerar DOCCOB';
  END IF;
  IF _client_invoice_ids IS NULL OR array_length(_client_invoice_ids, 1) = 0 THEN
    RAISE EXCEPTION 'Nenhuma fatura selecionada';
  END IF;

  -- Valida faturas
  FOR v_invoice IN
    SELECT id, status, edi_status, total_amount, due_date, cancelled_at
    FROM public.client_invoices
    WHERE tenant_id = _tenant_id AND id = ANY(_client_invoice_ids)
  LOOP
    IF v_invoice.status IN ('draft','cancelled') OR v_invoice.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'Fatura % não está liberada (status=%)', v_invoice.id, v_invoice.status;
    END IF;
    IF v_invoice.due_date IS NULL THEN
      RAISE EXCEPTION 'Fatura % sem data de vencimento', v_invoice.id;
    END IF;
    IF COALESCE(v_invoice.total_amount, 0) <= 0 THEN
      RAISE EXCEPTION 'Fatura % com valor inválido', v_invoice.id;
    END IF;
    IF v_invoice.edi_status IN ('generated','sent') AND _reprocess_reason IS NULL THEN
      RAISE EXCEPTION 'Fatura % já possui arquivo EDI gerado. Informe motivo para reprocessar.', v_invoice.id;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.client_invoices
      WHERE tenant_id = _tenant_id AND id = ANY(_client_invoice_ids)) <> array_length(_client_invoice_ids, 1) THEN
    RAISE EXCEPTION 'Uma ou mais faturas não pertencem ao tenant';
  END IF;

  -- Se reprocessando, cancela itens ativos anteriores
  IF _reprocess_reason IS NOT NULL THEN
    UPDATE public.billing_edi_export_items
      SET status = 'cancelled'
    WHERE tenant_id = _tenant_id
      AND client_invoice_id = ANY(_client_invoice_ids)
      AND status = 'included';
  END IF;

  INSERT INTO public.billing_edi_exports (
    tenant_id, profile_id, client_id, file_name, file_date,
    status, invoice_count, charge_count, detail_count, record_count,
    total_amount, content_hash, generated_content, generated_by, reprocess_reason
  ) VALUES (
    _tenant_id, _profile_id, _client_id, _file_name, _file_date,
    'generated', array_length(_client_invoice_ids, 1), _charge_count, _detail_count, _record_count,
    _total_amount, _content_hash, _generated_content, v_uid, _reprocess_reason
  )
  RETURNING id INTO v_export_id;

  INSERT INTO public.billing_edi_export_items (
    tenant_id, export_id, client_invoice_id, receivable_id,
    invoice_number, issue_date, due_date, amount
  )
  SELECT _tenant_id, v_export_id, ci.id, ci.receivable_id,
         ci.invoice_number, ci.issue_date, ci.due_date, ci.total_amount
  FROM public.client_invoices ci
  WHERE ci.tenant_id = _tenant_id AND ci.id = ANY(_client_invoice_ids);

  UPDATE public.client_invoices
    SET edi_status = 'generated',
        last_edi_export_id = v_export_id,
        edi_generated_at = now()
  WHERE tenant_id = _tenant_id AND id = ANY(_client_invoice_ids);

  RETURN jsonb_build_object(
    'export_id', v_export_id,
    'file_name', _file_name,
    'invoice_count', array_length(_client_invoice_ids, 1),
    'record_count', _record_count,
    'total_amount', _total_amount
  );
END;
$$;

-- ============ RPC: mark_doccob_sent ============
CREATE OR REPLACE FUNCTION public.mark_doccob_sent(_tenant_id uuid, _export_id uuid, _channel text DEFAULT 'manual', _sent_to text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'Permissão negada';
  END IF;
  UPDATE public.billing_edi_exports
    SET status = 'sent', sent_at = now(), sent_channel = _channel, sent_to = _sent_to
  WHERE id = _export_id AND tenant_id = _tenant_id;
  UPDATE public.client_invoices ci
    SET edi_status = 'sent', edi_sent_at = now()
  FROM public.billing_edi_export_items it
  WHERE it.export_id = _export_id AND it.tenant_id = _tenant_id
    AND it.client_invoice_id = ci.id AND it.status = 'included';
END;
$$;

-- ============ RPC: mark_doccob_downloaded ============
CREATE OR REPLACE FUNCTION public.mark_doccob_downloaded(_tenant_id uuid, _export_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
BEGIN
  IF NOT public.is_tenant_member(_tenant_id) THEN
    RAISE EXCEPTION 'Permissão negada';
  END IF;
  UPDATE public.billing_edi_exports
    SET downloaded_at = COALESCE(downloaded_at, now()),
        status = CASE WHEN status = 'generated' THEN 'downloaded' ELSE status END
  WHERE id = _export_id AND tenant_id = _tenant_id;
END;
$$;

-- ============ RPC: cancel_doccob_export ============
CREATE OR REPLACE FUNCTION public.cancel_doccob_export(_tenant_id uuid, _export_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public SET search_path = public AS $$
BEGIN
  IF NOT public.is_tenant_operator_or_admin(_tenant_id) THEN
    RAISE EXCEPTION 'Permissão negada';
  END IF;
  UPDATE public.billing_edi_exports
    SET status = 'cancelled', cancelled_at = now(), cancellation_reason = _reason
  WHERE id = _export_id AND tenant_id = _tenant_id;
  UPDATE public.billing_edi_export_items
    SET status = 'cancelled'
  WHERE export_id = _export_id AND tenant_id = _tenant_id AND status = 'included';
  UPDATE public.client_invoices ci
    SET edi_status = 'not_generated', last_edi_export_id = NULL, edi_generated_at = NULL, edi_sent_at = NULL
  WHERE tenant_id = _tenant_id AND ci.last_edi_export_id = _export_id;
END;
$$;
