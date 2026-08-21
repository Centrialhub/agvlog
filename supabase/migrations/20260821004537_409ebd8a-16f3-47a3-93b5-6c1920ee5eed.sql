-- 1. Create Idempotency Persistence table
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    key_value text NOT NULL,
    created_at timestamptz DEFAULT now(),
    UNIQUE (tenant_id, key_value)
);

GRANT SELECT, INSERT ON public.idempotency_keys TO authenticated;
GRANT ALL ON public.idempotency_keys TO service_role;

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can see own tenant idempotency" 
ON public.idempotency_keys FOR SELECT TO authenticated 
USING (tenant_id = (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()));

-- 2. Audit Log Adjustment
DO $$ 
BEGIN
    ALTER TABLE public.entity_state_audit_log ADD COLUMN IF NOT EXISTS from_status text;
    ALTER TABLE public.entity_state_audit_log ADD COLUMN IF NOT EXISTS to_status text;
    ALTER TABLE public.entity_state_audit_log ADD COLUMN IF NOT EXISTS reason text;
    ALTER TABLE public.entity_state_audit_log ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';
    ALTER TABLE public.entity_state_audit_log ADD COLUMN IF NOT EXISTS idempotency_key text;
END $$;

-- 3. Correct RPCs to real schema

CREATE OR REPLACE FUNCTION public.check_resource_ownership(p_tenant_id uuid, p_resource_id uuid, p_table_name text)
RETURNS boolean AS $$
DECLARE
    v_exists boolean;
BEGIN
    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1 AND tenant_id = $2)', p_table_name)
    INTO v_exists
    USING p_resource_id, p_tenant_id;
    RETURN v_exists;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.create_load_v1(
    p_tenant_id uuid,
    p_vehicle_id uuid DEFAULT NULL,
    p_driver_id uuid DEFAULT NULL,
    p_origin text DEFAULT '',
    p_destination text DEFAULT '',
    p_notes text DEFAULT NULL,
    p_operation_type text DEFAULT NULL,
    p_scheduled_load_at timestamptz DEFAULT NULL,
    p_idempotency_key text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
    v_load_id uuid;
    v_load_number text;
BEGIN
    IF p_idempotency_key IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.idempotency_keys WHERE tenant_id = p_tenant_id AND key_value = p_idempotency_key) THEN
            RAISE EXCEPTION 'Duplicate request (idempotency)';
        END IF;
        INSERT INTO public.idempotency_keys (tenant_id, key_value) VALUES (p_tenant_id, p_idempotency_key);
    END IF;

    IF p_vehicle_id IS NOT NULL AND NOT check_resource_ownership(p_tenant_id, p_vehicle_id, 'vehicles') THEN
        RAISE EXCEPTION 'Vehicle does not belong to tenant';
    END IF;
    IF p_driver_id IS NOT NULL AND NOT check_resource_ownership(p_tenant_id, p_driver_id, 'drivers') THEN
        RAISE EXCEPTION 'Driver does not belong to tenant';
    END IF;

    SELECT COALESCE(MAX(load_number::int), 1000) + 1 INTO v_load_number
    FROM public.loads
    WHERE tenant_id = p_tenant_id;

    INSERT INTO public.loads (
        tenant_id, load_number, vehicle_id, driver_id, origin, destination, 
        notes, operation_type, scheduled_load_at, status
    ) VALUES (
        p_tenant_id, v_load_number, p_vehicle_id, p_driver_id, p_origin, p_destination,
        p_notes, p_operation_type, p_scheduled_load_at, 'assembling'
    ) RETURNING id INTO v_load_id;

    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, to_status, idempotency_key
    ) VALUES (
        p_tenant_id, 'load', v_load_id, 'assembling', p_idempotency_key
    );

    RETURN v_load_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'dispatch_trip_loads' AND column_name = 'trip_id') THEN
        ALTER TABLE public.dispatch_trip_loads RENAME COLUMN trip_id TO dispatch_trip_id;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.plan_dispatch_trip_v2(
    p_tenant_id uuid,
    p_vehicle_id uuid,
    p_driver_id uuid,
    p_load_ids uuid[],
    p_scheduled_start timestamptz DEFAULT now(),
    p_idempotency_key text DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
    v_trip_id uuid;
    v_load_id uuid;
BEGIN
    IF p_idempotency_key IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.idempotency_keys WHERE tenant_id = p_tenant_id AND key_value = p_idempotency_key) THEN
            RAISE EXCEPTION 'Duplicate request (idempotency)';
        END IF;
        INSERT INTO public.idempotency_keys (tenant_id, key_value) VALUES (p_tenant_id, p_idempotency_key);
    END IF;

    PERFORM 1 FROM public.loads WHERE id = ANY(p_load_ids) AND tenant_id = p_tenant_id FOR UPDATE;

    IF EXISTS (SELECT 1 FROM public.loads WHERE id = ANY(p_load_ids) AND status NOT IN ('assembling', 'ready')) THEN
        RAISE EXCEPTION 'One or more loads are not in valid status for dispatch';
    END IF;

    INSERT INTO public.dispatch_trips (
        tenant_id, vehicle_id, driver_id, status, scheduled_start_at
    ) VALUES (
        p_tenant_id, p_vehicle_id, p_driver_id, 'planned', p_scheduled_start
    ) RETURNING id INTO v_trip_id;

    FOREACH v_load_id IN ARRAY p_load_ids
    LOOP
        INSERT INTO public.dispatch_trip_loads (tenant_id, dispatch_trip_id, load_id)
        VALUES (p_tenant_id, v_trip_id, v_load_id);
        
        UPDATE public.loads SET status = 'ready', trip_id = v_trip_id 
        WHERE id = v_load_id AND tenant_id = p_tenant_id;
    END LOOP;

    INSERT INTO public.entity_state_audit_log (
        tenant_id, entity_type, entity_id, to_status, idempotency_key
    ) VALUES (
        p_tenant_id, 'trip', v_trip_id, 'planned', p_idempotency_key
    );

    RETURN v_trip_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.create_load_v1(uuid, uuid, uuid, text, text, text, text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.plan_dispatch_trip_v2(uuid, uuid, uuid, uuid[], timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_resource_ownership(uuid, uuid, text) TO authenticated;
