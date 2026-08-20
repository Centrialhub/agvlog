
CREATE OR REPLACE FUNCTION public.get_client_portal_reports_summary(
  _tenant_id uuid,
  _start_date date DEFAULT NULL,
  _end_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
  SET search_path = public
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_start date := COALESCE(_start_date, (now() - interval '90 days')::date);
  v_end   date := COALESCE(_end_date, now()::date);
BEGIN
  WITH allowed AS (
    SELECT unnest(public._portal_user_client_ids(_tenant_id)) AS client_id
  ),
  fd AS (
    SELECT f.*
    FROM public.fiscal_documents f
    WHERE f.tenant_id = _tenant_id
      AND f.client_id IN (SELECT client_id FROM allowed)
      AND COALESCE(f.issue_date, f.created_at::date) BETWEEN v_start AND v_end
  ),
  by_status AS (
    SELECT COALESCE(status,'sem_status') AS status, count(*)::int AS total
    FROM fd GROUP BY 1
  ),
  delayed AS (
    SELECT count(*)::int AS total
    FROM fd f
    WHERE EXISTS (
      SELECT 1 FROM public.dispatch_stop_documents dsd
      JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
      WHERE dsd.fiscal_document_id = f.id
        AND ds.planned_arrival_at IS NOT NULL
        AND (ds.actual_arrival_at IS NULL AND ds.planned_arrival_at < now()
             OR ds.actual_arrival_at > ds.planned_arrival_at + interval '30 minutes')
    )
  ),
  pending_pods AS (
    SELECT count(*)::int AS total
    FROM fd f
    WHERE f.status IN ('delivered','completed')
      AND NOT EXISTS (SELECT 1 FROM public.proof_of_delivery pod WHERE pod.fiscal_document_id = f.id)
  ),
  occ_by_type AS (
    SELECT COALESCE(event_type,'outros') AS event_type, count(*)::int AS total
    FROM public.operational_events
    WHERE tenant_id = _tenant_id
      AND client_id IN (SELECT client_id FROM allowed)
      AND (visible_to_client = true OR client_opened = true)
      AND created_at::date BETWEEN v_start AND v_end
    GROUP BY 1
    ORDER BY total DESC
    LIMIT 20
  ),
  pickups_by AS (
    SELECT COALESCE(status,'sem_status') AS status, count(*)::int AS total
    FROM public.pickup_orders
    WHERE tenant_id = _tenant_id
      AND remitter_client_id IN (SELECT client_id FROM allowed)
      AND created_at::date BETWEEN v_start AND v_end
    GROUP BY 1
  ),
  top_cities AS (
    SELECT COALESCE(recipient_city,'—') AS city,
           COALESCE(recipient_state,'') AS state,
           count(*)::int AS total
    FROM fd GROUP BY 1,2 ORDER BY total DESC LIMIT 15
  ),
  avg_time AS (
    SELECT COALESCE(round(avg(EXTRACT(EPOCH FROM (ds.actual_arrival_at - COALESCE(dt.actual_start_at, ds.planned_arrival_at))) / 86400.0)::numeric, 2), 0) AS avg_days
    FROM fd f
    JOIN public.dispatch_stop_documents dsd ON dsd.fiscal_document_id = f.id
    JOIN public.dispatch_stops ds ON ds.id = dsd.dispatch_stop_id
    LEFT JOIN public.dispatch_trips dt ON dt.id = ds.dispatch_trip_id
    WHERE ds.actual_arrival_at IS NOT NULL
  )
  SELECT jsonb_build_object(
    'period_start', v_start,
    'period_end', v_end,
    'deliveries_total', (SELECT count(*)::int FROM fd),
    'deliveries_by_status',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'total', total)) FROM by_status), '[]'::jsonb),
    'deliveries_delayed', (SELECT total FROM delayed),
    'pending_pods',       (SELECT total FROM pending_pods),
    'occurrences_by_type',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('event_type', event_type, 'total', total)) FROM occ_by_type), '[]'::jsonb),
    'pickups_by_status',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('status', status, 'total', total)) FROM pickups_by), '[]'::jsonb),
    'top_cities',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('city', city, 'state', state, 'total', total)) FROM top_cities), '[]'::jsonb),
    'avg_delivery_days',  (SELECT avg_days FROM avg_time)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_client_portal_reports_summary(uuid, date, date) TO authenticated, service_role;
