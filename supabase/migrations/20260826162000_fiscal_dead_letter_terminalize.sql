-- Atomically terminalize an exhausted fiscal poll and create/update its
-- reconciliation queue entry. Only Edge Functions using service_role may call
-- this RPC; browser users retain read-only access to the queue through RLS.
CREATE OR REPLACE FUNCTION public.terminalize_fiscal_poll_v1(
  p_tenant_id uuid,
  p_document_kind text,
  p_document_id uuid,
  p_document_number text,
  p_reason_code text,
  p_attempt_count integer,
  p_first_seen_at timestamptz,
  p_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_message text;
BEGIN
  IF p_document_kind NOT IN ('cte', 'nfse') THEN RAISE EXCEPTION 'invalid_document_kind'; END IF;
  IF p_reason_code NOT IN (
    'missing_provider_reference', 'provider_unavailable',
    'provider_rate_limited', 'status_timeout'
  ) THEN RAISE EXCEPTION 'invalid_reason_code'; END IF;
  IF p_attempt_count < 1 THEN RAISE EXCEPTION 'invalid_attempt_count'; END IF;

  v_message := CASE p_reason_code
    WHEN 'missing_provider_reference' THEN 'Emissão sem identificador no provedor; encaminhada para reconciliação.'
    WHEN 'provider_rate_limited' THEN 'Provedor limitou as consultas além do prazo; encaminhado para reconciliação.'
    WHEN 'provider_unavailable' THEN 'Provedor indisponível além do prazo; encaminhado para reconciliação.'
    ELSE 'O provedor não concluiu o processamento em até 15 minutos.'
  END;

  IF p_document_kind = 'cte' THEN
    UPDATE public.fiscal_documents
    SET status = 'error',
        sefaz_status = 'status_timeout',
        sefaz_message = v_message,
        last_status_check_at = now(),
        status_check_attempts = p_attempt_count,
        last_status_response = COALESCE(p_context, '{}'::jsonb)
    WHERE id = p_document_id AND tenant_id = p_tenant_id;
  ELSE
    UPDATE public.nfse_documents
    SET status = 'error',
        rejection_messages = jsonb_build_object(
          'code', upper(p_reason_code),
          'message', v_message
        ),
        last_status_check_at = now(),
        status_check_attempts = p_attempt_count,
        last_status_response = COALESCE(p_context, '{}'::jsonb)
    WHERE id = p_document_id AND tenant_id = p_tenant_id;
  END IF;

  IF NOT FOUND THEN RAISE EXCEPTION 'fiscal_document_not_found'; END IF;

  INSERT INTO public.fiscal_poll_dead_letters (
    tenant_id, document_kind, document_id, document_number, reason_code,
    attempt_count, first_seen_at, last_attempt_at, context, updated_at
  ) VALUES (
    p_tenant_id, p_document_kind, p_document_id, NULLIF(btrim(p_document_number), ''),
    p_reason_code, p_attempt_count, p_first_seen_at, now(),
    COALESCE(p_context, '{}'::jsonb), now()
  )
  ON CONFLICT (document_kind, document_id) WHERE status = 'open'
  DO UPDATE SET
    reason_code = EXCLUDED.reason_code,
    attempt_count = GREATEST(public.fiscal_poll_dead_letters.attempt_count, EXCLUDED.attempt_count),
    last_attempt_at = EXCLUDED.last_attempt_at,
    context = EXCLUDED.context,
    updated_at = now();

  RETURN jsonb_build_object(
    'document_id', p_document_id,
    'document_kind', p_document_kind,
    'status', 'error',
    'queued_for_reconciliation', true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.terminalize_fiscal_poll_v1(
  uuid, text, uuid, text, text, integer, timestamptz, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terminalize_fiscal_poll_v1(
  uuid, text, uuid, text, text, integer, timestamptz, jsonb
) TO service_role;

