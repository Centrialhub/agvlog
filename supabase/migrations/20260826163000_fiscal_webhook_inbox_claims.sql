-- Durable, idempotent fiscal webhook delivery claims.
-- Providers may resend the same event; only one worker may process a delivery at a time.

UPDATE public.fiscal_webhook_inbox
SET
  attempt_count = COALESCE(attempt_count, 0),
  created_at = COALESCE(created_at, now()),
  updated_at = COALESCE(updated_at, created_at, now()),
  status = CASE
    WHEN status IN ('processing', 'processed', 'failed', 'dead_lettered') THEN status
    ELSE 'failed'
  END;

ALTER TABLE public.fiscal_webhook_inbox
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN status SET DEFAULT 'processing',
  ALTER COLUMN attempt_count SET DEFAULT 0,
  ALTER COLUMN attempt_count SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.fiscal_webhook_inbox
  DROP CONSTRAINT IF EXISTS fiscal_webhook_inbox_status_check;

ALTER TABLE public.fiscal_webhook_inbox
  ADD CONSTRAINT fiscal_webhook_inbox_status_check
  CHECK (status IN ('processing', 'processed', 'failed', 'dead_lettered'));

CREATE INDEX IF NOT EXISTS idx_fiscal_webhook_inbox_retry
  ON public.fiscal_webhook_inbox (next_retry_at, updated_at)
  WHERE status IN ('processing', 'failed');

CREATE UNIQUE INDEX IF NOT EXISTS uq_cte_sefaz_events_delivery_id
  ON public.cte_sefaz_events ((payload->>'delivery_id'))
  WHERE NULLIF(payload->>'delivery_id', '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.claim_fiscal_webhook_delivery_v1(
  p_delivery_id text,
  p_event_type text,
  p_raw_payload jsonb,
  p_event_timestamp timestamptz DEFAULT now(),
  p_payload_hash text DEFAULT NULL
)
RETURNS TABLE (
  inbox_id uuid,
  claimed boolean,
  inbox_status text,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_id uuid;
  v_status text;
  v_updated_at timestamptz;
  v_next_retry_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_hash text := COALESCE(
    NULLIF(btrim(p_payload_hash), ''),
    encode(extensions.digest(p_raw_payload::text, 'sha256'), 'hex')
  );
BEGIN
  IF NULLIF(btrim(p_delivery_id), '') IS NULL OR length(p_delivery_id) > 512 THEN
    RAISE EXCEPTION 'delivery_id must contain between 1 and 512 characters';
  END IF;
  IF NULLIF(btrim(p_event_type), '') IS NULL OR length(p_event_type) > 160 THEN
    RAISE EXCEPTION 'event_type must contain between 1 and 160 characters';
  END IF;
  IF p_raw_payload IS NULL THEN
    RAISE EXCEPTION 'raw_payload is required';
  END IF;

  INSERT INTO public.fiscal_webhook_inbox (
    delivery_id,
    event_type,
    event_timestamp,
    raw_payload,
    payload_hash,
    status,
    attempt_count,
    created_at,
    updated_at
  )
  VALUES (
    btrim(p_delivery_id),
    btrim(p_event_type),
    COALESCE(p_event_timestamp, v_now),
    p_raw_payload,
    v_hash,
    'processing',
    1,
    v_now,
    v_now
  )
  ON CONFLICT (delivery_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    RETURN QUERY SELECT v_id, true, 'processing'::text, 0;
    RETURN;
  END IF;

  SELECT id, status, updated_at, next_retry_at
  INTO v_id, v_status, v_updated_at, v_next_retry_at
  FROM public.fiscal_webhook_inbox
  WHERE delivery_id = btrim(p_delivery_id)
  FOR UPDATE;

  IF v_status IN ('processed', 'dead_lettered') THEN
    RETURN QUERY SELECT v_id, false, v_status, 0;
    RETURN;
  END IF;

  IF v_status = 'processing' AND v_updated_at > v_now - interval '5 minutes' THEN
    RETURN QUERY SELECT
      v_id,
      false,
      v_status,
      GREATEST(1, ceil(extract(epoch FROM (v_updated_at + interval '5 minutes' - v_now)))::integer);
    RETURN;
  END IF;

  IF v_status = 'failed' AND v_next_retry_at IS NOT NULL AND v_next_retry_at > v_now THEN
    RETURN QUERY SELECT
      v_id,
      false,
      v_status,
      GREATEST(1, ceil(extract(epoch FROM (v_next_retry_at - v_now)))::integer);
    RETURN;
  END IF;

  UPDATE public.fiscal_webhook_inbox
  SET
    event_type = btrim(p_event_type),
    event_timestamp = COALESCE(p_event_timestamp, v_now),
    raw_payload = p_raw_payload,
    payload_hash = v_hash,
    status = 'processing',
    attempt_count = attempt_count + 1,
    last_error = NULL,
    next_retry_at = NULL,
    updated_at = v_now
  WHERE id = v_id;

  RETURN QUERY SELECT v_id, true, 'processing'::text, 0;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_fiscal_webhook_delivery_v1(
  p_inbox_id uuid,
  p_success boolean,
  p_tenant_id uuid DEFAULT NULL,
  p_emission_id uuid DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_updated_rows integer;
BEGIN
  UPDATE public.fiscal_webhook_inbox
  SET
    status = CASE
      WHEN p_success THEN 'processed'
      WHEN attempt_count >= 8 THEN 'dead_lettered'
      ELSE 'failed'
    END,
    tenant_id = COALESCE(p_tenant_id, tenant_id),
    emission_id = COALESCE(p_emission_id, emission_id),
    last_error = CASE
      WHEN p_success THEN NULL
      ELSE left(COALESCE(NULLIF(btrim(p_error), ''), 'processing_failed'), 1000)
    END,
    next_retry_at = CASE
      WHEN p_success OR attempt_count >= 8 THEN NULL
      ELSE clock_timestamp() + make_interval(
        secs => LEAST(900, GREATEST(15, (15 * power(2, LEAST(attempt_count, 6)))::integer))
      )
    END,
    updated_at = clock_timestamp()
  WHERE id = p_inbox_id
    AND status = 'processing';

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  RETURN v_updated_rows = 1;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_fiscal_webhook_delivery_v1(text, text, jsonb, timestamptz, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_fiscal_webhook_delivery_v1(uuid, boolean, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_fiscal_webhook_delivery_v1(text, text, jsonb, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_fiscal_webhook_delivery_v1(uuid, boolean, uuid, uuid, text) TO service_role;

COMMENT ON FUNCTION public.claim_fiscal_webhook_delivery_v1(text, text, jsonb, timestamptz, text)
  IS 'Atomically claims a fiscal webhook delivery with duplicate detection, retry backoff and a five-minute processing lease.';
COMMENT ON FUNCTION public.complete_fiscal_webhook_delivery_v1(uuid, boolean, uuid, uuid, text)
  IS 'Completes a claimed fiscal webhook delivery, schedules bounded exponential retry and dead-letters after eight failed attempts.';
