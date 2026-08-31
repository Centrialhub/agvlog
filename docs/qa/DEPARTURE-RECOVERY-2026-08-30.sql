-- Emergency recovery: restores legacy behavior and its known weaknesses. Not for routine use.
CREATE OR REPLACE FUNCTION public.driver_register_departure(_stop_id uuid, _notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_trip uuid; v_tenant uuid; v_event uuid;
BEGIN
  SELECT dispatch_trip_id, tenant_id INTO v_trip, v_tenant
  FROM public.dispatch_stops WHERE id = _stop_id;
  IF v_trip IS NULL THEN RAISE EXCEPTION 'stop_not_found'; END IF;
  PERFORM public._assert_driver_owns_trip(v_trip);

  UPDATE public.dispatch_stops
    SET actual_departure_at = COALESCE(actual_departure_at, now()),
        updated_at = now()
    WHERE id = _stop_id;

  INSERT INTO public.dispatch_events(tenant_id, dispatch_trip_id, dispatch_stop_id, event_type, payload, notes, created_by)
  VALUES (v_tenant, v_trip, _stop_id, 'departure',
          jsonb_build_object('source','driver_app'), _notes, auth.uid())
  RETURNING id INTO v_event;

  RETURN v_event;
END; $function$;

revoke all on function public.driver_register_departure(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.driver_register_departure(uuid,text) to authenticated,service_role;
