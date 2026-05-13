CREATE OR REPLACE FUNCTION public.sync_driver_vehicle_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Avoid recursion: only act on the original update fired by the user
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'vehicles' THEN
    IF OLD.current_driver_id IS NOT NULL AND OLD.current_driver_id IS DISTINCT FROM NEW.current_driver_id THEN
      UPDATE public.drivers SET current_vehicle_id = NULL, updated_at = now()
        WHERE id = OLD.current_driver_id AND current_vehicle_id = NEW.id;
    END IF;
    IF NEW.current_driver_id IS NOT NULL THEN
      UPDATE public.vehicles SET current_driver_id = NULL, updated_at = now()
        WHERE current_driver_id = NEW.current_driver_id AND id != NEW.id;
      UPDATE public.drivers SET current_vehicle_id = NEW.id, updated_at = now()
        WHERE id = NEW.current_driver_id AND COALESCE(current_vehicle_id,'00000000-0000-0000-0000-000000000000'::uuid) IS DISTINCT FROM NEW.id;
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'drivers' THEN
    IF OLD.current_vehicle_id IS NOT NULL AND OLD.current_vehicle_id IS DISTINCT FROM NEW.current_vehicle_id THEN
      UPDATE public.vehicles SET current_driver_id = NULL, updated_at = now()
        WHERE id = OLD.current_vehicle_id AND current_driver_id = NEW.id;
    END IF;
    IF NEW.current_vehicle_id IS NOT NULL THEN
      UPDATE public.drivers SET current_vehicle_id = NULL, updated_at = now()
        WHERE current_vehicle_id = NEW.current_vehicle_id AND id != NEW.id;
      UPDATE public.vehicles SET current_driver_id = NEW.id, updated_at = now()
        WHERE id = NEW.current_vehicle_id AND COALESCE(current_driver_id,'00000000-0000-0000-0000-000000000000'::uuid) IS DISTINCT FROM NEW.id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;