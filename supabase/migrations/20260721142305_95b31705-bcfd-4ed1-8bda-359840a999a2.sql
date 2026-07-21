
ALTER TABLE public.loads REPLICA IDENTITY FULL;
ALTER TABLE public.dispatch_trips REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.loads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.dispatch_trips;
