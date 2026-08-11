CREATE OR REPLACE FUNCTION public.check_load_dispatch_duplicity()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM public.dispatch_trip_loads dtl
    JOIN public.dispatch_trips dt ON dt.id = dtl.dispatch_trip_id
    WHERE dtl.load_id = NEW.load_id
      AND dt.status NOT IN ('cancelled', 'completed')
      AND dtl.dispatch_trip_id <> NEW.dispatch_trip_id
  ) THEN
    RAISE EXCEPTION 'Carga % já está vinculada a uma viagem ativa', NEW.load_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_load_dispatch_duplicity ON public.dispatch_trip_loads;
CREATE TRIGGER trg_check_load_dispatch_duplicity
BEFORE INSERT ON public.dispatch_trip_loads
FOR EACH ROW EXECUTE FUNCTION public.check_load_dispatch_duplicity();