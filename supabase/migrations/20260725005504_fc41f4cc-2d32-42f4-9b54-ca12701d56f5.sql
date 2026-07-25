
-- 1) Realtime for occurrence messages (chat live updates)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'client_occurrence_messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.client_occurrence_messages';
  END IF;
END$$;
ALTER TABLE public.client_occurrence_messages REPLICA IDENTITY FULL;

-- 2) _v2 RPCs with mandatory _client_id + strict access assertion
CREATE OR REPLACE FUNCTION public.get_client_portal_alerts_v2(_tenant_id uuid, _client_id uuid, _limit integer DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _client_id IS NULL THEN
    RAISE EXCEPTION 'client_id is required';
  END IF;
  PERFORM public._portal_assert_client_access(_tenant_id, _client_id);
  RETURN public.get_client_portal_alerts(_tenant_id, _client_id, _limit);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_client_portal_upcoming_deliveries_v2(_tenant_id uuid, _client_id uuid, _limit integer DEFAULT 8)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _client_id IS NULL THEN
    RAISE EXCEPTION 'client_id is required';
  END IF;
  PERFORM public._portal_assert_client_access(_tenant_id, _client_id);
  RETURN public.get_client_portal_upcoming_deliveries(_tenant_id, _client_id, _limit);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_client_portal_tracking_v2(_tenant_id uuid, _client_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF _client_id IS NULL THEN
    RAISE EXCEPTION 'client_id is required';
  END IF;
  PERFORM public._portal_assert_client_access(_tenant_id, _client_id);
  RETURN public.get_client_portal_tracking(_tenant_id, _client_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_client_portal_alerts_v2(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_portal_upcoming_deliveries_v2(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_client_portal_tracking_v2(uuid, uuid) TO authenticated;
