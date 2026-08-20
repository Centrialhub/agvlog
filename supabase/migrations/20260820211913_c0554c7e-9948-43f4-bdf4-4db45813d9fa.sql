-- Consolidation of Logistics Events, Incidents, and Proof of Delivery (POD)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Enhance existing POD table
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proof_of_delivery' AND column_name = 'latitude') THEN
        ALTER TABLE public.proof_of_delivery ADD COLUMN latitude numeric(10, 8);
        ALTER TABLE public.proof_of_delivery ADD COLUMN longitude numeric(11, 8);
        ALTER TABLE public.proof_of_delivery ADD COLUMN accuracy numeric;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proof_of_delivery' AND column_name = 'version') THEN
        ALTER TABLE public.proof_of_delivery ADD COLUMN version integer NOT NULL DEFAULT 1;
        ALTER TABLE public.proof_of_delivery ADD COLUMN is_active boolean NOT NULL DEFAULT true;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proof_of_delivery' AND column_name = 'content_hash') THEN
        ALTER TABLE public.proof_of_delivery ADD COLUMN content_hash text;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proof_of_delivery' AND column_name = 'photo_url') THEN
        ALTER TABLE public.proof_of_delivery ADD COLUMN photo_url text;
        ALTER TABLE public.proof_of_delivery ADD COLUMN signature_url text;
    END IF;
END $$;

-- 2. Update operational_events
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'operational_events' AND column_name = 'dispatch_stop_id') THEN
        ALTER TABLE public.operational_events ADD COLUMN dispatch_stop_id uuid REFERENCES public.dispatch_stops(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'operational_events' AND column_name = 'proof_of_delivery_id') THEN
        ALTER TABLE public.operational_events ADD COLUMN proof_of_delivery_id uuid REFERENCES public.proof_of_delivery(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'operational_events' AND column_name = 'idempotency_key') THEN
        ALTER TABLE public.operational_events ADD COLUMN idempotency_key text;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_operational_events_idempotency ON public.operational_events(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'operational_events' AND column_name = 'payload') THEN
        ALTER TABLE public.operational_events ADD COLUMN payload jsonb DEFAULT '{}'::jsonb;
        -- Move report_details if it exists
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'operational_events' AND column_name = 'report_details') THEN
            UPDATE public.operational_events SET payload = report_details WHERE report_details IS NOT NULL;
        END IF;
    END IF;
END $$;

-- 3. Link Incidents
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'incidents' AND column_name = 'operational_event_id') THEN
        ALTER TABLE public.incidents ADD COLUMN operational_event_id uuid REFERENCES public.operational_events(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 4. Unified RPC
CREATE OR REPLACE FUNCTION public.log_operational_event_v2(
    p_tenant_id uuid,
    p_event_type text, 
    p_dispatch_stop_id uuid DEFAULT NULL,
    p_fiscal_document_id uuid DEFAULT NULL,
    p_payload jsonb DEFAULT '{}'::jsonb,
    p_pod_data jsonb DEFAULT NULL,
    p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid := auth.uid();
    v_event_id uuid;
    v_pod_id uuid;
    v_content_hash text;
BEGIN
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_event_id FROM public.operational_events 
        WHERE tenant_id = p_tenant_id AND idempotency_key = p_idempotency_key;
        IF v_event_id IS NOT NULL THEN
            RETURN jsonb_build_object('status', 'success', 'event_id', v_event_id, 'idempotent', true);
        END IF;
    END IF;

    IF p_pod_data IS NOT NULL THEN
        v_content_hash := encode(digest(p_pod_data::text, 'sha256'), 'hex');
        UPDATE public.proof_of_delivery SET is_active = false 
        WHERE dispatch_stop_id = p_dispatch_stop_id 
          AND (fiscal_document_id = p_fiscal_document_id OR (fiscal_document_id IS NULL AND p_fiscal_document_id IS NULL))
          AND tenant_id = p_tenant_id;
        INSERT INTO public.proof_of_delivery (
            tenant_id, dispatch_stop_id, fiscal_document_id, receiver_name, receiver_document,
            received_at, photo_url, signature_url, latitude, longitude, accuracy, content_hash, version, created_by
        ) VALUES (
            p_tenant_id, p_dispatch_stop_id, p_fiscal_document_id, p_pod_data->>'receiver_name', p_pod_data->>'receiver_tax_id',
            COALESCE((p_pod_data->>'signed_at')::timestamp with time zone, now()), p_pod_data->>'photo_url', p_pod_data->>'signature_url',
            (p_pod_data->>'latitude')::numeric, (p_pod_data->>'longitude')::numeric, (p_pod_data->>'accuracy')::numeric, v_content_hash,
            COALESCE((SELECT max(version) + 1 FROM public.proof_of_delivery WHERE dispatch_stop_id = p_dispatch_stop_id), 1), v_user_id
        ) RETURNING id INTO v_pod_id;
    END IF;

    INSERT INTO public.operational_events (
        tenant_id, event_type, dispatch_stop_id, proof_of_delivery_id, payload, idempotency_key, created_by
    ) VALUES (
        p_tenant_id, p_event_type, p_dispatch_stop_id, v_pod_id, p_payload, p_idempotency_key, v_user_id
    ) RETURNING id INTO v_event_id;

    IF p_event_type IN ('delivery_success', 'delivery_failure') THEN
        INSERT INTO public.delivery_occurrences (
            tenant_id, fiscal_document_id, dispatch_stop_id, occurrence_type, occurrence_description, status, created_by
        ) VALUES (
            p_tenant_id, p_fiscal_document_id, p_dispatch_stop_id, p_event_type, p_payload->>'description',
            CASE WHEN p_event_type = 'delivery_success' THEN 'completed' ELSE 'pending' END, v_user_id
        );
    END IF;

    RETURN jsonb_build_object('status', 'success', 'event_id', v_event_id, 'pod_id', v_pod_id);
END;
$$;

-- 5. Timeline Read Model
CREATE OR REPLACE VIEW public.vw_unified_logistics_timeline AS
SELECT 
    oe.id as event_id,
    oe.tenant_id,
    oe.event_type,
    oe.created_at as occurred_at,
    oe.payload,
    ds.dispatch_trip_id as trip_id,
    ds.id as stop_id,
    ds.destination as stop_location,
    pod.id as pod_id,
    pod.receiver_name,
    pod.received_at as pod_signed_at,
    inc.id as incident_id,
    inc.status as incident_status
FROM public.operational_events oe
LEFT JOIN public.dispatch_stops ds ON ds.id = oe.dispatch_stop_id
LEFT JOIN public.proof_of_delivery pod ON pod.id = oe.proof_of_delivery_id
LEFT JOIN public.incidents inc ON inc.operational_event_id = oe.id;

GRANT SELECT ON public.vw_unified_logistics_timeline TO authenticated;