-- Reassert the authenticated portal RPC surface after the security cutover.
-- Every function below is SECURITY DEFINER and validates auth.uid() against
-- client_portal_access before returning tenant data.

REVOKE ALL ON FUNCTION public.get_client_portal_summary_v2(uuid, uuid, date, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_portal_summary_v2(uuid, uuid, date, date)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_client_documents_v2(uuid, uuid, text, text, date, date, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_client_documents_v2(uuid, uuid, text, text, date, date, integer, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_client_pods_v2(uuid, uuid, text, timestamptz, timestamptz, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_client_pods_v2(uuid, uuid, text, timestamptz, timestamptz, integer, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_client_pickups_v2(uuid, uuid, text, timestamptz, timestamptz, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_client_pickups_v2(uuid, uuid, text, timestamptz, timestamptz, integer, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.list_client_occurrences_v2(uuid, uuid, text, boolean, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_client_occurrences_v2(uuid, uuid, text, boolean, integer, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.search_client_portal_shipments_v2(uuid, uuid, text, text[], date, date, text, text, boolean, boolean, integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_client_portal_shipments_v2(uuid, uuid, text, text[], date, date, text, text, boolean, boolean, integer, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_client_portal_reports_summary_v2(uuid, uuid, date, date)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_portal_reports_summary_v2(uuid, uuid, date, date)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_client_portal_alerts_v2(uuid, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_portal_alerts_v2(uuid, uuid, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_client_portal_upcoming_deliveries_v2(uuid, uuid, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_portal_upcoming_deliveries_v2(uuid, uuid, integer)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_client_portal_tracking_v2(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_portal_tracking_v2(uuid, uuid)
  TO authenticated, service_role;

-- The Edge Function resolves Storage metadata through this guarded RPC so it
-- never reads a proof with service_role before portal authorization succeeds.
REVOKE ALL ON FUNCTION public.get_client_pod_metadata(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_client_pod_metadata(uuid, uuid)
  TO authenticated, service_role;

-- Audit writes remain backend-only. The function validates the actor against
-- the same download scope used by the portal before accepting the event.
CREATE OR REPLACE FUNCTION public.log_pod_access_v2(
  _tenant_id uuid,
  _pod_id uuid,
  _fiscal_document_id uuid,
  _actor_user_id uuid,
  _success boolean,
  _source text DEFAULT 'portal_pod_download'::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF _actor_user_id IS NULL THEN
    RAISE EXCEPTION 'actor_required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.proof_of_delivery pod
    JOIN public.fiscal_documents document
      ON document.id = pod.fiscal_document_id
     AND document.tenant_id = pod.tenant_id
    JOIN public.client_portal_access access
      ON access.tenant_id = document.tenant_id
     AND access.user_id = _actor_user_id
     AND access.active
     AND access.can_download_documents
    LEFT JOIN public.clients client ON client.id = access.client_id
    WHERE pod.id = _pod_id
      AND pod.tenant_id = _tenant_id
      AND pod.fiscal_document_id = _fiscal_document_id
      AND (
        access.client_id = document.client_id
        OR (
          access.access_type IN ('remitter', 'full', 'financial', 'documents_only')
          AND client.tax_id IS NOT NULL
          AND client.tax_id = document.remitter_cnpj
        )
        OR (
          access.access_type IN ('recipient', 'full', 'financial', 'documents_only')
          AND client.tax_id IS NOT NULL
          AND client.tax_id = document.recipient_cnpj
        )
        OR (
          access.access_type = 'full'
          AND client.tax_id IS NOT NULL
          AND client.tax_id IN (document.remitter_cnpj, document.recipient_cnpj)
        )
      )
  ) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  INSERT INTO public.entity_audit_log(
    tenant_id,
    entity_type,
    entity_id,
    action,
    old_data,
    new_data,
    actor_user_id,
    actor_role,
    source
  ) VALUES (
    _tenant_id,
    'proof_of_delivery',
    _pod_id,
    'pod_download',
    NULL,
    jsonb_build_object(
      'fiscal_document_id', _fiscal_document_id,
      'success', _success
    ),
    _actor_user_id,
    'portal',
    COALESCE(NULLIF(_source, ''), 'portal_pod_download')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.log_pod_access(uuid, uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_pod_access_v2(uuid, uuid, uuid, uuid, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_pod_access_v2(uuid, uuid, uuid, uuid, boolean, text) TO service_role;
