CREATE OR REPLACE FUNCTION public.cte_defaults_for_group(p_load_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid;
  v_emitter jsonb;
  v_remitter jsonb;
  v_recipient jsonb;
  v_driver jsonb;
  v_vehicle jsonb;
  v_totals jsonb;
  v_cargo_predominant text;
BEGIN
  IF p_load_ids IS NULL OR array_length(p_load_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('error','no_loads');
  END IF;

  SELECT tenant_id INTO v_tenant FROM public.loads WHERE id = p_load_ids[1];
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('error','load_not_found');
  END IF;

  IF NOT public.is_tenant_member(v_tenant) THEN
    RAISE EXCEPTION 'Acesso negado às cargas informadas'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_load_ids) AS requested(load_id)
    LEFT JOIN public.loads AS scoped
      ON scoped.id = requested.load_id
    WHERE scoped.id IS NULL OR scoped.tenant_id <> v_tenant
  ) THEN
    RAISE EXCEPTION 'Todas as cargas devem existir e pertencer ao mesmo tenant'
      USING ERRCODE = '22023';
  END IF;

  SELECT to_jsonb(e.*) INTO v_emitter
  FROM public.tenant_emitters e
  WHERE e.tenant_id = v_tenant AND e.active = true
  ORDER BY e.is_default DESC NULLS LAST, e.created_at ASC
  LIMIT 1;

  SELECT jsonb_build_object(
    'remitter_cnpj', regexp_replace(COALESCE(remitter_cnpj,''), '[^0-9]', '', 'g'),
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

  WITH agg AS (
    SELECT
      fd.recipient,
      COALESCE(
        NULLIF(regexp_replace(COALESCE(fd.recipient_cnpj,''), '[^0-9]', '', 'g'), ''),
        NULLIF(regexp_replace(COALESCE(c.tax_id,''), '[^0-9]', '', 'g'), '')
      ) AS cnpj_norm,
      fd.recipient_city,
      fd.recipient_state,
      fd.client_id,
      COUNT(*) AS n
    FROM public.fiscal_documents fd
    LEFT JOIN public.clients c ON c.id = fd.client_id
    WHERE fd.tenant_id = v_tenant
      AND fd.document_type = 'inbound'
      AND fd.load_id = ANY(p_load_ids)
    GROUP BY fd.recipient, cnpj_norm, fd.recipient_city, fd.recipient_state, fd.client_id
    ORDER BY n DESC
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'recipient_cnpj', cnpj_norm,
    'recipient', recipient,
    'recipient_city', recipient_city,
    'recipient_state', recipient_state,
    'client_id', client_id
  ) INTO v_recipient FROM agg;

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

  SELECT product_summary INTO v_cargo_predominant
  FROM public.fiscal_documents
  WHERE load_id = ANY(p_load_ids)
    AND tenant_id = v_tenant
    AND document_type = 'inbound'
    AND product_summary IS NOT NULL
  GROUP BY product_summary
  ORDER BY COUNT(*) DESC
  LIMIT 1;

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
    'cargo_predominant', v_cargo_predominant,
    'taker_role_default', 'destinatario',
    'nature_default', 'PRESTACAO DE SERVICO DE TRANSPORTE'
  );
END;
$function$
;

