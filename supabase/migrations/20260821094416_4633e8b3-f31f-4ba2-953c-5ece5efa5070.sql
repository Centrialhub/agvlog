-- Geofence Processor
CREATE OR REPLACE FUNCTION public.process_geofence_alerts(
  _tenant_id uuid,
  _vehicle_id uuid,
  _lat double precision,
  _lng double precision,
  _captured_at timestamptz
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _point extensions.geometry;
  _fence RECORD;
  _is_inside boolean;
  _was_inside boolean;
BEGIN
  _point := extensions.ST_SetSRID(extensions.ST_Point(_lng, _lat), 4326);

  FOR _fence IN 
    SELECT * FROM public.geofences 
    WHERE tenant_id = _tenant_id AND enabled = true 
  LOOP
    _is_inside := extensions.ST_Within(_point, _fence.geometry);
    
    -- Check previous state from geofence_events
    SELECT (event_type = 'entry') INTO _was_inside
    FROM public.geofence_events
    WHERE tenant_id = _tenant_id 
      AND vehicle_id = _vehicle_id 
      AND geofence_id = _fence.id
    ORDER BY event_at DESC
    LIMIT 1;
    
    _was_inside := COALESCE(_was_inside, false);

    IF _is_inside AND NOT _was_inside THEN
      -- Entry Event
      INSERT INTO public.geofence_events (tenant_id, geofence_id, vehicle_id, event_type, event_at, lat, lng)
      VALUES (_tenant_id, _fence.id, _vehicle_id, 'entry', _captured_at, _lat, _lng);
      
      INSERT INTO public.events (tenant_id, vehicle_id, event_type, event_at, severity, payload)
      VALUES (_tenant_id, _vehicle_id, 'geofence_entry', _captured_at, 'info', 
              jsonb_build_object('geofence_id', _fence.id, 'name', _fence.name));
              
    ELSIF NOT _is_inside AND _was_inside THEN
      -- Exit Event
      INSERT INTO public.geofence_events (tenant_id, geofence_id, vehicle_id, event_type, event_at, lat, lng)
      VALUES (_tenant_id, _fence.id, _vehicle_id, 'exit', _captured_at, _lat, _lng);
      
      INSERT INTO public.events (tenant_id, vehicle_id, event_type, event_at, severity, payload)
      VALUES (_tenant_id, _vehicle_id, 'geofence_exit', _captured_at, 'info', 
              jsonb_build_object('geofence_id', _fence.id, 'name', _fence.name));
    END IF;
  END LOOP;
END;
$$;