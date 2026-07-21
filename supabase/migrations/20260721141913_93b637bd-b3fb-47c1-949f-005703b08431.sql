
-- Auto-vincula motorista à carga a partir do veículo, valida tenant e permite backfill.

CREATE OR REPLACE FUNCTION public.loads_autofill_driver_from_vehicle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver uuid;
  v_driver_tenant uuid;
BEGIN
  -- Se driver informado, valida que pertence ao mesmo tenant da carga
  IF NEW.driver_id IS NOT NULL THEN
    SELECT tenant_id INTO v_driver_tenant FROM public.drivers WHERE id = NEW.driver_id;
    IF v_driver_tenant IS NULL THEN
      RAISE EXCEPTION 'Motorista % não existe', NEW.driver_id;
    END IF;
    IF v_driver_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'Motorista % não pertence ao tenant da carga', NEW.driver_id;
    END IF;
  END IF;

  -- Se não veio driver, mas veio veículo, tenta derivar do veículo
  IF NEW.driver_id IS NULL AND NEW.vehicle_id IS NOT NULL THEN
    SELECT v.current_driver_id INTO v_driver
      FROM public.vehicles v
     WHERE v.id = NEW.vehicle_id
       AND v.tenant_id = NEW.tenant_id;
    IF v_driver IS NOT NULL THEN
      -- só atribui se motorista está ativo
      IF EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v_driver AND d.active = true) THEN
        NEW.driver_id := v_driver;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loads_autofill_driver ON public.loads;
CREATE TRIGGER trg_loads_autofill_driver
BEFORE INSERT OR UPDATE OF vehicle_id, driver_id ON public.loads
FOR EACH ROW EXECUTE FUNCTION public.loads_autofill_driver_from_vehicle();

-- Backfill: cargas existentes sem motorista mas com veículo vinculado
UPDATE public.loads l
   SET driver_id = v.current_driver_id
  FROM public.vehicles v
 WHERE l.vehicle_id = v.id
   AND l.tenant_id = v.tenant_id
   AND l.driver_id IS NULL
   AND v.current_driver_id IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = v.current_driver_id AND d.active = true);
