
-- CT-e emission: extend fiscal_documents with editable payload snapshot + SEFAZ return fields
ALTER TABLE public.fiscal_documents
  ADD COLUMN IF NOT EXISTS cte_payload jsonb,
  ADD COLUMN IF NOT EXISTS cte_taker_role text,
  ADD COLUMN IF NOT EXISTS cte_driver_id uuid,
  ADD COLUMN IF NOT EXISTS cte_vehicle_id uuid,
  ADD COLUMN IF NOT EXISTS cte_consignee_client_id uuid,
  ADD COLUMN IF NOT EXISTS sefaz_protocol text,
  ADD COLUMN IF NOT EXISTS sefaz_status text,
  ADD COLUMN IF NOT EXISTS sefaz_status_code text,
  ADD COLUMN IF NOT EXISTS sefaz_message text,
  ADD COLUMN IF NOT EXISTS hub_document_id text,
  ADD COLUMN IF NOT EXISTS emission_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fiscal_documents_cte_taker_role_check'
  ) THEN
    ALTER TABLE public.fiscal_documents
      ADD CONSTRAINT fiscal_documents_cte_taker_role_check
      CHECK (cte_taker_role IS NULL OR cte_taker_role IN ('remetente','destinatario','expedidor','recebedor','terceiro'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_fd_hub_document_id ON public.fiscal_documents(hub_document_id) WHERE hub_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fd_emission_id ON public.fiscal_documents(emission_id) WHERE emission_id IS NOT NULL;

-- RPC: compute defaults for a CT-e group (loads + mode) so the UI can pre-fill the editable preview.
CREATE OR REPLACE FUNCTION public.cte_defaults_for_group(p_load_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_emitter jsonb;
  v_remitter jsonb;
  v_recipient jsonb;
  v_driver jsonb;
  v_vehicle jsonb;
  v_totals jsonb;
BEGIN
  IF p_load_ids IS NULL OR array_length(p_load_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('error','no_loads');
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.loads WHERE id = p_load_ids[1];
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('error','load_not_found');
  END IF;

  -- Default emitter for the tenant
  SELECT to_jsonb(e.*) INTO v_emitter
  FROM public.tenant_emitters e
  WHERE e.tenant_id = v_tenant AND e.is_active = true
  ORDER BY e.is_default DESC NULLS LAST, e.created_at ASC
  LIMIT 1;

  -- Dominant remitter across inbound NFs (by count) for the loads
  SELECT jsonb_build_object(
    'remitter_cnpj', remitter_cnpj,
    'remitter', remitter,
    'origin_city', origin_city,
    'origin_state', origin_state
  ) INTO v_remitter
  FROM public.fiscal_documents
  WHERE tenant_id = v_tenant
    AND document_type = 'inbound'
    AND load_id = ANY(p_load_ids)
    AND remitter_cnpj IS NOT NULL
  GROUP BY remitter_cnpj, remitter, origin_city, origin_state
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  -- Dominant recipient (destination client)
  SELECT jsonb_build_object(
    'recipient_cnpj', recipient_cnpj,
    'recipient', recipient,
    'recipient_city', recipient_city,
    'recipient_state', recipient_state,
    'client_id', (array_agg(client_id) FILTER (WHERE client_id IS NOT NULL))[1]
  ) INTO v_recipient
  FROM public.fiscal_documents
  WHERE tenant_id = v_tenant
    AND document_type = 'inbound'
    AND load_id = ANY(p_load_ids)
  GROUP BY recipient_cnpj, recipient, recipient_city, recipient_state
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  -- Driver/vehicle from the loads
  SELECT to_jsonb(d.*) INTO v_driver
  FROM public.drivers d
  JOIN public.loads l ON l.driver_id = d.id
  WHERE l.id = ANY(p_load_ids) AND d.tenant_id = v_tenant
  LIMIT 1;

  SELECT to_jsonb(v.*) INTO v_vehicle
  FROM public.vehicles v
  JOIN public.loads l ON l.vehicle_id = v.id
  WHERE l.id = ANY(p_load_ids) AND v.tenant_id = v_tenant
  LIMIT 1;

  -- Aggregate totals from load_items + inbound NFs
  SELECT jsonb_build_object(
    'total_weight_kg', COALESCE(SUM(fd.weight_kg), 0),
    'total_value', COALESCE(SUM(fd.value), 0),
    'invoice_count', COUNT(*)
  ) INTO v_totals
  FROM public.fiscal_documents fd
  WHERE fd.tenant_id = v_tenant
    AND fd.document_type = 'inbound'
    AND fd.load_id = ANY(p_load_ids);

  RETURN jsonb_build_object(
    'tenant_id', v_tenant,
    'emitter', v_emitter,
    'remitter', v_remitter,
    'recipient', v_recipient,
    'driver', v_driver,
    'vehicle', v_vehicle,
    'totals', COALESCE(v_totals, '{}'::jsonb),
    'taker_role_default', 'destinatario',
    'nature_default', 'PRESTACAO DE SERVICO DE TRANSPORTE'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cte_defaults_for_group(uuid[]) TO authenticated;
