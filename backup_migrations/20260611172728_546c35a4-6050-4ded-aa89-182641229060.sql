
-- =========================================
-- search_client_portal_shipments
-- =========================================
CREATE OR REPLACE FUNCTION public.search_client_portal_shipments(
  _tenant_id uuid,
  _search text DEFAULT NULL,
  _status text[] DEFAULT NULL,
  _start_date date DEFAULT NULL,
  _end_date date DEFAULT NULL,
  _city text DEFAULT NULL,
  _state text DEFAULT NULL,
  _has_pod boolean DEFAULT NULL,
  _has_occurrence boolean DEFAULT NULL,
  _limit int DEFAULT 50,
  _offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path = public
AS $$
DECLARE
  _client_ids uuid[];
  _tax_ids text[];
  _access_types text[];
  _can_financial boolean := false;
  _rows jsonb;
  _total int;
  _search_norm text;
BEGIN
  SELECT
    COALESCE(array_agg(DISTINCT cpa.client_id), ARRAY[]::uuid[]),
    COALESCE(array_agg(DISTINCT cpa.access_type), ARRAY[]::text[]),
    bool_or(cpa.can_view_financial)
  INTO _client_ids, _access_types, _can_financial
  FROM public.client_portal_access cpa
  WHERE cpa.tenant_id = _tenant_id AND cpa.user_id = auth.uid() AND cpa.active = true;

  IF array_length(_client_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('rows','[]'::jsonb,'total',0);
  END IF;

  SELECT COALESCE(array_agg(DISTINCT tax_id), ARRAY[]::text[])
  INTO _tax_ids
  FROM public.clients
  WHERE id = ANY(_client_ids) AND tax_id IS NOT NULL;

  _search_norm := NULLIF(trim(_search), '');

  WITH base AS (
    SELECT
      fd.id AS fiscal_document_id,
      fd.tenant_id,
      fd.client_id,
      fd.invoice_number,
      fd.access_key,
      fd.issue_date,
      fd.document_type,
      fd.status AS document_status,
      fd.client_load_number,
      fd.reference_number,
      fd.remitter,
      fd.remitter_cnpj,
      fd.recipient,
      fd.recipient_cnpj,
      fd.recipient_city,
      fd.recipient_state,
      fd.recipient_neighborhood,
      fd.product_summary,
      fd.pallet_count,
      fd.weight_kg,
      CASE WHEN _can_financial THEN fd.value END AS value,
      CASE WHEN _can_financial THEN fd.freight_value END AS freight_value,
      fd.load_id,
      fd.pickup_order_id,
      fd.updated_at,
      l.load_number,
      l.status AS load_status,
      l.trip_id,
      ds.id AS dispatch_stop_id,
      ds.status AS stop_status,
      ds.planned_arrival_at,
      ds.actual_arrival_at,
      ds.actual_departure_at,
      EXISTS (
        SELECT 1 FROM public.proof_of_delivery p
        WHERE p.fiscal_document_id = fd.id AND p.status IN ('uploaded','validated')
      ) AS has_pod,
      EXISTS (
        SELECT 1 FROM public.operational_events oe
        WHERE oe.tenant_id = _tenant_id
          AND oe.load_id = fd.load_id
          AND oe.visible_to_client = true
          AND oe.public_status = 'open'
      ) AS has_open_occurrence
    FROM public.fiscal_documents fd
    LEFT JOIN public.loads l ON l.id = fd.load_id
    LEFT JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = fd.id
    LEFT JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
    WHERE fd.tenant_id = _tenant_id
      AND (
        fd.client_id = ANY(_client_ids)
        OR (
          'recipient' = ANY(_access_types) AND fd.recipient_cnpj = ANY(_tax_ids)
        )
        OR (
          'remitter' = ANY(_access_types) AND fd.remitter_cnpj = ANY(_tax_ids)
        )
      )
      AND (_start_date IS NULL OR fd.issue_date >= _start_date)
      AND (_end_date IS NULL OR fd.issue_date <= _end_date)
      AND (_city IS NULL OR fd.recipient_city ILIKE _city)
      AND (_state IS NULL OR fd.recipient_state ILIKE _state)
      AND (_status IS NULL OR fd.status = ANY(_status))
      AND (
        _search_norm IS NULL
        OR fd.invoice_number ILIKE '%' || _search_norm || '%'
        OR fd.access_key ILIKE '%' || _search_norm || '%'
        OR fd.client_load_number ILIKE '%' || _search_norm || '%'
        OR fd.reference_number ILIKE '%' || _search_norm || '%'
        OR fd.recipient ILIKE '%' || _search_norm || '%'
        OR fd.recipient_cnpj ILIKE '%' || _search_norm || '%'
        OR fd.recipient_city ILIKE '%' || _search_norm || '%'
        OR COALESCE(l.load_number,'') ILIKE '%' || _search_norm || '%'
      )
  ),
  filtered AS (
    SELECT * FROM base
    WHERE (_has_pod IS NULL OR has_pod = _has_pod)
      AND (_has_occurrence IS NULL OR has_open_occurrence = _has_occurrence)
  )
  SELECT
    COALESCE(jsonb_agg(row_to_jsonb(f) ORDER BY f.issue_date DESC NULLS LAST, f.updated_at DESC), '[]'::jsonb),
    (SELECT count(*) FROM filtered)
  INTO _rows, _total
  FROM (SELECT * FROM filtered ORDER BY issue_date DESC NULLS LAST, updated_at DESC LIMIT _limit OFFSET _offset) f;

  RETURN jsonb_build_object('rows', _rows, 'total', _total);
END;
$$;

-- =========================================
-- get_client_portal_shipment_detail
-- =========================================
CREATE OR REPLACE FUNCTION public.get_client_portal_shipment_detail(_fiscal_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path = public
AS $$
DECLARE
  _fd public.fiscal_documents;
  _can_financial boolean;
  _result jsonb;
BEGIN
  SELECT * INTO _fd FROM public.fiscal_documents WHERE id = _fiscal_document_id;
  IF _fd.id IS NULL THEN
    RAISE EXCEPTION 'Documento não encontrado';
  END IF;

  IF NOT public.user_has_client_access(_fd.client_id) THEN
    -- also allow if user has access to any client whose tax_id matches remitter/recipient
    IF NOT EXISTS (
      SELECT 1 FROM public.client_portal_access cpa
      JOIN public.clients c ON c.id = cpa.client_id
      WHERE cpa.user_id = auth.uid()
        AND cpa.active = true
        AND cpa.tenant_id = _fd.tenant_id
        AND c.tax_id IS NOT NULL
        AND (c.tax_id = _fd.remitter_cnpj OR c.tax_id = _fd.recipient_cnpj)
    ) THEN
      RAISE EXCEPTION 'Acesso negado a este documento';
    END IF;
  END IF;

  SELECT bool_or(can_view_financial) INTO _can_financial
  FROM public.client_portal_access
  WHERE user_id = auth.uid() AND tenant_id = _fd.tenant_id AND active = true;

  SELECT jsonb_build_object(
    'document', jsonb_build_object(
      'id', _fd.id,
      'invoice_number', _fd.invoice_number,
      'access_key', _fd.access_key,
      'document_type', _fd.document_type,
      'issue_date', _fd.issue_date,
      'status', _fd.status,
      'client_load_number', _fd.client_load_number,
      'reference_number', _fd.reference_number,
      'remitter', _fd.remitter,
      'remitter_cnpj', _fd.remitter_cnpj,
      'recipient', _fd.recipient,
      'recipient_cnpj', _fd.recipient_cnpj,
      'recipient_city', _fd.recipient_city,
      'recipient_state', _fd.recipient_state,
      'recipient_neighborhood', _fd.recipient_neighborhood,
      'product_summary', _fd.product_summary,
      'pallet_count', _fd.pallet_count,
      'weight_kg', _fd.weight_kg,
      'value', CASE WHEN _can_financial THEN _fd.value END,
      'freight_value', CASE WHEN _can_financial THEN _fd.freight_value END,
      'delivery_meta', _fd.delivery_meta
    ),
    'load', (SELECT row_to_jsonb(l) FROM public.loads l WHERE l.id = _fd.load_id),
    'trip', (SELECT row_to_jsonb(dt) FROM public.dispatch_trips dt
             WHERE dt.id = (SELECT trip_id FROM public.loads WHERE id = _fd.load_id)),
    'stop', (SELECT row_to_jsonb(ds) FROM public.dispatch_stops ds
             JOIN public.dispatch_stop_documents dsd ON dsd.dispatch_stop_id = ds.id
             WHERE dsd.fiscal_document_id = _fd.id LIMIT 1),
    'events', COALESCE((
      SELECT jsonb_agg(row_to_jsonb(e) ORDER BY e.created_at)
      FROM public.dispatch_events e
      WHERE e.dispatch_trip_id = (SELECT trip_id FROM public.loads WHERE id = _fd.load_id)
    ), '[]'::jsonb),
    'occurrences', COALESCE((
      SELECT jsonb_agg(row_to_jsonb(oe) ORDER BY oe.created_at DESC)
      FROM public.operational_events oe
      WHERE oe.tenant_id = _fd.tenant_id
        AND oe.load_id = _fd.load_id
        AND oe.visible_to_client = true
    ), '[]'::jsonb),
    'proofs', COALESCE((
      SELECT jsonb_agg(row_to_jsonb(p) ORDER BY p.created_at DESC)
      FROM public.proof_of_delivery p
      WHERE p.fiscal_document_id = _fd.id
    ), '[]'::jsonb)
  ) INTO _result;

  RETURN _result;
END;
$$;

-- =========================================
-- get_client_document_download_url
-- Validates access and returns bucket+path for signed URL generation
-- =========================================
CREATE OR REPLACE FUNCTION public.get_client_document_download_url(_proof_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public SET search_path = public
AS $$
DECLARE
  _proof public.proof_of_delivery;
  _fd_client uuid;
  _can_download boolean;
BEGIN
  SELECT * INTO _proof FROM public.proof_of_delivery WHERE id = _proof_id;
  IF _proof.id IS NULL OR _proof.storage_path IS NULL THEN
    RAISE EXCEPTION 'Comprovante não encontrado';
  END IF;

  SELECT client_id INTO _fd_client FROM public.fiscal_documents WHERE id = _proof.fiscal_document_id;

  IF NOT public.user_has_client_access(_fd_client) THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  SELECT bool_or(can_download_documents) INTO _can_download
  FROM public.client_portal_access
  WHERE user_id = auth.uid() AND tenant_id = _proof.tenant_id AND active = true;

  IF NOT COALESCE(_can_download, false) THEN
    RAISE EXCEPTION 'Usuário sem permissão para baixar documentos';
  END IF;

  RETURN jsonb_build_object('bucket', _proof.storage_bucket, 'path', _proof.storage_path);
END;
$$;
