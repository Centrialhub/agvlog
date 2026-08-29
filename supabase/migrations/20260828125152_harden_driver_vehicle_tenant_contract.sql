-- Keep the bidirectional driver/vehicle assignment inside one tenant.
-- Production migration version: 20260828125152.
CREATE UNIQUE INDEX IF NOT EXISTS drivers_tenant_id_id_uidx
  ON public.drivers (tenant_id, id);

CREATE UNIQUE INDEX IF NOT EXISTS vehicles_tenant_id_id_uidx
  ON public.vehicles (tenant_id, id);

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_current_vehicle_id_fkey,
  ADD CONSTRAINT drivers_tenant_current_vehicle_fkey
    FOREIGN KEY (tenant_id, current_vehicle_id)
    REFERENCES public.vehicles (tenant_id, id)
    ON DELETE SET NULL (current_vehicle_id)
    NOT VALID;

ALTER TABLE public.vehicles
  DROP CONSTRAINT IF EXISTS vehicles_current_driver_id_fkey,
  ADD CONSTRAINT vehicles_tenant_current_driver_fkey
    FOREIGN KEY (tenant_id, current_driver_id)
    REFERENCES public.drivers (tenant_id, id)
    ON DELETE SET NULL (current_driver_id)
    NOT VALID;

ALTER TABLE public.drivers
  VALIDATE CONSTRAINT drivers_tenant_current_vehicle_fkey;

ALTER TABLE public.vehicles
  VALIDATE CONSTRAINT vehicles_tenant_current_driver_fkey;

CREATE OR REPLACE FUNCTION public.sync_driver_vehicle_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
BEGIN
  -- Avoid recursion: only act on the original update fired by the user.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'vehicles' THEN
    IF OLD.current_driver_id IS NOT NULL
       AND OLD.current_driver_id IS DISTINCT FROM NEW.current_driver_id THEN
      UPDATE public.drivers
         SET current_vehicle_id = NULL,
             updated_at = now()
       WHERE tenant_id = OLD.tenant_id
         AND id = OLD.current_driver_id
         AND current_vehicle_id = NEW.id;
    END IF;

    IF NEW.current_driver_id IS NOT NULL THEN
      UPDATE public.vehicles
         SET current_driver_id = NULL,
             updated_at = now()
       WHERE tenant_id = NEW.tenant_id
         AND current_driver_id = NEW.current_driver_id
         AND id <> NEW.id;

      UPDATE public.drivers
         SET current_vehicle_id = NEW.id,
             updated_at = now()
       WHERE tenant_id = NEW.tenant_id
         AND id = NEW.current_driver_id
         AND current_vehicle_id IS DISTINCT FROM NEW.id;
    END IF;
  ELSIF TG_TABLE_NAME = 'drivers' THEN
    IF OLD.current_vehicle_id IS NOT NULL
       AND OLD.current_vehicle_id IS DISTINCT FROM NEW.current_vehicle_id THEN
      UPDATE public.vehicles
         SET current_driver_id = NULL,
             updated_at = now()
       WHERE tenant_id = OLD.tenant_id
         AND id = OLD.current_vehicle_id
         AND current_driver_id = NEW.id;
    END IF;

    IF NEW.current_vehicle_id IS NOT NULL THEN
      UPDATE public.drivers
         SET current_vehicle_id = NULL,
             updated_at = now()
       WHERE tenant_id = NEW.tenant_id
         AND current_vehicle_id = NEW.current_vehicle_id
         AND id <> NEW.id;

      UPDATE public.vehicles
         SET current_driver_id = NEW.id,
             updated_at = now()
       WHERE tenant_id = NEW.tenant_id
         AND id = NEW.current_vehicle_id
         AND current_driver_id IS DISTINCT FROM NEW.id;
    END IF;
  ELSE
    RAISE EXCEPTION 'unsupported assignment trigger source: %', TG_TABLE_NAME;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.sync_driver_vehicle_assignment() IS
  'Synchronizes driver/vehicle assignments while preserving tenant isolation.';
