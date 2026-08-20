ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS plate_raw text;

CREATE OR REPLACE FUNCTION public.normalize_vehicle_plate(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT UPPER(regexp_replace(COALESCE(p,''), '[^A-Za-z0-9]', '', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.trg_vehicles_normalize_plate()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.plate IS NOT NULL THEN
    IF NEW.plate_raw IS NULL OR (TG_OP='UPDATE' AND OLD.plate IS DISTINCT FROM NEW.plate) THEN
      NEW.plate_raw := NEW.plate;
    END IF;
    NEW.plate := public.normalize_vehicle_plate(NEW.plate);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_vehicles_normalize_plate ON public.vehicles;
CREATE TRIGGER trg_vehicles_normalize_plate
BEFORE INSERT OR UPDATE OF plate ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.trg_vehicles_normalize_plate();

DO $$
DECLARE
  old_id uuid := '58d37ad1-311f-4068-87ea-49511b60cc9a';
  new_id uuid := '9ac6701a-0df2-4d10-89bd-1ff6cc9dfffc';
BEGIN
  IF EXISTS (SELECT 1 FROM public.vehicles WHERE id=old_id)
     AND EXISTS (SELECT 1 FROM public.vehicles WHERE id=new_id) THEN
    DELETE FROM public.positions_last           WHERE vehicle_id=old_id;
    DELETE FROM public.vehicle_capabilities     WHERE vehicle_id=old_id;
    DELETE FROM public.vehicle_processing_queue WHERE vehicle_id=old_id;
    DELETE FROM public.vehicles_state           WHERE vehicle_id=old_id;
    DELETE FROM public.geofence_states          WHERE vehicle_id=old_id;

    DELETE FROM public.metrics_daily m
     WHERE m.vehicle_id = old_id
       AND EXISTS (SELECT 1 FROM public.metrics_daily m2
                    WHERE m2.vehicle_id=new_id AND m2.tenant_id=m.tenant_id AND m2.day=m.day);

    UPDATE public.alert_instances            SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.dispatch_trips             SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.driver_route_monitors      SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.driver_settlements         SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.drivers                    SET current_vehicle_id=new_id WHERE current_vehicle_id=old_id;
    UPDATE public.events                     SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.fuel_events                SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.fuel_readings              SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.geofence_events            SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.loads                      SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.merchandise_shortage_cases SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.metrics_daily              SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.operational_events         SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.pallet_return_protocols    SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.payables                   SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.pickup_orders              SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.positions_raw              SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.route_runs                 SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.telemetry_observations     SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.trip_stops                 SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.trips                      SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.vehicle_driver_assignments SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.vehicle_events             SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.vehicle_fueling            SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.vehicle_maintenance        SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.vehicle_odometer           SET vehicle_id=new_id WHERE vehicle_id=old_id;
    UPDATE public.vehicle_tracker_links      SET vehicle_id=new_id WHERE vehicle_id=old_id;

    UPDATE public.vehicles
       SET active=false,
           plate = 'MERGED-' || substr(old_id::text,1,8)
     WHERE id=old_id;
  END IF;
END $$;

UPDATE public.vehicles
   SET plate = public.normalize_vehicle_plate(plate)
 WHERE plate IS NOT NULL
   AND plate <> public.normalize_vehicle_plate(plate)
   AND plate NOT LIKE 'MERGED-%';

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_plate_norm
  ON public.vehicles (tenant_id, plate)
  WHERE active=true AND plate IS NOT NULL;

UPDATE public.freight_tables
   SET blocked=true,
       notes = COALESCE(notes,'') || ' [auto-blocked: registro sem contexto (sem cliente/origem/destino/veículo)]'
 WHERE blocked=false
   AND client_id IS NULL
   AND origin_state IS NULL
   AND destination_state IS NULL
   AND origin_municipality IS NULL
   AND destination_municipality IS NULL
   AND vehicle_type IS NULL;

CREATE OR REPLACE FUNCTION public.trg_freight_tables_require_context()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(NEW.blocked,false)=false THEN
    IF NEW.client_id IS NULL
       AND COALESCE(NEW.origin_state,'')=''
       AND COALESCE(NEW.destination_state,'')=''
       AND COALESCE(NEW.origin_municipality,'')=''
       AND COALESCE(NEW.destination_municipality,'')=''
       AND COALESCE(NEW.vehicle_type,'')='' THEN
      RAISE EXCEPTION 'Tarifa de frete precisa de pelo menos um contexto: cliente, origem, destino ou tipo de veículo.'
        USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_freight_tables_require_context ON public.freight_tables;
CREATE TRIGGER trg_freight_tables_require_context
BEFORE INSERT OR UPDATE ON public.freight_tables
FOR EACH ROW EXECUTE FUNCTION public.trg_freight_tables_require_context();

-- Índice único: usa sentinela de data para lidar com nulos (operadores puramente imutáveis)
CREATE UNIQUE INDEX IF NOT EXISTS uq_freight_tables_context
  ON public.freight_tables (
    tenant_id,
    COALESCE(client_id::text,''),
    COALESCE(origin_state,''),
    COALESCE(destination_state,''),
    COALESCE(origin_municipality,''),
    COALESCE(destination_municipality,''),
    COALESCE(vehicle_type,''),
    (COALESCE(valid_from, DATE '1900-01-01')),
    (COALESCE(valid_until, DATE '9999-12-31'))
  )
  WHERE blocked=false;