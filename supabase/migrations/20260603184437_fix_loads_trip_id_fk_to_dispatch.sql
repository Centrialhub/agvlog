-- loads.trip_id originalmente apontava para a tabela legada `trips` (telemetria).
-- O fluxo de despacho operacional usa `dispatch_trips`, então a FK precisa apontar para lá.
ALTER TABLE public.loads
  DROP CONSTRAINT IF EXISTS loads_trip_id_fkey;

ALTER TABLE public.loads
  ADD CONSTRAINT loads_trip_id_fkey
  FOREIGN KEY (trip_id) REFERENCES public.dispatch_trips(id)
  ON DELETE SET NULL;
