
ALTER TABLE public.dispatch_stops REPLICA IDENTITY FULL;
ALTER TABLE public.dispatch_events REPLICA IDENTITY FULL;
ALTER TABLE public.driver_expenses REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_stops;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_events;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_expenses;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

ALTER POLICY "tenant members insert driver direct messages"
  ON public.driver_direct_messages
  WITH CHECK (is_tenant_member(tenant_id));

DROP POLICY IF EXISTS "Driver can read own POD" ON public.proof_of_delivery;
CREATE POLICY "Driver can read own POD"
  ON public.proof_of_delivery
  FOR SELECT
  TO authenticated
  USING (public.driver_owns_stop(dispatch_stop_id));
