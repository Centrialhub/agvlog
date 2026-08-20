-- Add cross-reference columns for driver <-> vehicle assignment
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS current_driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS current_vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL;

-- Create a function to keep both sides in sync
CREATE OR REPLACE FUNCTION public.sync_driver_vehicle_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
  SET search_path = public
SET search_path = 'public'
AS $$
BEGIN
  -- When vehicle.current_driver_id changes
  IF TG_TABLE_NAME = 'vehicles' THEN
    -- Clear old driver's current_vehicle_id
    IF OLD.current_driver_id IS NOT NULL AND OLD.current_driver_id IS DISTINCT FROM NEW.current_driver_id THEN
      UPDATE public.drivers SET current_vehicle_id = NULL, updated_at = now()
        WHERE id = OLD.current_driver_id AND current_vehicle_id = NEW.id;
    END IF;
    -- Set new driver's current_vehicle_id
    IF NEW.current_driver_id IS NOT NULL THEN
      -- Clear any other vehicle this driver was assigned to
      UPDATE public.vehicles SET current_driver_id = NULL, updated_at = now()
        WHERE current_driver_id = NEW.current_driver_id AND id != NEW.id;
      UPDATE public.drivers SET current_vehicle_id = NEW.id, updated_at = now()
        WHERE id = NEW.current_driver_id;
    END IF;
  END IF;

  -- When driver.current_vehicle_id changes
  IF TG_TABLE_NAME = 'drivers' THEN
    IF OLD.current_vehicle_id IS NOT NULL AND OLD.current_vehicle_id IS DISTINCT FROM NEW.current_vehicle_id THEN
      UPDATE public.vehicles SET current_driver_id = NULL, updated_at = now()
        WHERE id = OLD.current_vehicle_id AND current_driver_id = NEW.id;
    END IF;
    IF NEW.current_vehicle_id IS NOT NULL THEN
      UPDATE public.drivers SET current_vehicle_id = NULL, updated_at = now()
        WHERE current_vehicle_id = NEW.current_vehicle_id AND id != NEW.id;
      UPDATE public.vehicles SET current_driver_id = NEW.id, updated_at = now()
        WHERE id = NEW.current_vehicle_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create triggers
CREATE TRIGGER sync_vehicle_driver_assignment
  AFTER UPDATE OF current_driver_id ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_driver_vehicle_assignment();

CREATE TRIGGER sync_driver_vehicle_assignment
  AFTER UPDATE OF current_vehicle_id ON public.drivers
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_driver_vehicle_assignment();
-- linter:allow-no-tenant legacy-migration 2026-12-31
