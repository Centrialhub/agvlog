-- [Audit & Recovery Infrastructure]
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'data_recovery_status') THEN
        CREATE TYPE public.data_recovery_status AS ENUM ('draft', 'reviewed', 'approved', 'executing', 'completed', 'failed', 'cancelled');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.data_recovery_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL,
    recovery_type text NOT NULL,
    status public.data_recovery_status NOT NULL DEFAULT 'draft',
    created_by uuid NOT NULL,
    approved_by uuid,
    reason text,
    dry_run_summary jsonb DEFAULT '{}',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.data_recovery_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id uuid REFERENCES public.data_recovery_batches(id) ON DELETE CASCADE NOT NULL,
    tenant_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    snapshot_current jsonb,
    snapshot_previous jsonb,
    proposed_action text NOT NULL,
    evidence_source text,
    evidence_details text,
    result text,
    error_log text,
    created_at timestamptz DEFAULT now(),
    executed_at timestamptz,
    UNIQUE (batch_id, entity_id)
);

GRANT SELECT, INSERT, UPDATE ON public.data_recovery_batches TO authenticated;
GRANT ALL ON public.data_recovery_batches TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.data_recovery_items TO authenticated;
GRANT ALL ON public.data_recovery_items TO service_role;

ALTER TABLE public.data_recovery_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_recovery_items ENABLE ROW LEVEL SECURITY;

-- [Webhook Inbox]
CREATE TABLE IF NOT EXISTS public.fiscal_webhook_inbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_id text UNIQUE NOT NULL,
    event_type text NOT NULL,
    event_timestamp timestamptz NOT NULL,
    raw_payload jsonb NOT NULL,
    payload_hash text,
    status text NOT NULL DEFAULT 'received',
    tenant_id uuid,
    emission_id uuid,
    attempt_count int DEFAULT 0,
    last_error text,
    next_retry_at timestamptz,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

GRANT ALL ON public.fiscal_webhook_inbox TO service_role;
ALTER TABLE public.fiscal_webhook_inbox ENABLE ROW LEVEL SECURITY;

-- [RPCs Security]
CREATE OR REPLACE FUNCTION public.build_fiscal_documents_deleted_recovery_dry_run(
    _start_time timestamptz,
    _end_time timestamptz,
    _tenant_id uuid DEFAULT NULL
)
RETURNS TABLE (
    tenant_id uuid,
    deleted_count bigint,
    sample_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT (public.has_role(auth.uid(), 'admin')) AND auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    RETURN QUERY
    SELECT 
        fd.tenant_id,
        count(*),
        array_agg(fd.id) FILTER (WHERE fd.id IS NOT NULL)
    FROM public.fiscal_documents fd
    WHERE fd.deleted_at BETWEEN _start_time AND _end_time
      AND (_tenant_id IS NULL OR fd.tenant_id = _tenant_id)
      AND fd.document_type = 'inbound'
    GROUP BY fd.tenant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.monitor_simples_nacional_icms_violations(
    _tenant_id uuid
)
RETURNS TABLE (
    document_id uuid,
    cte_number text,
    emitter_name text,
    icms_value numeric,
    cst text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT public.has_role(auth.uid(), 'admin') AND auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.tenant_memberships 
        WHERE user_id = auth.uid() 
          AND tenant_id = _tenant_id
    ) AND auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Tenant access denied';
    END IF;

    RETURN QUERY
    SELECT 
        fd.id,
        fd.cte_number,
        fd.emitter_name,
        (fd.fiscal_payload->'icms'->>'valor')::numeric,
        fd.fiscal_payload->'icms'->>'cst'
    FROM public.fiscal_documents fd
    WHERE fd.tenant_id = _tenant_id
      AND fd.deleted_at IS NULL
      AND (fd.fiscal_payload->>'isSimples')::boolean = true
      AND (fd.fiscal_payload->'icms'->>'valor')::numeric > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.monitor_simples_nacional_icms_violations(uuid) FROM public, authenticated;
GRANT EXECUTE ON FUNCTION public.monitor_simples_nacional_icms_violations(uuid) TO authenticated, service_role;
