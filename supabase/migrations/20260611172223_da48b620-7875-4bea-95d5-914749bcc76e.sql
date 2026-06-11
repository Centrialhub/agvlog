
-- =========================================
-- client_portal_access
-- =========================================
CREATE TABLE IF NOT EXISTS public.client_portal_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  access_type text NOT NULL DEFAULT 'full'
    CHECK (access_type IN ('full','remitter','recipient','payer','viewer','financial','documents_only')),
  can_view_financial boolean NOT NULL DEFAULT false,
  can_download_documents boolean NOT NULL DEFAULT true,
  can_open_occurrences boolean NOT NULL DEFAULT false,
  can_request_pickup boolean NOT NULL DEFAULT false,
  can_view_vehicle_live boolean NOT NULL DEFAULT true,
  can_view_driver_contact boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  UNIQUE (tenant_id, user_id, client_id, access_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_portal_access TO authenticated;
GRANT ALL ON public.client_portal_access TO service_role;

ALTER TABLE public.client_portal_access ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own portal access"
  ON public.client_portal_access FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_tenant_admin(tenant_id));

CREATE POLICY "Tenant admins manage portal access"
  ON public.client_portal_access FOR ALL
  TO authenticated
  USING (public.is_tenant_admin(tenant_id))
  WITH CHECK (public.is_tenant_admin(tenant_id));

CREATE INDEX IF NOT EXISTS idx_cpa_user ON public.client_portal_access(user_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_cpa_tenant_client ON public.client_portal_access(tenant_id, client_id) WHERE active;

CREATE TRIGGER trg_cpa_updated_at BEFORE UPDATE ON public.client_portal_access
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- proof_of_delivery
-- =========================================
CREATE TABLE IF NOT EXISTS public.proof_of_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  fiscal_document_id uuid NOT NULL REFERENCES public.fiscal_documents(id) ON DELETE CASCADE,
  load_id uuid REFERENCES public.loads(id) ON DELETE SET NULL,
  dispatch_trip_id uuid REFERENCES public.dispatch_trips(id) ON DELETE SET NULL,
  dispatch_stop_id uuid REFERENCES public.dispatch_stops(id) ON DELETE SET NULL,
  proof_type text NOT NULL
    CHECK (proof_type IN ('signature','pod_photo','delivery_photo','manual_receipt','receiver_confirmation','other')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','uploaded','validated','rejected','missing')),
  storage_bucket text DEFAULT 'receipts',
  storage_path text,
  receiver_name text,
  receiver_document text,
  receiver_role text,
  received_at timestamptz,
  validated_at timestamptz,
  validated_by uuid,
  rejection_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proof_of_delivery TO authenticated;
GRANT ALL ON public.proof_of_delivery TO service_role;

ALTER TABLE public.proof_of_delivery ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pod_fd ON public.proof_of_delivery(fiscal_document_id);
CREATE INDEX IF NOT EXISTS idx_pod_tenant ON public.proof_of_delivery(tenant_id);

CREATE TRIGGER trg_pod_updated_at BEFORE UPDATE ON public.proof_of_delivery
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- operational_events extensions
-- =========================================
ALTER TABLE public.operational_events
  ADD COLUMN IF NOT EXISTS visible_to_client boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_action_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_opened boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_status text DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS client_resolution_note text;

-- =========================================
-- Security helpers
-- =========================================
CREATE OR REPLACE FUNCTION public.user_has_client_access(_client_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.client_portal_access
    WHERE user_id = auth.uid()
      AND client_id = _client_id
      AND active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.get_user_client_access(_tenant_id uuid)
RETURNS TABLE (
  client_id uuid,
  access_type text,
  can_view_financial boolean,
  can_download_documents boolean,
  can_open_occurrences boolean,
  can_request_pickup boolean,
  can_view_vehicle_live boolean,
  can_view_driver_contact boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT cpa.client_id, cpa.access_type, cpa.can_view_financial, cpa.can_download_documents,
         cpa.can_open_occurrences, cpa.can_request_pickup, cpa.can_view_vehicle_live, cpa.can_view_driver_contact
  FROM public.client_portal_access cpa
  WHERE cpa.tenant_id = _tenant_id
    AND cpa.user_id = auth.uid()
    AND cpa.active = true;
$$;

-- RLS policy on POD: tenant admins manage; users with client access read
CREATE POLICY "Tenant manages POD"
  ON public.proof_of_delivery FOR ALL
  TO authenticated
  USING (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

CREATE POLICY "Clients read own POD"
  ON public.proof_of_delivery FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.fiscal_documents fd
      WHERE fd.id = proof_of_delivery.fiscal_document_id
        AND public.user_has_client_access(fd.client_id)
    )
  );

-- =========================================
-- Dashboard summary RPC
-- =========================================
CREATE OR REPLACE FUNCTION public.get_client_portal_summary(
  _tenant_id uuid,
  _start_date date DEFAULT NULL,
  _end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _client_ids uuid[];
  _result jsonb;
BEGIN
  SELECT COALESCE(array_agg(DISTINCT client_id), ARRAY[]::uuid[])
  INTO _client_ids
  FROM public.client_portal_access
  WHERE tenant_id = _tenant_id AND user_id = auth.uid() AND active = true;

  IF array_length(_client_ids, 1) IS NULL THEN
    RETURN jsonb_build_object(
      'in_transit',0,'delivered',0,'delayed',0,'pending_pickup',0,
      'pending_pod',0,'open_occurrences',0,'deliveries_today',0,'deliveries_tomorrow',0
    );
  END IF;

  WITH fds AS (
    SELECT fd.*
    FROM public.fiscal_documents fd
    WHERE fd.tenant_id = _tenant_id
      AND fd.client_id = ANY(_client_ids)
      AND (_start_date IS NULL OR fd.issue_date >= _start_date)
      AND (_end_date IS NULL OR fd.issue_date <= _end_date)
  )
  SELECT jsonb_build_object(
    'in_transit', (SELECT count(*) FROM fds WHERE status IN ('in_transit','loading','loaded')),
    'delivered', (SELECT count(*) FROM fds WHERE status = 'delivered'),
    'delayed', (SELECT count(*) FROM fds fd
                JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                WHERE ds.status IN ('pending','arriving','in_progress')
                  AND ds.planned_arrival_at < now()),
    'pending_pickup', (SELECT count(DISTINCT po.id)
                       FROM public.pickup_orders po
                       WHERE po.tenant_id = _tenant_id
                         AND po.status IN ('requested','scheduled','confirmed')
                         AND EXISTS (SELECT 1 FROM fds WHERE fds.pickup_order_id = po.id)),
    'pending_pod', (SELECT count(*) FROM fds fd
                    WHERE fd.status = 'delivered'
                      AND NOT EXISTS (SELECT 1 FROM public.proof_of_delivery p
                                      WHERE p.fiscal_document_id = fd.id AND p.status IN ('uploaded','validated'))),
    'open_occurrences', (SELECT count(*) FROM public.operational_events oe
                         WHERE oe.tenant_id = _tenant_id
                           AND oe.visible_to_client = true
                           AND oe.public_status = 'open'
                           AND EXISTS (SELECT 1 FROM fds WHERE fds.load_id = oe.load_id)),
    'deliveries_today', (SELECT count(*) FROM fds fd
                         JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                         JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                         WHERE ds.planned_arrival_at::date = CURRENT_DATE),
    'deliveries_tomorrow', (SELECT count(*) FROM fds fd
                            JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
                            JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
                            WHERE ds.planned_arrival_at::date = CURRENT_DATE + 1)
  ) INTO _result;

  RETURN _result;
END;
$$;
