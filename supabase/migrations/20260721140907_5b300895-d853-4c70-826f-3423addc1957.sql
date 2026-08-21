CREATE OR REPLACE FUNCTION public._driver_load_ids()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT DISTINCT dtl.load_id FROM public.dispatch_trip_loads dtl
  JOIN public.dispatch_trips dt ON dt.id = dtl.dispatch_trip_id
  JOIN public.drivers d ON d.id = dt.driver_id
  WHERE d.user_id = auth.uid() AND d.active = true
  UNION
  SELECT l.id FROM public.loads l
  JOIN public.dispatch_trips dt ON dt.id = l.trip_id
  JOIN public.drivers d ON d.id = dt.driver_id
  WHERE d.user_id = auth.uid() AND d.active = true
  UNION
  SELECT l.id FROM public.loads l
  JOIN public.drivers d ON d.id = l.driver_id
  WHERE d.user_id = auth.uid() AND d.active = true;
$function$;