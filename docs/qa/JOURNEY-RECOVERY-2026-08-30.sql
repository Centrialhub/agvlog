-- Recovery rehearsal script, not executed in production.
-- Restore the previous frontend first. Run as a reviewed corrective migration.
-- Preflight must confirm the two indexes/helpers were created only by this batch.
set local lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public._assert_driver_owns_trip(_trip_id uuid)
 RETURNS TABLE(driver_id uuid, tenant_id uuid, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_driver uuid;
  v_tenant uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  select t.driver_id, t.tenant_id, t.status
    into v_driver, v_tenant, v_status
  from public.dispatch_trips t
  where t.id = _trip_id;

  if not found then
    raise exception 'trip_not_found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.drivers d
    where d.id = v_driver
      and d.user_id = v_uid
      and d.tenant_id = v_tenant
      and d.active = true
  ) then
    raise exception 'access_denied' using errcode = '42501';
  end if;

  if v_status not in (
    'planned',
    'loading',
    'dispatched',
    'in_progress',
    'in_transit',
    'completed'
  ) then
    raise exception 'trip_not_active' using errcode = '22023';
  end if;

  driver_id := v_driver;
  tenant_id := v_tenant;
  status := v_status;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION public.driver_create_event(_trip_id uuid, _event_type text, _payload jsonb DEFAULT '{}'::jsonb, _stop_id uuid DEFAULT NULL::uuid, _notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM public._assert_driver_owns_trip(_trip_id);
  IF _event_type IS NULL OR length(_event_type) = 0 THEN RAISE EXCEPTION 'event_type_required'; END IF;
  IF _stop_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.dispatch_stops WHERE id=_stop_id AND dispatch_trip_id=_trip_id
  ) THEN RAISE EXCEPTION 'stop_not_in_trip'; END IF;
  INSERT INTO public.dispatch_events(tenant_id, dispatch_trip_id, dispatch_stop_id, event_type, payload, notes, created_by)
  VALUES (v_tenant, _trip_id, _stop_id, _event_type, COALESCE(_payload,'{}'::jsonb), _notes, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.driver_save_checklist(_trip_id uuid, _kind text, _payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant uuid; v_type text; v_id uuid;
BEGIN
  IF _kind NOT IN ('pre','post') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  v_type := CASE _kind WHEN 'pre' THEN 'checklist_pre' ELSE 'checklist_post' END;
  SELECT tenant_id INTO v_tenant FROM public._assert_driver_owns_trip(_trip_id);
  INSERT INTO public.dispatch_events(tenant_id, dispatch_trip_id, event_type, payload, created_by)
  VALUES (v_tenant, _trip_id, v_type, COALESCE(_payload,'{}'::jsonb), auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

revoke all on function public._assert_driver_owns_trip(uuid) from public, anon, authenticated, service_role;
grant execute on function public._assert_driver_owns_trip(uuid) to service_role;
revoke all on function public.driver_create_event(uuid,text,jsonb,uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.driver_create_event(uuid,text,jsonb,uuid,text) to authenticated, service_role;
revoke all on function public.driver_save_checklist(uuid,text,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.driver_save_checklist(uuid,text,jsonb) to authenticated, service_role;
drop function public.driver_get_journey_context(uuid);
drop function public._lock_driver_journey_trip(uuid);
drop index public.dispatch_events_journey_timeline_idx;
drop index public.dispatch_events_personal_journey_idx;
