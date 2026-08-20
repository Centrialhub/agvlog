
-- =====================================================
-- Helper: get client_ids that user has access to in tenant
-- =====================================================
CREATE OR REPLACE FUNCTION public._portal_user_client_ids(_tenant_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT client_id), ARRAY[]::uuid[])
  FROM public.client_portal_access
  WHERE tenant_id = _tenant_id
    AND user_id = auth.uid()
    AND active = true;
$$;

CREATE OR REPLACE FUNCTION public._portal_user_has_perm(_tenant_id uuid, _client_id uuid, _perm text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_ok boolean := false;
BEGIN
  EXECUTE format(
    'SELECT EXISTS(SELECT 1 FROM public.client_portal_access
       WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3 AND active = true AND %I = true)',
    _perm
  ) INTO v_ok USING _tenant_id, auth.uid(), _client_id;
  RETURN v_ok;
END;
$$;

-- =====================================================
-- list_client_pickups
-- =====================================================
CREATE OR REPLACE FUNCTION public.list_client_pickups(
  _tenant_id uuid,
  _status text DEFAULT NULL,
  _start_date timestamptz DEFAULT NULL,
  _end_date timestamptz DEFAULT NULL,
  _limit int DEFAULT 100,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  pickup_number text,
  remitter_name text,
  remitter_cnpj text,
  recipient_name text,
  pickup_at timestamptz,
  status text,
  notes text,
  linked_docs_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
  WITH allowed AS (SELECT unnest(public._portal_user_client_ids(_tenant_id)) AS client_id)
  SELECT
    p.id,
    p.pickup_number,
    p.remitter_name,
    p.remitter_cnpj,
    p.recipient_name,
    p.pickup_at,
    p.status,
    p.notes,
    (SELECT COUNT(*) FROM public.fiscal_documents fd WHERE fd.pickup_order_id = p.id) AS linked_docs_count
  FROM public.pickup_orders p
  WHERE p.tenant_id = _tenant_id
    AND p.remitter_client_id IN (SELECT client_id FROM allowed)
    AND (_status IS NULL OR p.status = _status)
    AND (_start_date IS NULL OR p.pickup_at >= _start_date)
    AND (_end_date IS NULL OR p.pickup_at <= _end_date)
  ORDER BY p.pickup_at DESC
  LIMIT _limit OFFSET _offset;
$$;

-- =====================================================
-- request_client_pickup
-- =====================================================
CREATE OR REPLACE FUNCTION public.request_client_pickup(
  _tenant_id uuid,
  _client_id uuid,
  _pickup_at timestamptz,
  _recipient_name text DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_num text;
  v_client RECORD;
BEGIN
  IF NOT public._portal_user_has_perm(_tenant_id, _client_id, 'can_request_pickup') THEN
    RAISE EXCEPTION 'Permission denied: cannot request pickup for this client';
  END IF;

  SELECT name, cnpj_cpf INTO v_client FROM public.clients WHERE id = _client_id AND tenant_id = _tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found';
  END IF;

  BEGIN
    SELECT public.peek_next_pickup_number(_tenant_id) INTO v_num;
  EXCEPTION WHEN OTHERS THEN
    v_num := to_char(now(), 'YYYYMMDDHH24MISS');
  END;

  INSERT INTO public.pickup_orders (
    tenant_id, pickup_number, remitter_client_id, remitter_name, remitter_cnpj,
    recipient_name, pickup_at, status, notes, created_by
  ) VALUES (
    _tenant_id, v_num, _client_id, v_client.name, v_client.cnpj_cpf,
    _recipient_name, _pickup_at, 'pendente', _notes, auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- =====================================================
-- list_client_documents
-- =====================================================
CREATE OR REPLACE FUNCTION public.list_client_documents(
  _tenant_id uuid,
  _document_type text DEFAULT NULL,
  _search text DEFAULT NULL,
  _start_date date DEFAULT NULL,
  _end_date date DEFAULT NULL,
  _limit int DEFAULT 100,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  document_type text,
  invoice_number text,
  access_key text,
  issue_date date,
  remitter text,
  recipient text,
  recipient_city text,
  recipient_state text,
  value numeric,
  weight_kg numeric,
  status text,
  load_id uuid,
  client_id uuid,
  has_pod boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
  WITH allowed AS (SELECT unnest(public._portal_user_client_ids(_tenant_id)) AS client_id)
  SELECT
    fd.id, fd.document_type, fd.invoice_number, fd.access_key, fd.issue_date,
    fd.remitter, fd.recipient, fd.recipient_city, fd.recipient_state,
    fd.value, fd.weight_kg, fd.status, fd.load_id, fd.client_id,
    EXISTS(SELECT 1 FROM public.proof_of_delivery pod WHERE pod.fiscal_document_id = fd.id) AS has_pod
  FROM public.fiscal_documents fd
  WHERE fd.tenant_id = _tenant_id
    AND fd.client_id IN (SELECT client_id FROM allowed)
    AND (_document_type IS NULL OR fd.document_type = _document_type)
    AND (_start_date IS NULL OR fd.issue_date >= _start_date)
    AND (_end_date IS NULL OR fd.issue_date <= _end_date)
    AND (_search IS NULL OR (
      fd.invoice_number ILIKE '%' || _search || '%'
      OR fd.access_key ILIKE '%' || _search || '%'
      OR fd.remitter ILIKE '%' || _search || '%'
      OR fd.recipient ILIKE '%' || _search || '%'
    ))
  ORDER BY fd.issue_date DESC NULLS LAST, fd.created_at DESC
  LIMIT _limit OFFSET _offset;
$$;

-- =====================================================
-- list_client_pods
-- =====================================================
CREATE OR REPLACE FUNCTION public.list_client_pods(
  _tenant_id uuid,
  _status text DEFAULT NULL,
  _start_date timestamptz DEFAULT NULL,
  _end_date timestamptz DEFAULT NULL,
  _limit int DEFAULT 100,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  fiscal_document_id uuid,
  load_id uuid,
  invoice_number text,
  proof_type text,
  status text,
  storage_bucket text,
  storage_path text,
  receiver_name text,
  receiver_document text,
  receiver_role text,
  received_at timestamptz,
  validated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
  WITH allowed AS (SELECT unnest(public._portal_user_client_ids(_tenant_id)) AS client_id)
  SELECT
    pod.id, pod.fiscal_document_id, pod.load_id,
    fd.invoice_number,
    pod.proof_type, pod.status, pod.storage_bucket, pod.storage_path,
    pod.receiver_name, pod.receiver_document, pod.receiver_role,
    pod.received_at, pod.validated_at
  FROM public.proof_of_delivery pod
  JOIN public.fiscal_documents fd ON fd.id = pod.fiscal_document_id
  WHERE pod.tenant_id = _tenant_id
    AND fd.client_id IN (SELECT client_id FROM allowed)
    AND (_status IS NULL OR pod.status = _status)
    AND (_start_date IS NULL OR pod.received_at >= _start_date)
    AND (_end_date IS NULL OR pod.received_at <= _end_date)
  ORDER BY pod.received_at DESC NULLS LAST, pod.created_at DESC
  LIMIT _limit OFFSET _offset;
$$;

-- =====================================================
-- list_client_occurrences
-- =====================================================
CREATE OR REPLACE FUNCTION public.list_client_occurrences(
  _tenant_id uuid,
  _severity text DEFAULT NULL,
  _resolved boolean DEFAULT NULL,
  _limit int DEFAULT 100,
  _offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  load_id uuid,
  order_id uuid,
  event_type text,
  severity text,
  description text,
  public_status text,
  client_action_required boolean,
  client_opened boolean,
  client_resolution_note text,
  resolution text,
  resolved_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
  WITH allowed AS (SELECT unnest(public._portal_user_client_ids(_tenant_id)) AS client_id)
  SELECT
    oe.id, oe.load_id, oe.order_id, oe.event_type, oe.severity, oe.description,
    oe.public_status, oe.client_action_required, oe.client_opened,
    oe.client_resolution_note, oe.resolution, oe.resolved_at, oe.created_at
  FROM public.operational_events oe
  WHERE oe.tenant_id = _tenant_id
    AND oe.client_id IN (SELECT client_id FROM allowed)
    AND (oe.visible_to_client = true OR oe.client_opened = true)
    AND (_severity IS NULL OR oe.severity = _severity)
    AND (_resolved IS NULL OR (_resolved = true AND oe.resolved_at IS NOT NULL) OR (_resolved = false AND oe.resolved_at IS NULL))
  ORDER BY oe.created_at DESC
  LIMIT _limit OFFSET _offset;
$$;

-- =====================================================
-- create_client_occurrence
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_client_occurrence(
  _tenant_id uuid,
  _client_id uuid,
  _event_type text,
  _description text,
  _severity text DEFAULT 'medium',
  _load_id uuid DEFAULT NULL,
  _order_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT public._portal_user_has_perm(_tenant_id, _client_id, 'can_open_occurrences') THEN
    RAISE EXCEPTION 'Permission denied: cannot open occurrences for this client';
  END IF;

  INSERT INTO public.operational_events (
    tenant_id, client_id, load_id, order_id, event_type, severity, description,
    visible_to_client, client_opened, public_status, created_by
  ) VALUES (
    _tenant_id, _client_id, _load_id, _order_id, _event_type, _severity, _description,
    true, true, 'reported_by_client', auth.uid()
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- =====================================================
-- get_client_pod_signed_url - returns bucket/path; signed URL gen on client
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_client_pod_metadata(
  _tenant_id uuid,
  _pod_id uuid
)
RETURNS TABLE (storage_bucket text, storage_path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
  WITH allowed AS (SELECT unnest(public._portal_user_client_ids(_tenant_id)) AS client_id)
  SELECT pod.storage_bucket, pod.storage_path
  FROM public.proof_of_delivery pod
  JOIN public.fiscal_documents fd ON fd.id = pod.fiscal_document_id
  WHERE pod.id = _pod_id
    AND pod.tenant_id = _tenant_id
    AND fd.client_id IN (SELECT client_id FROM allowed)
    AND EXISTS(
      SELECT 1 FROM public.client_portal_access cpa
      WHERE cpa.tenant_id = _tenant_id AND cpa.user_id = auth.uid()
        AND cpa.client_id = fd.client_id AND cpa.active = true
        AND cpa.can_download_documents = true
    );
$$;

-- Grants
GRANT EXECUTE ON FUNCTION public._portal_user_client_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public._portal_user_has_perm(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_client_pickups(uuid, text, timestamptz, timestamptz, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_client_pickup(uuid, uuid, timestamptz, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_client_documents(uuid, text, text, date, date, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_client_pods(uuid, text, timestamptz, timestamptz, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_client_occurrences(uuid, text, boolean, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_client_occurrence(uuid, uuid, text, text, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_pod_metadata(uuid, uuid) TO authenticated;
